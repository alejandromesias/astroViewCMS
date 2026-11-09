// The operations on the CMS clone (WORKPLAN 2.3c): commits of saves, the changed paths, reads at a ref, and
// worktrees. Changes run inside `Repo.locked`, one at a time, through the mutex. Reads that only compare commits
// do not lock. Callers pass site-relative paths and get them back site-relative: `siteDir` is joined and stripped
// here and nowhere else.
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import {
  type Bundle,
  BundleError,
  type DocumentEntry,
} from '../bundle/read.ts';
import type { BundleStore } from '../bundle/store.ts';
import type { CmsConfig } from '../config/schema.ts';
import { changesetWithTombstones } from '../documents/changeset.ts';
import { type FileOp, planWrite } from '../documents/plan-write.ts';
import {
  commitParagraphs,
  planReapply,
  type RenamedDocument,
  renamedDocuments,
  trailersOf,
} from '../documents/reapply.ts';
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
  moveWork,
  type RepoErrorKind,
  type RepoState,
  repoErrorOf,
  WORK,
  WORK_NEXT,
  WORK_REF,
} from './repo.ts';
import {
  type ChangedPath,
  type ChangeStatus,
  classifyChange,
  type SyncChange,
  siteScope,
} from './sync.ts';

// The types live in sync.ts, which this file imports. sync.ts cannot import this file back (a cycle).
export type { ChangedPath } from './sync.ts';

