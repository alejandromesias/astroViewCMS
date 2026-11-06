// Garbage collection of the bundle folders (WORKPLAN 2.9a, PHASE-2-DESIGN 4.4). A build writes
// `<bundles>/<bundleId>/`, and its region wrappers go to the sibling `<bundles>/<bundleId>-regions/`
// (site-config.ts). The collection keeps the two newest complete bundles and removes the rest: older
// bundles, the folders of builds that did not finish, and their region folders. The newest complete
// bundle is the last good build, so it is one of the two. It runs inside the build runner, where no
// other build writes a folder.
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

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
 * Keeps the newest `KEPT_BUNDLES` complete bundles in `bundlesDir` and removes everything else. Newest
 * means the latest write of the bundle's `bundle.json`. Folders without that file are removed.
 */
export async function collectBundles(bundlesDir: string): Promise<void> {
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
    if (!kept.has(id)) await removeBundle(bundlesDir, id);
  }
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
