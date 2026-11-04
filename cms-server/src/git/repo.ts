// The CMS's own clone of the site's repository (PHASE-2-DESIGN 4.2, WORKPLAN 2.3b). `ensureRepo` runs on every
// start, before the server listens. It clones the repo when it is missing, checks `origin` against the config,
// sets the commit identity, fetches, and creates `cms/work` when it is missing. Then it discards whatever an
// unfinished save left in the working copy. It never resets `cms/work` to the remote, because that branch
// holds the saves.
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CmsConfig } from '../config/schema.ts';
import { type Logger, logger } from '../log.ts';
import {
  assertRef,
  assertRemoteUrl,
  type ExecFn,
  GitError,
  realExec,
  redact,
  runGit,
} from './exec.ts';

/** The branch that holds the saves. Only the CMS writes it. */
export const WORK = 'cms/work';
// A clone of a large site can take minutes. The other git calls keep the 60 s default of `runGit`.
const CLONE_TIMEOUT_MS = 5 * 60_000;
// Remote URLs that name GitHub: HTTPS, `ssh://`, or the SCP form `git@github.com:owner/repo`.
// Only these get the GitHub error kinds. Other hosts print different messages.
const GITHUB_REMOTE = /^(?:https:\/\/|ssh:\/\/)?(?:[^@/]+@)?github\.com[:/]/i;
// `Name <email>`, as in `git.author`. Both parts are needed for the commit identity.
const AUTHOR = /^(.+?)\s*<([^<>\s]+)>$/;
const AUTH_FAILED =
  /authentication failed|could not read username|permission denied \(publickey\)/i;
const NOT_FOUND = /repository.*not found/i;

type RepoErrorKind =
  | 'auth-failed'
  | 'remote-not-found'
  | 'url-mismatch'
  | 'failed';

/** A repo that cannot be made ready. `message` and `stderr` have their credentials redacted, like `GitError`'s. */
class RepoError extends Error {
  readonly kind: RepoErrorKind;
  readonly stderr: string;

  constructor(kind: RepoErrorKind, message: string, stderr = '') {
    super(redact(message));
    this.name = 'RepoError';
    this.kind = kind;
    this.stderr = redact(stderr);
  }
}

export interface EnsureRepoOptions {
  config: Pick<CmsConfig, 'site' | 'remote' | 'branch' | 'siteDir' | 'git'>;
  /** The `.cms` folder. The clone goes in `<cmsDir>/<site>/repo`. */
  cmsDir: string;
  exec?: ExecFn;
  log?: Logger;
}

/** Where the clone is, the site folder inside it, and whether this start discarded an unfinished save. */
export interface RepoState {
  repoDir: string;
  siteFolder: string;
  recovered: boolean;
}

interface Identity {
  readonly name: string;
  readonly email: string;
}

type Git = (args: readonly string[]) => Promise<string>;

/**
 * Makes the clone ready for this start and returns its state. Any `GitError` from git, and any
 * `url-mismatch`, comes out as a `RepoError` with a kind. Nothing is reset when `origin` does not match.
 */
export async function ensureRepo({
  config,
  cmsDir,
  exec = realExec,
  log = logger,
}: EnsureRepoOptions): Promise<RepoState> {
  try {
    return await syncRepo(config, cmsDir, exec, log);
  } catch (error: unknown) {
    if (error instanceof GitError) throw repoErrorOf(error, config.remote);
    throw error;
  }
}

async function syncRepo(
  config: EnsureRepoOptions['config'],
  cmsDir: string,
  exec: ExecFn,
  log: Logger,
): Promise<RepoState> {
  const { site, remote, branch, siteDir } = config;
  const identity = identityOf(config.git.author);
  assertRemoteUrl(remote);
  assertRef(branch);
  const siteRoot = join(cmsDir, site);
  const repoDir = join(siteRoot, 'repo');
  const hooksDir = join(siteRoot, 'no-hooks');
  await mkdir(hooksDir, { recursive: true });
  const git: Git = (args) => runGit(args, { cwd: repoDir, exec });

  if (await isRepo(repoDir)) {
    await checkOrigin(git, remote, branch, repoDir);
  } else {
    await runGit(
      [
        'clone',
        '-c',
        'core.autocrlf=false',
        '--branch',
        branch,
        '--',
        remote,
        repoDir,
      ],
      { cwd: siteRoot, exec, timeoutMs: CLONE_TIMEOUT_MS },
    );
  }
  await setConfig(git, identity, hooksDir, join(repoDir, '.git', 'config'));
  await git(['fetch', 'origin']);
  if (!(await refExists(git, `refs/heads/${WORK}`)))
    await git(['branch', WORK, `origin/${branch}`]);

  // Before the checkout, because `checkout --force` throws the changes away.
  const dirty = pathsOf(
    await git([
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=all',
      '--no-renames',
    ]),
  );
  await git(['checkout', '--force', WORK]);
  await git(['clean', '-fd']);
  // A crash can leave a worktree whose folder is gone, and its record stays in the repo. Prune it here (2.3c).
  await git(['worktree', 'prune']);
  if (dirty.length > 0)
    log.warn('Discarded the uncommitted changes of an unfinished save', {
      paths: dirty,
    });
  return {
    repoDir,
    siteFolder: join(repoDir, siteDir),
    recovered: dirty.length > 0,
  };
}

