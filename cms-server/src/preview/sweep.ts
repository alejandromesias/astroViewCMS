// The start-up sweep of `.cms/<site>/` (WORKPLAN 2.9a and 2.9c, PHASE-2-DESIGN 4.4). A crash can leave three kinds of
// leftovers: a build worktree `worktrees/build-<bundleId>`, a bundle folder with no bundle.json, and a temporary index
// file in `tmp/` (2.10b). Nothing else runs at start-up, so all of them are removed before the node starts. The sweep
// never stops the start: what it cannot remove is logged and left out of the result.
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { type Logger, logger } from '../log.ts';
import type { WorktreeLock } from './build-commit.ts';
import { removeIncompleteBundles } from './bundles.ts';

// build-commit.ts names each build worktree `build-<bundleId>`.
const BUILD_WORKTREE_PREFIX = 'build-';

export interface SweepOptions {
  /** The repo lock. The worktrees are removed through git, under it. */
  readonly repo: WorktreeLock;
  /** The `.cms` folder. */
  readonly cmsDir: string;
  readonly site: string;
  readonly log?: Logger;
  /** Deletes a folder or file with Node, when git cannot. Default: `fs.rm`, recursive and forced. */
  readonly deleteFolder?: (folder: string) => Promise<void>;
}

/** What the sweep removed, by name. A leftover that could not be removed is not listed. */
export interface SweepResult {
  /** The build worktree folders, `build-<bundleId>`. */
  readonly worktrees: readonly string[];
  /** The bundle ids of folders with no bundle.json. */
  readonly bundles: readonly string[];
  /** The entries of the `tmp` folder: the temporary index files. */
  readonly temp: readonly string[];
}

/**
 * Removes the leftovers of an earlier run from `.cms/<site>/` and returns what it removed. A build worktree goes
 * through git first (`worktreeRemove`, under the lock); when git cannot remove it, its folder is deleted with Node.
 * A missing folder has nothing to remove.
 */
export async function sweepLeftovers({
  repo,
  cmsDir,
  site,
  log = logger,
  deleteFolder = defaultDelete,
}: SweepOptions): Promise<SweepResult> {
  const siteRoot = path.join(cmsDir, site);
  const worktreesDir = path.join(siteRoot, 'worktrees');
  const worktrees: string[] = [];
  for (const name of await namesIn(worktreesDir)) {
    if (!name.startsWith(BUILD_WORKTREE_PREFIX)) continue;
    if (
      await removeWorktree(
        repo,
        name,
        path.join(worktreesDir, name),
        log,
        deleteFolder,
      )
    )
      worktrees.push(name);
  }
  const bundles = await removeIncompleteBundles(
    path.join(siteRoot, 'bundles'),
    { log },
  );
  const temp = await clearFolder(path.join(siteRoot, 'tmp'), log, deleteFolder);
  return { worktrees, bundles, temp };
}

// Removes one build worktree: git first, under the lock; then the Node delete. True when the folder is gone.
async function removeWorktree(
  repo: WorktreeLock,
  name: string,
  folder: string,
  log: Logger,
  deleteFolder: (folder: string) => Promise<void>,
): Promise<boolean> {
  try {
    await repo.locked(`sweep ${name}`, (tx) => tx.worktreeRemove(name));
    return true;
  } catch (error: unknown) {
    log.warn(
      'Git could not remove a leftover build worktree; its folder is deleted',
      { worktree: name, error: messageOf(error) },
    );
  }
  return deleteEntry(folder, name, log, deleteFolder);
}

// Removes every entry of `dir` and returns the names removed.
async function clearFolder(
  dir: string,
  log: Logger,
  deleteFolder: (folder: string) => Promise<void>,
): Promise<string[]> {
  const removed: string[] = [];
  for (const name of await namesIn(dir)) {
    if (await deleteEntry(path.join(dir, name), name, log, deleteFolder))
      removed.push(name);
  }
  return removed;
}

// Deletes one entry. True when it went; a failure is logged with the entry's name and the error.
async function deleteEntry(
  file: string,
  name: string,
  log: Logger,
  deleteFolder: (folder: string) => Promise<void>,
): Promise<boolean> {
  try {
    await deleteFolder(file);
    return true;
  } catch (error: unknown) {
    log.warn('Could not delete a leftover entry', {
      entry: name,
      error: messageOf(error),
    });
    return false;
  }
}

// The names in a folder, sorted, or none when the folder does not exist yet (a first start).
async function namesIn(dir: string): Promise<string[]> {
  return readdir(dir)
    .then((names) => names.sort())
    .catch((error: unknown) => (isMissing(error) ? [] : Promise.reject(error)));
}

// True for the error of a path that does not exist.
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function defaultDelete(folder: string): Promise<void> {
  return rm(folder, { recursive: true, force: true });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