/** Why a fetch failed. The kinds are `ensureRepo`'s `RepoError` kinds, and the message is redacted. */
interface SyncError {
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

/**
 * What `tx.reapply` returns (2.10b, 2.10j). `tip` is the new tip of `cms/work`, `upstream` itself when nothing is saved.
 * `renamed` lists the saved documents whose file upstream renamed. The save still writes the old path, so the list is
 * a warning only (the accepted limit of 2.10b).
 */
export interface ReapplyResult {
  readonly tip: string;
  readonly renamed: readonly RenamedDocument[];
}

export interface OpenRepoOptions {
  /** `collections` and `media` are read by the re-apply (2.10b): the entry formats and the saved images' folder. */
  config: Pick<
    CmsConfig,
    'site' | 'remote' | 'branch' | 'siteDir' | 'collections' | 'media'
  >;
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
   * Rebuilds `cms/work` as `upstream` plus the saved changeset (2.10b): one commit on `upstream`, with the saved
   * documents written into the upstream text. Returns the new tip of `cms/work` (`upstream` itself when nothing is
   * saved) and the saved documents upstream renamed (2.10j). Built with plumbing, so no worktree changes until the
   * move. Throws when a saved document cannot be read or there is no bundle; the saves then stay on `cms/work`. Read
   * `bundles` once, for the documents of the save.
   */
  reapply(upstream: string, bundles: BundleStore): Promise<ReapplyResult>;
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

/** What a re-apply writes into the index: the planned file operations, the trailers of the commit, and the renames (2.10j). */
interface Saves {
  readonly ops: readonly FileOp[];
  readonly trailers: ReadonlyMap<string, string>;
  readonly renamed: readonly RenamedDocument[];
}

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
  // `env` adds variables to this one call (2.10b: `GIT_INDEX_FILE` for the temporary index).
  const git = (
    args: readonly string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<string> =>
    runGit(args, { cwd: state.repoDir, exec, env: env ?? {} });
  // The same, with stdout kept as bytes (a blob's content, which may hold invalid UTF-8 or a BOM).
  const gitBytes = (
    args: readonly string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<Buffer> =>
    runGit(args, { cwd: state.repoDir, exec, env: env ?? {}, binary: true });

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

  // Compares the two commits with the merge base, so upstream's new commits do not show as reversed edits.
  async function changedPaths(): Promise<ChangedPath[]> {
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
  }

  // Oldest first, so a later line (a newer save) replaces an earlier one in `parseOverwrote`.
  async function overwrittenSince(): Promise<Map<string, string>> {
    const output = await git([
      'log',
      '--reverse',
      `--format=%(trailers:key=${OVERWROTE_TRAILER},valueonly)`,
      `origin/${branch}..${WORK}`,
    ]);
    return parseOverwrote(output);
  }

  // The file operations, trailers and renamed documents of the saved changeset, planned on `upstream` (2.10b, 2.10j).
  // Nothing is planned when no path changed. Reads only, so a save that cannot be planned fails before anything is written.
  async function plannedSaves(
    changed: readonly ChangedPath[],
    upstream: string,
    bundles: BundleStore,
    configured: CmsConfig['collections'],
  ): Promise<Saves> {
    if (changed.length === 0)
      return { ops: [], trailers: new Map(), renamed: [] };
    const bundle = await bundles.current();
    if (bundle === null)
      throw new Error(
        `There is no bundle to re-apply the saves on. The saves stay on ${WORK}.`,
      );
    const older = await overwrittenSince();
    const { changeset, tombstones } = await changesetWithTombstones({
      bundle,
      repo: { changedPaths, mergeBase, showAtBytes, overwrittenSince },
      siteFolder: state.siteFolder,
    });
    const base = await mergeBase();
    // The renames upstream made since the merge base (2.10j). Git's rename detection is on by `-M`, not by config, so a
    // rename is found whatever `diff.renames` says. Repo-wide, so a rename into or out of the site folder shows too.
    const renames = parseRenames(
      await git(['diff', '-M', '--name-status', '-z', base, upstream]),
      scope,
    );
    // The bundle's documents, the documents this save created (not in the bundle yet), and the ones it deleted (their
    // tombstones): all have a file.
    const records = new Map<string, DocumentEntry>(bundle.documents);
    for (const record of changeset.createdRecords)
      records.set(record.key, record);
    for (const record of tombstones) records.set(record.key, record);
    const plan = await planReapply(changeset, records, {
      upstream: (path) => showAtBytes(upstream, path),
      base: (path) => showAtBytes(base, path),
    });
    const ops = await planWrite(plan.changes, {
      // A file the save makes again starts from its blank text; any other file starts from upstream's text.
      readText: async (path) => {
        const blank = plan.blank.get(path);
        if (blank !== undefined) return blank;
        const bytes = await showAtBytes(upstream, path);
        return bytes === null ? null : bytes.toString('utf8');
      },
      documents: records,
      collections: bundle.collections,
      config: { collections: configured },
    });
    return {
      ops,
      trailers: trailersOf(changeset, plan.overwritten, upstream, older),
      renamed: renamedDocuments(changeset.documents, records, renames),
    };
  }

  // Rebuilds `cms/work` as `upstream` plus the saved changeset, in one commit (2.10b, PHASE-2-DESIGN 4.2). Runs under
  // the lock, with `cms/work` checked out. The commit is built with plumbing: a temporary index in its own folder under
  // `tmp/`, outside the clone's files, so no worktree is touched. `cms/work-next` exists only once the commit is
  // complete, and then `moveWork` makes `cms/work` it. Returns the new tip and the renamed documents (2.10j).
  async function reapply(
    upstream: string,
    bundles: BundleStore,
  ): Promise<ReapplyResult> {
    assertRef(upstream);
    const { media, collections } = config;
    const head = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (head !== WORK)
      throw new Error(
        `HEAD is on ${head}, not ${WORK}. A re-apply needs ${WORK} checked out.`,
      );
    const oldTip = (await git(['rev-parse', WORK_REF])).trim();
    const changed = await changedPaths();
    const saves = await plannedSaves(changed, upstream, bundles, collections);
    const dir = join(cmsDir, site, 'tmp', `reapply-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    try {
      // The index starts as upstream's tree, so a path that the save does not change keeps upstream's version.
      const env = { GIT_INDEX_FILE: join(dir, 'index') };
      await git(['read-tree', upstream], env);
      const removals: string[] = [];
      const sets: string[] = [];
      let blobs = 0;
      for (const op of saves.ops) {
        const full = repoPath(scope, op.path);
        if (op.op === 'delete') {
          removals.push(full);
          continue;
        }
        blobs += 1;
        const sha = await blobOf(op.text, join(dir, `blob-${blobs}`));
        sets.push('--cacheinfo', `100644,${sha},${full}`);
      }
      // A saved image is restored from the old tip, and an image the save deleted is removed (2.10b).
      for (const { path } of changed) {
        if (!path.startsWith(`${media.folder}/`)) continue;
        const full = repoPath(scope, path);
        const blob = await blobAt(oldTip, full);
        if (blob === null) removals.push(full);
        else sets.push('--cacheinfo', `${blob.mode},${blob.sha},${full}`);
      }
      if (removals.length > 0)
        await git(['update-index', '--force-remove', '--', ...removals], env);
      if (sets.length > 0) await git(['update-index', '--add', ...sets], env);
      const tree = (await git(['write-tree'], env)).trim();
      const upstreamTree = (
        await git(['rev-parse', `${upstream}^{tree}`])
      ).trim();
      // No difference from upstream: no commit, and cms/work moves to upstream.
      const next =
        tree === upstreamTree
          ? upstream
          : (
              await git([
                'commit-tree',
                tree,
                '-p',
                upstream,
                ...commitParagraphs(upstream, saves.trailers).flatMap(
                  (paragraph) => ['-m', paragraph],
                ),
              ])
            ).trim();
      await git(['update-ref', WORK_NEXT, next]);
      await moveWork(git, oldTip, WORK_NEXT);
      return { tip: next, renamed: saves.renamed };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // Stores `text` as a blob, with its exact bytes (no filters). `git hash-object` reads a file or stdin, and `runGit`
  // gives no stdin, so the text goes through `file`, a file in the re-apply's folder. Returns the blob's sha.
  async function blobOf(text: string, file: string): Promise<string> {
    await writeFile(file, text);
    return (await git(['hash-object', '-w', '--no-filters', file])).trim();
  }

  // The mode and sha of the blob at `full` in `ref`, or null when there is none (a folder is none, as is a missing path).
  async function blobAt(
    ref: string,
    full: string,
  ): Promise<{ mode: string; sha: string } | null> {
    const listed = await git(['ls-tree', '-z', ref, '--', full]);
    const [, mode, sha] = /^(\d{6}) blob ([0-9a-f]+)\t/.exec(listed) ?? [];
    if (mode === undefined || sha === undefined) return null;
    return { mode, sha };
  }

  const tx: RepoTx = {
    reapply,
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
    changedPaths,
    async showAt(ref, path) {
      const bytes = await showAtBytes(ref, path);
      return bytes === null ? null : bytes.toString('utf8');
    },
    showAtBytes,
    mergeBase,
    overwrittenSince,
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

/**
 * Reads the renames of `git diff -M --name-status -z` (2.10j). A rename's status is `R<score>`, followed by its source
 * and its destination paths; every other status has one path. Returns each rename whose source is in the site folder
 * `scope`, as source to destination, both site-relative (see `fromSite`). A rename from outside the folder is left out:
 * no saved document lives there.
 */
export function parseRenames(
  output: string,
  scope: string,
): Map<string, string> {
  const fields = output.split('\0').filter((field) => field !== '');
  const renames = new Map<string, string>();
  let index = 0;
  while (index < fields.length) {
    if ((fields[index] ?? '').startsWith('R')) {
      const source = fields[index + 1] ?? '';
      const destination = fields[index + 2] ?? '';
      if (scope === '.' || source.startsWith(`${scope}/`))
        renames.set(fromSite(scope, source), fromSite(scope, destination));
      index += 3;
    } else index += 2;
  }
  return renames;
}

// A repo path as a path from the site folder (2.10j). Inside the folder it loses the folder; outside, it goes up with
// `../` once for each folder of the site, so it still reads from the site. With the site at the root, nothing changes.
function fromSite(scope: string, path: string): string {
  if (scope === '.') return path;
  if (path.startsWith(`${scope}/`)) return path.slice(scope.length + 1);
  return `${'../'.repeat(scope.split('/').length)}${path}`;
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
