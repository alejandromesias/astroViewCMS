// Finds folders of a built preview bundle at run time, so a bundle still works
// after its folder is copied elsewhere (the portability check of SYSTEM-DESIGN
// section 12). The server code runs from <bundle>/server/ (entry.mjs and the
// chunks/ files), so the bundle folder is the nearest ancestor of the calling
// module that holds server/entry.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Returns the bundle folder above the module at `moduleUrl`: the nearest
 *  ancestor of its folder that holds `server/entry.mjs`. Throws when there is
 *  none, which means the module is not running from a bundle. */
export function bundleFolderOf(moduleUrl: string): string {
  let dir = path.dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'server', 'entry.mjs'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No preview bundle (server/entry.mjs) above ${moduleUrl}`,
      );
    }
    dir = parent;
  }
}

/** The path of `name` (for example `manifest` or `media`) inside the bundle
 *  folder that contains the module at `moduleUrl`. */
export function bundleFolder(name: string, moduleUrl: string): string {
  return path.join(bundleFolderOf(moduleUrl), name);
}