// The URL check comes before any other change, so a wrong remote changes nothing.
async function checkOrigin(
  git: Git,
  remote: string,
  branch: string,
  repoDir: string,
): Promise<void> {
  const actual = (await git(['remote', 'get-url', 'origin'])).trim();
  if (actual === remote) return;
  const saves = await unpublishedSaves(git, branch);
  throw new RepoError(
    'url-mismatch',
    `The CMS clone ${repoDir} has origin ${actual}, but the config says ${remote}. The CMS will not repoint or re-clone it. ${savesNote(saves)}`,
  );
}

// The commits on `cms/work` that origin does not have. Undefined when git cannot count them.
async function unpublishedSaves(
  git: Git,
  branch: string,
): Promise<number | undefined> {
  if (!(await refExists(git, `refs/heads/${WORK}`))) return 0;
  try {
    const count = await git([
      'rev-list',
      '--count',
      `origin/${branch}..${WORK}`,
    ]);
    return Number(count.trim());
  } catch (error: unknown) {
    if (error instanceof GitError && error.kind === 'failed') return undefined;
    throw error;
  }
}

function savesNote(saves: number | undefined): string {
  if (saves === undefined)
    return 'Whether cms/work has unpublished saves could not be checked.';
  if (saves === 0)
    return 'cms/work has no unpublished saves, so deleting the folder loses nothing.';
  return `cms/work has ${saves} unpublished save commit(s); deleting the folder would lose them.`;
}

// Every start: the identity comes from the config, so a changed author takes effect. The hooks folder
// is empty and signing is off, so the user's global hooks and signing do not run on CMS commits.
// Each write names the clone's own config file, so a folder git does not read as its own repo
// cannot change a parent repo's settings, even if the guard before it is bypassed.
async function setConfig(
  git: Git,
  identity: Identity,
  hooksDir: string,
  configFile: string,
): Promise<void> {
  const file = ['config', '--file', configFile];
  await git([...file, 'user.name', identity.name]);
  await git([...file, 'user.email', identity.email]);
  await git([...file, 'core.hooksPath', hooksDir]);
  await git([...file, 'commit.gpgsign', 'false']);
  await git([...file, 'core.autocrlf', 'false']);
}

// Checked before any git call. A missing `<email>` part is a config error, so it is reported as `failed`.
function identityOf(author: string): Identity {
  const [, name, email] = AUTHOR.exec(author.trim()) ?? [];
  if (name === undefined || email === undefined)
    throw new RepoError('failed', 'git.author must look like "Name <email>"');
  return { name, email };
}

async function refExists(git: Git, ref: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch (error: unknown) {
    if (error instanceof GitError && error.kind === 'failed') return false;
    throw error;
  }
}

async function isRepo(repoDir: string): Promise<boolean> {
  return stat(join(repoDir, '.git')).then(
    () => true,
    () => false,
  );
}

// `status -z` ends each entry with NUL and writes `XY path`, so the path starts at column 4.
function pathsOf(status: string): string[] {
  return status
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => entry.slice(3));
}

function repoErrorOf(error: GitError, remote: string): RepoError {
  const kind =
    error.kind === 'failed' && GITHUB_REMOTE.test(remote)
      ? classify(error.stderr)
      : undefined;
  if (kind === 'auth-failed')
    return new RepoError(
      kind,
      `Git could not sign in to ${remote}. Check the machine's git credential helper or SSH key.`,
      error.stderr,
    );
  if (kind === 'remote-not-found')
    return new RepoError(
      kind,
      `The remote ${remote} was not found, or this machine has no access to it. Check the URL.`,
      error.stderr,
    );
  const detail = error.stderr.trim();
  return new RepoError(
    'failed',
    detail === '' ? error.message : `${error.message}: ${detail}`,
    error.stderr,
  );
}

// stderr is read under LC_ALL=C (runGit sets it), so these messages are the English ones.
function classify(
  stderr: string,
): 'auth-failed' | 'remote-not-found' | undefined {
  if (AUTH_FAILED.test(stderr)) return 'auth-failed';
  if (NOT_FOUND.test(stderr)) return 'remote-not-found';
  return undefined;
}
