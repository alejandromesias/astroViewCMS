// The operations on the CMS clone (WORKPLAN 2.3c): commits of saves, the changed paths, reads at a ref, and
// worktrees. Changes run inside `Repo.locked`, one at a time, through the mutex. Reads that only compare commits
// do not lock. Callers pass site-relative paths and get them back site-relative: `siteDir` is joined and stripped
// here and nowhere else.
import { mkdir } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { type Bundle, BundleError } from '../bundle/read.ts';
import type { BundleStore } from '../bundle/store.ts';
import type { CmsConfig } from '../config/schema.ts';
import {
  assertRef,
  assertRelativePath,
  type ExecFn,
  GitError,
  realExec,
  redact,
  runGit,
} from './exec.ts';
import { createMutex, type Mutex } from './mutex.ts';
import {
  type RepoErrorKind,
  type RepoState,
  repoErrorOf,
  WORK,
} from './repo.ts';
import {
  type ChangedPath,
  type ChangeStatus,
  classifyChange,
  type SyncChange,
  siteScope,
} from './sync.ts';

// The types live in sync.ts, which this file imports. sync.ts cannot import this file back (a cycle).
export type { ChangedPath, ChangeStatus } from './sync.ts';

/** Why a fetch failed. The kinds are `ensureRepo`'s `RepoError` kinds, and the message is redacted. */
export interface SyncError {
  kind: RepoErrorKind;
  message: string;
}

/**
 * What `tx.fetch` found. `upstream` is `origin/<branch>` after the fetch. `reapply` is true when `cms/work` is not
 * based on it (2.10b). `change` is what the upstream change means for the build (`sync.ts`). `paths` are the paths
 * that differ from the bundle's commit, repo-relative (a path outside the site folder is listed too); empty when
 * they could not be read.
 */
export type FetchResult =
  | {
      ok: true;
      upstream: string;
      reapply: boolean;
      change: SyncChange;
      paths: readonly ChangedPath[];
    }
  | { ok: false; syncError: SyncError };

export interface OpenRepoOptions {
  config: Pick<CmsConfig, 'site' | 'remote' | 'branch' | 'siteDir'>;
  /** The `.cms` folder. Worktrees go in `<cmsDir>/<site>/worktrees`. */
  cmsDir: string;
  /** What `ensureRepo` returned for this start. */
  state: RepoState;
  exec?: ExecFn;
  mutex?: Mutex;
}

/** The calls that change the clone. They exist only inside `Repo.locked`, so they cannot take the lock again. */
export interface RepoTx {
  /**
   * Stages `paths` and commits those paths alone with `message`, unchanged. Returns the new commit's sha,
   * or `null` when the paths did not change. Refuses an empty list, so nothing else gets staged.
   */
  commitSave(paths: readonly string[], message: string): Promise<string | null>;
  /** Adds a detached worktree at `ref`. `dir` is a folder name directly inside the worktrees folder. Returns its path. */
  worktreeAdd(ref: string, dir: string): Promise<string>;
  /** Removes a worktree made by `worktreeAdd`, forcibly, and prunes its record. */
  worktreeRemove(dir: string): Promise<void>;
  /**
   * Fetches `origin`, then classifies the change from the current bundle's commit (`siteCommit`) to `origin/<branch>`
   * (2.10a). Never throws: a failed fetch comes back as `{ ok: false, syncError }`. With no bundle, or an unreadable
   * one, the change is `code`.
   */
  fetch(bundles: BundleStore): Promise<FetchResult>;
  /**
   * Puts `paths` back as HEAD has them (2.5c): unstages them, checks out the ones HEAD has, and removes the ones it
   * does not have (files a failed save wrote). Site-relative, as `commitSave`. A path that matches nothing is ignored.
   */
  restore(paths: readonly string[]): Promise<void>;
}

/** The repo operations of one start. */
export interface Repo {
  /** Runs `work` with the lock held. The lock is not re-entrant: do not call `locked` inside `work`. */
  locked<T>(holder: string, work: (tx: RepoTx) => Promise<T>): Promise<T>;
  /** The paths that `cms/work` changes from `origin/<branch>`, site-relative, in path order. */
  changedPaths(): Promise<ChangedPath[]>;
  /** The text of `path` at `ref`, or `null` when it is missing there or is a folder. A missing `ref` throws. */
  showAt(ref: string, path: string): Promise<string | null>;
  /** The exact bytes of `path` at `ref`, or `null` as `showAt`. Undecoded, so a hash of them is the file's revision. */
  showAtBytes(ref: string, path: string): Promise<Buffer | null>;
  /** The commit `cms/work` and `origin/<branch>` share: the base that `changedPaths` compares with. Read without the lock. */
  mergeBase(): Promise<string>;
  /**
   * The `CMS-Overwrote` trailers of the saves on `cms/work` that origin does not have, as document key to the
   * upstream sha. When a key repeats, the newest save (and the last line of it) wins. Read without the lock.
   */
  overwrittenSince(): Promise<ReadonlyMap<string, string>>;
}

