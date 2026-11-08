import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import type { Logger } from '../log.ts';
import {
  collectBundles,
  removeBundle,
  removeIncompleteBundles,
} from './bundles.ts';

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

  it('keeps a bundle named in keep, with its region folder, though it is older than the two newest', async () => {
    await makeBundle('served', true, 1_000_000);
    await makeBundle('b', true, 2_000_000);
    await makeBundle('c', true, 3_000_000);
    await collectBundles(bundles, new Set(['served']));
    expect((await readdir(bundles)).sort()).toEqual([
      'b',
      'b-regions',
      'c',
      'c-regions',
      'served',
      'served-regions',
    ]);
  });

  it('keeps a folder named in keep even when it did not finish, and ignores a name in keep with no folder', async () => {
    await makeBundle('x', false);
    await makeBundle('b', true, 2_000_000);
    await makeBundle('c', true, 3_000_000);
    await collectBundles(bundles, new Set(['x', 'nothing']));
    expect((await readdir(bundles)).sort()).toEqual([
      'b',
      'b-regions',
      'c',
      'c-regions',
      'x',
      'x-regions',
    ]);
  });
});

describe('removeIncompleteBundles', () => {
  it('removes the folders with no bundle.json, with their region folders, and keeps the complete ones', async () => {
    await makeBundle('partial', false);
    await makeBundle('done', true, 2_000_000);
    expect(await removeIncompleteBundles(bundles)).toEqual(['partial']);
    expect((await readdir(bundles)).sort()).toEqual(['done', 'done-regions']);
  });

  it('removes a region folder whose bundle folder is gone', async () => {
    await mkdir(path.join(bundles, 'gone-regions'));
    expect(await removeIncompleteBundles(bundles)).toEqual(['gone']);
    expect(await readdir(bundles)).toEqual([]);
  });

  it('returns nothing when the bundles folder does not exist yet', async () => {
    expect(
      await removeIncompleteBundles(path.join(bundles, 'not-yet')),
    ).toEqual([]);
  });

  it('fails when the bundles path is a file, not a folder', async () => {
    const file = path.join(root, 'plain-file');
    await writeFile(file, 'not a folder');
    await expect(removeIncompleteBundles(file)).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });

  it('logs a bundle that cannot be removed, leaves it out of the result, and still removes the other one', async () => {
    await makeBundle('a-stuck', false);
    await makeBundle('b-other', false);
    const warnings: { message: string; fields: unknown }[] = [];
    const log: Logger = {
      info: () => undefined,
      error: () => undefined,
      warn: (message, fields) => {
        warnings.push({ message, fields });
      },
    };
    const removed = await removeIncompleteBundles(bundles, {
      log,
      remove: async (bundleId) => {
        if (bundleId === 'a-stuck')
          throw new Error('locked by another process');
        await removeBundle(bundles, bundleId);
      },
    });
    expect(removed).toEqual(['b-other']);
    expect((await readdir(bundles)).sort()).toEqual([
      'a-stuck',
      'a-stuck-regions',
    ]);
    expect(warnings).toEqual([
      {
        message: 'Could not delete a leftover bundle',
        fields: { bundleId: 'a-stuck', error: 'locked by another process' },
      },
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
