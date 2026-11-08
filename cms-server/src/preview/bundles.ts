// Garbage collection of the bundle folders (WORKPLAN 2.9a, PHASE-2-DESIGN 4.4). A build writes
// `<bundles>/<bundleId>/`, and its region wrappers go to the sibling `<bundles>/<bundleId>-regions/`
// (site-config.ts). The collection keeps the two newest complete bundles and the ids the caller keeps (the
// served and the last good bundle, WORKPLAN 2.9c), and removes the rest: older bundles, the folders of builds
// that did not finish, and their region folders. The newest complete bundle is the last good build, so it is one
// of the two. It runs inside the build runner, where no other build writes a folder. The start-up sweep
// (sweep.ts) uses removeIncompleteBundles.
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { type Logger, logger } from '../log.ts';

/** How many complete bundles stay. */
const KEPT_BUNDLES = 2;
const REGIONS_SUFFIX = '-regions';
// The file a finished build writes (integration.ts). A folder without it is not a complete bundle.
const MANIFEST = path.join('manifest', 'bundle.json');

/** Removes the folder of a bundle and its region folder. A missing folder is not an error. */
export async function removeBundle(
  bundlesDir: string,
  bundleId: string,
): Promise<void> {
  for (const name of [bundleId, `${bundleId}${REGIONS_SUFFIX}`]) {
    await rm(path.join(bundlesDir, name), { recursive: true, force: true });
  }
}

/**
 * Keeps the newest `KEPT_BUNDLES` complete bundles and every id in `keep` (the bundle the node serves, and the last
 * good one: a rollback can make the served bundle older than the two newest), and removes everything else. Newest
 * means the latest write of the bundle's `bundle.json`. Folders without that file are removed unless they are in `keep`.
 */
export async function collectBundles(
  bundlesDir: string,
  keep: ReadonlySet<string> = new Set<string>(),
): Promise<void> {
  const ids = new Set((await readdir(bundlesDir)).map(bundleIdOf));
  const complete: { id: string; written: number }[] = [];
  for (const id of ids) {
    const written = await mtimeOf(path.join(bundlesDir, id, MANIFEST));
    if (written !== undefined) complete.push({ id, written });
  }
  complete.sort((a, b) => b.written - a.written);
  const kept = new Set(
    complete.slice(0, KEPT_BUNDLES).map((bundle) => bundle.id),
  );
  for (const id of ids) {
    if (!kept.has(id) && !keep.has(id)) await removeBundle(bundlesDir, id);
  }
}

/** The options of `removeIncompleteBundles`. Both have the real default. */
export interface IncompleteOptions {
  /** Where a bundle that cannot be removed is logged. Default: the cms-server logger. */
  readonly log?: Logger;
  /** Removes one bundle's folders. Default: `removeBundle` in the bundles folder. */
  readonly remove?: (bundleId: string) => Promise<void>;
}

/**
 * Removes every bundle folder, and its region folder, that has no bundle.json: the leftovers of builds that did not
 * finish. Returns the ids removed. A bundle that cannot be removed is logged with its id and error, left out of the
 * result, and the others are still removed. A missing bundles folder has nothing to remove. Run at start-up only,
 * when no build writes a folder.
 */
export async function removeIncompleteBundles(
  bundlesDir: string,
  {
    log = logger,
    remove = (bundleId) => removeBundle(bundlesDir, bundleId),
  }: IncompleteOptions = {},
): Promise<string[]> {
  const names = await readdir(bundlesDir).catch((error: unknown) =>
    isMissing(error) ? [] : Promise.reject(error),
  );
  const removed: string[] = [];
  for (const id of new Set(names.map(bundleIdOf))) {
    if ((await mtimeOf(path.join(bundlesDir, id, MANIFEST))) !== undefined)
      continue;
    try {
      await remove(id);
      removed.push(id);
    } catch (error: unknown) {
      log.warn('Could not delete a leftover bundle', {
        bundleId: id,
        error: messageOf(error),
      });
    }
  }
  return removed;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// True for the error of a path that does not exist.
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

// The bundle a folder belongs to: `<id>-regions` belongs to `<id>`.
function bundleIdOf(name: string): string {
  return name.endsWith(REGIONS_SUFFIX)
    ? name.slice(0, -REGIONS_SUFFIX.length)
    : name;
}

function mtimeOf(file: string): Promise<number | undefined> {
  return stat(file).then(
    (info) => info.mtimeMs,
    () => undefined,
  );
}
