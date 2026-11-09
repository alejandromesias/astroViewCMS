// The CMS's own clone of the site's repository (PHASE-2-DESIGN 4.2, WORKPLAN 2.3b). `ensureRepo` runs on every
// start, before the server listens. It clones the repo when it is missing, checks `origin` against the config,
// sets the commit identity, fetches, and creates `cms/work` when it is missing. Then it discards whatever an
// unfinished save left in the working copy. It never resets `cms/work` to the remote, because that branch
// holds the saves.
import { mkdir, realpath, stat } from 'node:fs/promises';
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
/** The full ref of `WORK`. */
export const WORK_REF = `refs/heads/${WORK}`;
/** The re-applied `cms/work`, made before the move (2.10b). It exists only while a re-apply is unfinished. */
export const WORK_NEXT = 'refs/heads/cms/work-next';
/** The old tip of `cms/work`, kept until the move is done (2.10b). It exists only while a re-apply is unfinished. */
const WORK_PREV = 'refs/heads/cms/work-prev';
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

export type RepoErrorKind =
  | 'auth-failed'
  | 'remote-not-found'
  | 'url-mismatch'
  | 'failed';

/** A repo that cannot be made ready. `message` and `stderr` have their credentials redacted, like `GitError`'s. */
export class RepoError extends Error {
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

/** Runs git in the clone and resolves with its stdout. */
type Git = (args: readonly string[]) => Promise<string>;

/**
 * The variables that name the clone at `repoDir` (2.1j). Every call in the clone passes them, so git reads this clone
 * whatever `cwd` says. The clone itself and the own-repo check do not, because they must find their repo from the folder.
 */
export function cloneEnv(repoDir: string): {
  readonly GIT_DIR: string;
  readonly GIT_WORK_TREE: string;
} {
  return { GIT_DIR: join(repoDir, '.git'), GIT_WORK_TREE: repoDir };
}

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
  const git: Git = (args) =>
    runGit(args, { cwd: repoDir, exec, env: cloneEnv(repoDir) });
  // Unscoped, for the own-repo check only: `--show-toplevel` must find the repo from the folder (2.1j).
  const discover: Git = (args) => runGit(args, { cwd: repoDir, exec });

  // An existing folder must be its own repo before any git call runs in it. A fresh clone is one already.
  if (await isRepo(repoDir)) {
    await assertOwnRepo(discover, repoDir);
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
  // Before the checkout, because `checkout --force` throws the changes away. Read before any ref moves below.
  const dirty = pathsOf(
    await git([
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=all',
      '--no-renames',
    ]),
  );
  // An unfinished re-apply (2.10b) is finished before cms/work is looked at. It moves refs only; the checkout below
  // makes the working copy match.
  await finishReapply(git, log);
  if (!(await refExists(git, WORK_REF)))
    await git(['branch', WORK, `origin/${branch}`]);
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

/**
 * Refuses a clone folder that git does not treat as its own repo. A `.git` that git does not read (an
 * empty folder, say) makes git use a parent repo, and the fetch, checkout and config writes would change
 * that parent. Throws a `failed` RepoError when `git rev-parse --show-toplevel` is not `repoDir`, or when
 * that git call exits with an error. Real paths are compared, so Windows separators do not matter. Case does: `realpath`
 * does not fold it, so a case-only difference is refused (a false refusal, the safe direction).
 */
async function assertOwnRepo(git: Git, repoDir: string): Promise<void> {
  const refuse = (stderr = ''): RepoError =>
    new RepoError(
      'failed',
      `The CMS clone ${repoDir} is not a git repository of its own. Git would use a parent repository, so the CMS will not change it. Check or remove the folder by hand, then start the CMS again.`,
      stderr,
    );
  let toplevel: string;
  try {
    toplevel = (await git(['rev-parse', '--show-toplevel'])).trim();
  } catch (error: unknown) {
    if (error instanceof GitError && error.kind === 'failed')
      throw refuse(error.stderr);
    throw error;
  }
  // A folder inside no work tree (a bare or empty repo) prints nothing: it is not the clone's own repo.
  if (toplevel === '') throw refuse();
  const [actual, expected] = await Promise.all([
    realpath(toplevel),
    realpath(repoDir),
  ]);
  if (actual !== expected) throw refuse();
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

/**
 * Moves `cms/work` to `next` (a full ref), the way a re-apply does it (2.10b): keeps the old tip `oldTip` on
 * `WORK_PREV`, resets the branch and the working copy to `next`, then deletes both leftover refs. The caller has
 * `cms/work` checked out. Each step can be repeated, so a crash in between is finished by `finishReapply`.
 */
export async function moveWork(
  git: Git,
  oldTip: string,
  next: string,
): Promise<void> {
  await git(['update-ref', WORK_PREV, oldTip]);
  await git(['reset', '--hard', next]);
  await git(['update-ref', '-d', WORK_NEXT]);
  await git(['update-ref', '-d', WORK_PREV]);
}

/**
 * Finishes a re-apply that a crash left unfinished (2.10b). It needs no network and never discards a save: when
 * `WORK_NEXT` exists and `cms/work` is its old tip (`WORK_PREV`) or `WORK_NEXT` itself, `cms/work` moves to it. When
 * `cms/work` is neither, it is kept and the log says so; the re-applied commit stays in the object store. Only
 * `WORK_PREV` left means the move finished, so it is deleted. The move here is ref-only: the checkout that follows in
 * `syncRepo` makes the working copy match. A missing `cms/work` moves too, since a re-applied commit is not lost.
 */
async function finishReapply(git: Git, log: Logger): Promise<void> {
  const next = await refSha(git, WORK_NEXT);
  const prev = await refSha(git, WORK_PREV);
  if (next !== null) {
    const work = await refSha(git, WORK_REF);
    if (work === null || work === prev || work === next)
      await git(['update-ref', WORK_REF, next]);
    else
      log.warn(
        'An unfinished re-apply left cms/work on a commit that is neither its old tip nor the re-applied commit, so cms/work was kept. The re-applied commit stays in the object store.',
        { kept: work, reapplied: next },
      );
    await git(['update-ref', '-d', WORK_NEXT]);
  }
  if (prev !== null) await git(['update-ref', '-d', WORK_PREV]);
}

/** The sha a ref points to, or null when the ref does not exist. */
async function refSha(git: Git, ref: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', '--verify', '--quiet', ref])).trim();
  } catch (error: unknown) {
    if (error instanceof GitError && error.kind === 'failed') return null;
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

export function repoErrorOf(error: GitError, remote: string): RepoError {
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
