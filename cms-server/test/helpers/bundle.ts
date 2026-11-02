// Bundle test folders (WORKPLAN 2.4a): a copy of test/fixtures/bundle in a temp folder inside the
// workspace, with some files replaced or removed. Test code only.
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The committed fixture bundle. Tests that change files copy it with bundleFolder first. */
export const FIXTURE_BUNDLE = fileURLToPath(
  new URL('../fixtures/bundle/', import.meta.url),
);
const TEMP_ROOT = fileURLToPath(new URL('../../.test-tmp/', import.meta.url));

const made: string[] = [];

/**
 * A new temp folder holding a copy of the fixture bundle. `changes` maps a
 * file name to its new text; `null` removes the file. Call once per test and
 * remove the folders with removeBundleFolders().
 */
export async function bundleFolder(
  changes: Record<string, string | null> = {},
): Promise<string> {
  await mkdir(TEMP_ROOT, { recursive: true });
  const dir = await mkdtemp(join(TEMP_ROOT, 'bundle-'));
  made.push(dir);
  await cp(FIXTURE_BUNDLE, dir, { recursive: true });
  for (const [file, text] of Object.entries(changes)) {
    if (text === null) await rm(join(dir, file));
    else await writeFile(join(dir, file), text);
  }
  return dir;
}

/** Removes every folder that bundleFolder made. Call in afterEach. */
export async function removeBundleFolders(): Promise<void> {
  await Promise.all(
    made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
}
