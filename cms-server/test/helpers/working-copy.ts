// Working copies for the document reads (WORKPLAN 2.4b): a temp folder inside the workspace (cms-server/.test-tmp)
// holding the site's `src/` files. `sampleWorkingCopy` copies the files the bundle fixture was built from; `tempWorkingCopy` writes only the files given. Test code only.
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMP_ROOT = fileURLToPath(new URL('../../.test-tmp/', import.meta.url));
// The files the bundle fixture documents point at, copied from sample-site/src when the fixture was built.
// A small copy, not sample-site itself, so that the tests run inside a Stryker sandbox, which ignores sample-site.
// Refresh it with the bundle fixture.
const SAMPLE_SRC = fileURLToPath(
  new URL('../fixtures/bundle-src/src/', import.meta.url),
);

const made: string[] = [];

/** A new temp folder with a copy of the bundle fixture's source files as its `src/`. `changes` maps a path under the folder to its new text, or null to remove the file. */
export async function sampleWorkingCopy(
  changes: Record<string, string | null> = {},
): Promise<string> {
  const root = await newFolder();
  await cp(SAMPLE_SRC, join(root, 'src'), { recursive: true });
  await applyChanges(root, changes);
  return root;
}

/** A new temp folder holding only the files given, each path relative to the folder. */
export async function tempWorkingCopy(
  files: Record<string, string>,
): Promise<string> {
  const root = await newFolder();
  await applyChanges(root, files);
  return root;
}

/** Removes every folder that the helpers made. Call in afterEach. */
export async function removeWorkingCopies(): Promise<void> {
  await Promise.all(
    made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
}

/** A new empty temp folder under cms-server/.test-tmp, recorded for removeWorkingCopies. */
async function newFolder(): Promise<string> {
  await mkdir(TEMP_ROOT, { recursive: true });
  const root = await mkdtemp(join(TEMP_ROOT, 'working-copy-'));
  made.push(root);
  return root;
}

/** Writes each file of `changes` under `root` (creating its folders), or removes it when the text is null. */
async function applyChanges(
  root: string,
  changes: Record<string, string | null>,
): Promise<void> {
  for (const [file, text] of Object.entries(changes)) {
    const path = join(root, file);
    if (text === null) await rm(path);
    else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    }
  }
}
