// The operations on the CMS clone (WORKPLAN 2.3c): commits of saves, the changed paths, reads at a ref, and
// worktrees. Changes run inside `Repo.locked`, one at a time, through the mutex. Reads that only compare commits
// do not lock. Callers pass site-relative paths and get them back site-relative: `siteDir` is joined and stripped
// here and nowhere else.
import { mkdir } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import type { CmsConfig } from '../config/schema.ts';
import {
  assertRef,
  assertRelativePath,
  type ExecFn,
  realExec,
  runGit,
} from './exec.ts';
import { createMutex, type Mutex } from './mutex.ts';
import { type RepoState, WORK } from './repo.ts';

/** How a path differs between the base (`origin/<branch>`) and `cms/work`. A type change counts as modified. */
export type ChangeStatus = 'created' | 'modified' | 'deleted';

/** One path that differs, relative to the site folder. */
export interface ChangedPath {
  path: string;
  status: ChangeStatus;
}

export interface OpenRepoOptions {
  config: Pick<CmsConfig, 'site' | 'branch' | 'siteDir'>;
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
  const { site, branch, siteDir } = config;
  // `posix.normalize` gives "." for the site at the repo root, and "site" for "./site/" (the trailing slash goes).
  const scope = posix.normalize(siteDir).replace(/\/+$/, '');
  const worktreesDir = join(cmsDir, site, 'worktrees');
  // Runs git in the clone. Every call goes through `runGit`, so the git settings and the timeout are the same everywhere.
  const git = (args: readonly string[]): Promise<string> =>
    runGit(args, { cwd: state.repoDir, exec });
  // The same, with stdout kept as bytes (a blob's content, which may hold invalid UTF-8 or a BOM).
  const gitBytes = (args: readonly string[]): Promise<Buffer> =>
    runGit(args, { cwd: state.repoDir, exec, binary: true });

  const tx: RepoTx = {
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
    async worktreeRemove(dir) {
      const target = worktreePath(worktreesDir, dir);
      await git(['worktree', 'remove', '--force', target]);
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
    async mergeBase() {
      return (await git(['merge-base', `origin/${branch}`, WORK])).trim();
    },
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