/** The trailer that a re-apply save writes for each document it overwrote (2.10b). */
const OVERWROTE_TRAILER = 'CMS-Overwrote';

/** Makes the operations for one start. `exec` and `mutex` default to the real git and a new lock. */
export function openRepo({
  config,
  cmsDir,
  state,
  exec = realExec,
  mutex = createMutex(),
}: OpenRepoOptions): Repo {
  const { site, remote, branch, siteDir } = config;
  // "." for the site at the repo root, and "site" for "./site/" (the trailing slash goes). See `siteScope`.
  const scope = siteScope(siteDir);
  const worktreesDir = join(cmsDir, site, 'worktrees');
  // Runs git in the clone. Every call goes through `runGit`, so the git settings and the timeout are the same everywhere.
  const git = (args: readonly string[]): Promise<string> =>
    runGit(args, { cwd: state.repoDir, exec });
  // The same, with stdout kept as bytes (a blob's content, which may hold invalid UTF-8 or a BOM).
  const gitBytes = (args: readonly string[]): Promise<Buffer> =>
    runGit(args, { cwd: state.repoDir, exec, binary: true });

  // The commit `cms/work` and `origin/<branch>` share. `fetch` compares it with `origin/<branch>` for `reapply`.
  async function mergeBase(): Promise<string> {
    return (await git(['merge-base', `origin/${branch}`, WORK])).trim();
  }

  // The paths that differ between the bundle's commit and `origin/<branch>`, repo-relative. The whole repo is
  // compared (no site-folder pathspec), so a change outside the site folder shows too. Null when they cannot be
  // read: no commit, a commit that git does not have, or a failed diff.
  async function upstreamChanges(
    siteCommit: string | null,
  ): Promise<ChangedPath[] | null> {
    if (siteCommit === null) return null;
    try {
      // Checked as every ref is, so a value that git would read as an option never reaches it.
      assertRef(siteCommit);
      // Three dots: the diff runs from the merge base of `siteCommit` and origin, so only what origin changed since
      // they split counts. Saves on `cms/work` are not on origin, so they never appear in it.
      const output = await git([
        'diff',
        '--name-status',
        '-z',
        '--no-renames',
        `${siteCommit}...origin/${branch}`,
        '--',
      ]);
      return parseNameStatus(output, '.');
    } catch {
      return null;
    }
  }

  const tx: RepoTx = {
    // Fetches `origin`, then classifies the change. Every failure is returned as a sync error, never thrown.
    async fetch(bundles) {
      try {
        await git(['fetch', 'origin']);
        const upstream = (await git(['rev-parse', `origin/${branch}`])).trim();
        const reapply = (await mergeBase()) !== upstream;
        const bundle = await currentBundle(bundles);
        const changes =
          bundle === null
            ? null
            : await upstreamChanges(bundle.identity.siteCommit);
        const change = classifyChange({
          changes,
          documents: bundle === null ? null : [...bundle.documents.values()],
          siteDir,
        });
        return { ok: true, upstream, reapply, change, paths: changes ?? [] };
      } catch (error: unknown) {
        return { ok: false, syncError: syncErrorOf(error, remote) };
      }
    },
    // Unstages first, so a file a failed save added is not kept by the index, then checks out what HEAD has.
    async restore(paths) {
      if (paths.length === 0) return;
      const full = paths.map((path) => repoPath(scope, path));
      await git(['reset', '-q', '--', ...full]);
      const listed = await git([
        'ls-tree',
        '-z',
        '--name-only',
        'HEAD',
        '--',
        ...full,
      ]);
      const inHead = new Set(listed.split('\0').filter((path) => path !== ''));
      const tracked = full.filter((path) => inHead.has(path));
      const created = full.filter((path) => !inHead.has(path));
      if (tracked.length > 0) await git(['checkout', 'HEAD', '--', ...tracked]);
      // `-x` also removes an ignored file. `git add` refuses an ignored path, so a save that wrote one fails, and
      // without `-x` clean would leave that file behind.
      if (created.length > 0)
        await git(['clean', '-f', '-x', '--', ...created]);
    },
    // Refuses a save off `cms/work`: committing there would put the save on another branch.
    async commitSave(paths, message) {
      if (paths.length === 0)
        throw new Error('commitSave needs at least one path');
      const head = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      if (head !== WORK)
        throw new Error(
          `HEAD is on ${head}, not ${WORK}. A save needs ${WORK} checked out.`,
        );
      const full = paths.map((path) => repoPath(scope, path));
      await git(['add', '-A', '--', ...full]);
      const staged = await git([
        'diff',
        '--cached',
        '--name-only',
        '-z',
        '--',
        ...full,
      ]);
      if (staged === '') return null;
      await git(['commit', '--message', message, '--', ...full]);
      return (await git(['rev-parse', 'HEAD'])).trim();
    },
    // Checks the folder, makes the parent folder, then adds the worktree detached at `ref`.
    async worktreeAdd(ref, dir) {
      assertRef(ref);
      const target = worktreePath(worktreesDir, dir);
      await mkdir(worktreesDir, { recursive: true });
      await git(['worktree', 'add', '--detach', target, ref]);
      return target;
    },
    // Removes the worktree with `--force` (its folder may hold unsaved edits), then prunes what git left behind.
    // `core.longpaths` lets Windows git delete deep paths, such as astro's cache inside a built worktree.
    async worktreeRemove(dir) {
      const target = worktreePath(worktreesDir, dir);
      await git([
        '-c',
        'core.longpaths=true',
        'worktree',
        'remove',
        '--force',
        target,
      ]);
      await git(['worktree', 'prune']);
    },
  };

  // `cat-file blob` prints the stored bytes. `ls-tree` prints `<mode> <type> <sha>` for a file, and nothing when the path is missing.
  async function showAtBytes(
    ref: string,
    path: string,
  ): Promise<Buffer | null> {
    assertRef(ref);
    const full = repoPath(scope, path);
    const entry = await git(['ls-tree', '-z', ref, '--', full]);
    if (entry.split(' ')[1] !== 'blob') return null;
    return gitBytes(['cat-file', 'blob', `${ref}:${full}`]);
  }

  return {
    locked: (holder, work) => mutex.run(holder, () => work(tx)),
    // Compares the two commits with the merge base, so upstream's new commits do not show as reversed edits.
    async changedPaths() {
      const output = await git([
        'diff',
        '--name-status',
        '-z',
        '--no-renames',
        `origin/${branch}...${WORK}`,
        '--',
        scope,
      ]);
      return parseNameStatus(output, scope);
    },
    async showAt(ref, path) {
      const bytes = await showAtBytes(ref, path);
      return bytes === null ? null : bytes.toString('utf8');
    },
    showAtBytes,
    mergeBase,
    // Oldest first, so a later line (a newer save) replaces an earlier one in `parseOverwrote`.
    async overwrittenSince() {
      const output = await git([
        'log',
        '--reverse',
        `--format=%(trailers:key=${OVERWROTE_TRAILER},valueonly)`,
        `origin/${branch}..${WORK}`,
      ]);
      return parseOverwrote(output);
    },
  };
}

