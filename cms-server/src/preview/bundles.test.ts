import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { collectBundles, removeBundle } from './bundles.ts';

let root: string;
let bundles: string;

beforeEach(async () => {
  root = await makeTestRoot();
  bundles = path.join(root, 'bundles');
  await mkdir(bundles);
});

afterEach(async () => {
  await removeTestRoot(root);
});

// One build's folders: `<id>/` with its region folder `<id>-regions/`. A complete bundle has a bundle.json,
// written at `writtenMs`.
async function makeBundle(
  id: string,
  complete: boolean,
  writtenMs = 0,
): Promise<void> {
  await mkdir(path.join(bundles, id, 'manifest'), { recursive: true });
  await mkdir(path.join(bundles, `${id}-regions`));
  if (!complete) return;
  const file = path.join(bundles, id, 'manifest', 'bundle.json');
  await writeFile(file, '{}\n');
  const time = new Date(writtenMs);
  await utimes(file, time, time);
}

describe('collectBundles', () => {
  it('keeps the two newest complete bundles with their region folders, and removes the rest', async () => {
    await makeBundle('a', true, 1_000_000);
    await makeBundle('b', true, 2_000_000);
    await makeBundle('c', true, 3_000_000);
    await collectBundles(bundles);
    expect((await readdir(bundles)).sort()).toEqual([
      'b',
      'b-regions',
      'c',
      'c-regions',
    ]);
  });

  it('removes the folder of a build that did not finish', async () => {
    await makeBundle('x', false);
    await makeBundle('b', true, 2_000_000);
    await makeBundle('c', true, 3_000_000);
    await collectBundles(bundles);
    expect((await readdir(bundles)).sort()).toEqual([
      'b',
      'b-regions',
      'c',
      'c-regions',
    ]);
  });

  it('removes a folder that did not finish even when it sorts before the complete ones', async () => {
    await makeBundle('a-partial', false);
    await makeBundle('b', true, 2_000_000);
    await makeBundle('c', true, 3_000_000);
    await collectBundles(bundles);
    expect((await readdir(bundles)).sort()).toEqual([
      'b',
      'b-regions',
      'c',
      'c-regions',
    ]);
  });

  it('removes a region folder whose bundle folder is gone', async () => {
    await mkdir(path.join(bundles, 'gone-regions'));
    await makeBundle('b', true, 2_000_000);
    await collectBundles(bundles);
    expect((await readdir(bundles)).sort()).toEqual(['b', 'b-regions']);
  });

  it('judges the age of a bundle by when its bundle.json was written, not by its name', async () => {
    await makeBundle('a', true, 3_000_000);
    await makeBundle('b', true, 1_000_000);
    await makeBundle('c', true, 2_000_000);
    await collectBundles(bundles);
    expect((await readdir(bundles)).sort()).toEqual([
      'a',
      'a-regions',
      'c',
      'c-regions',
    ]);
  });
});

describe('removeBundle', () => {
  it('removes a bundle with its region folder, and a missing bundle is not an error', async () => {
    await makeBundle('a', true, 1_000_000);
    await removeBundle(bundles, 'a');
    await removeBundle(bundles, 'missing');
    expect(await readdir(bundles)).toEqual([]);
  });
});
