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

/** Reads a bundle.json's write time in ms: a number, or undefined when the file does not exist. Any other error rejects. */
export type ManifestTime = (file: string) => Promise<number | undefined>;

/** The options both collections share. Each has the real default. */
export interface BundleReadOptions {
  /** Where a bundle that cannot be read, or cannot be removed, is logged. Default: the cms-server logger. */
  readonly log?: Logger;
  /** Reads a bundle.json's write time. Default: `readManifestTime`. */
  readonly manifestTime?: ManifestTime;
}

/**
 * Keeps the newest `KEPT_BUNDLES` complete bundles and every id in `keep` (the bundle the node serves, and the last
 * good one: a rollback can make the served bundle older than the two newest), and removes everything else. Newest
 * means the latest write of the bundle's `bundle.json`. Folders without that file are removed unless they are in `keep`.
 * A bundle whose `bundle.json` cannot be read for another reason than a missing file is logged and kept: it is not
 * ranked, and it is not taken for incomplete.
 */
export async function collectBundles(
  bundlesDir: string,
  keep: ReadonlySet<string> = new Set<string>(),
  options: BundleReadOptions = {},
): Promise<void> {
  const { log = logger, manifestTime = readManifestTime } = options;
  const ids = new Set((await readdir(bundlesDir)).map(bundleIdOf));
  const complete: { id: string; written: number }[] = [];
  const unreadable = new Set<string>();
  for (const id of ids) {
    const written = await writtenAt(bundlesDir, id, log, manifestTime);
    if (written === null) unreadable.add(id);
    else if (written !== undefined) complete.push({ id, written });
  }
  complete.sort((a, b) => b.written - a.written);
  const kept = new Set(
    complete.slice(0, KEPT_BUNDLES).map((bundle) => bundle.id),
  );
  for (const id of ids) {
    if (!kept.has(id) && !keep.has(id) && !unreadable.has(id))
      await removeBundle(bundlesDir, id);
  }
}

/** The options of `removeIncompleteBundles`. Each has the real default. */
export interface IncompleteOptions extends BundleReadOptions {
  /** Removes one bundle's folders. Default: `removeBundle` in the bundles folder. */
  readonly remove?: (bundleId: string) => Promise<void>;
}

/**
 * Removes every bundle folder, and its region folder, that has no bundle.json: the leftovers of builds that did not
 * finish. Returns the ids removed. A bundle whose bundle.json cannot be read for another reason than a missing file is
 * logged with its id and error and kept, so a transient lock never deletes a complete bundle. A bundle that cannot be
 * removed is logged with its id and error, left out of the result, and the others are still removed. A missing
 * bundles folder has nothing to remove. Run at start-up only, when no build writes a folder.
 */
export async function removeIncompleteBundles(
  bundlesDir: string,
  options: IncompleteOptions = {},
): Promise<string[]> {
  const {
    log = logger,
    manifestTime = readManifestTime,
    remove = (bundleId) => removeBundle(bundlesDir, bundleId),
  } = options;
  const names = await readdir(bundlesDir).catch((error: unknown) =>
    isMissing(error) ? [] : Promise.reject(error),
  );
  const removed: string[] = [];
  for (const id of new Set(names.map(bundleIdOf))) {
    // A complete bundle (a number) and an unreadable one (null) are both kept.
    if ((await writtenAt(bundlesDir, id, log, manifestTime)) !== undefined)
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

/**
 * The write time of a bundle.json in ms, or undefined when the file does not exist. Any other stat error rejects, so a
 * file that cannot be read is never taken for a missing one. The default `manifestTime`.
 */
export function readManifestTime(file: string): Promise<number | undefined> {
  return stat(file).then(
    (info) => info.mtimeMs,
    (error: unknown) => (isMissing(error) ? undefined : Promise.reject(error)),
  );
}

// The write time of a bundle's bundle.json: a number, undefined when the bundle has none, or null when the file cannot
// be read. A null is logged here, and the caller keeps the bundle.
async function writtenAt(
  bundlesDir: string,
  bundleId: string,
  log: Logger,
  manifestTime: ManifestTime,
): Promise<number | undefined | null> {
  try {
    return await manifestTime(path.join(bundlesDir, bundleId, MANIFEST));
  } catch (error: unknown) {
    log.warn('Could not read a bundle, so it is kept', {
      bundleId,
      error: messageOf(error),
    });
    return null;
  }
}