// The current bundle, or null when there is none or its files cannot be read. An unreadable bundle counts as none,
// so the change is `code` (a rebuild), not a sync error.
async function currentBundle(bundles: BundleStore): Promise<Bundle | null> {
  try {
    return await bundles.current();
  } catch (error: unknown) {
    if (error instanceof BundleError) return null;
    throw error;
  }
}

// A failed fetch as a sync error. A git failure keeps the `RepoError` kind that `ensureRepo` gives the same failure.
function syncErrorOf(error: unknown, remote: string): SyncError {
  if (error instanceof GitError) {
    const { kind, message } = repoErrorOf(error, remote);
    return { kind, message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: 'failed', message: redact(message) };
}

/**
 * Reads the `CMS-Overwrote` values of a `git log` in the order it prints them: oldest first, one value per line, each
 * `<document key> <upstream sha>`. The sha is what follows the last space, so a key may hold spaces (a `file()` id can).
 * A line without a key or a sha is skipped. A later line for a key replaces an earlier one.
 */
export function parseOverwrote(output: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of output.split('\n')) {
    const space = line.lastIndexOf(' ');
    if (space <= 0 || space === line.length - 1) continue;
    found.set(line.slice(0, space), line.slice(space + 1));
  }
  return found;
}

/**
 * Reads the output of `git diff --name-status -z --no-renames`: pairs of a status letter and a path, each ending
 * in NUL. Strips the site folder `scope` from each path. Unknown letters throw, rather than guess.
 */
export function parseNameStatus(output: string, scope: string): ChangedPath[] {
  const fields = output.split('\0').filter((field) => field !== '');
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    changes.push({
      path: siteRelative(scope, fields[index + 1] ?? ''),
      status: statusOf(fields[index] ?? ''),
    });
  }
  return changes;
}

// The git path of a site-relative one. The path is checked first, so `..` or an absolute path never reaches git.
function repoPath(scope: string, path: string): string {
  assertRelativePath(path);
  return posix.join(scope, path);
}

// Removes the site folder from a repo path. At the repo root (`.`) nothing is removed.
function siteRelative(scope: string, path: string): string {
  if (scope === '.') return path;
  return path.slice(`${scope}/`.length);
}

// Maps a `git diff --name-status` letter. A type change (`T`) is a modification of the path.
function statusOf(letter: string): ChangeStatus {
  if (letter === 'A') return 'created';
  if (letter === 'D') return 'deleted';
  if (letter === 'M' || letter === 'T') return 'modified';
  throw new Error(
    `git diff gave an unexpected status ${JSON.stringify(letter)}`,
  );
}

// A worktree is a folder directly inside the worktrees folder. Anything else (`.`, `..`, a nested path) is refused.
function worktreePath(worktreesDir: string, dir: string): string {
  assertRelativePath(dir);
  const target = resolve(worktreesDir, dir);
  if (dirname(target) !== resolve(worktreesDir))
    throw new Error(
      `worktree ${JSON.stringify(dir)} must be one folder directly inside the worktrees folder`,
    );
  return target;
}
