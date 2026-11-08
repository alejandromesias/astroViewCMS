import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { revisionOf } from 'preview-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bundleFolder,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import { git, makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { saveRepoIn, silentLog } from '../../test/helpers/repo.ts';
import {
  bundleOf,
  fakeTx,
  previewSays,
  saveContext,
} from '../../test/helpers/save-context.ts';
import { BundleError } from '../bundle/read.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import { createBundleStore } from '../bundle/store.ts';
import { writeFileAtomic } from '../fs/atomic.ts';
import type { Repo, RepoTx } from '../git/ops.ts';
import type { SaveChange } from './body.ts';
import { checkRevisions } from './conflicts.ts';
import type { DeleteGuard, SaveStage, SaveStop } from './context.ts';
import { checkDeleteGuard, createDeleteGuard } from './delete-guard.ts';
import { runStages, SAVE_STAGES, saveChanges } from './pipeline.ts';
import { planChanges } from './plan.ts';
import { validateChanges } from './validate.ts';
import { writeChanges } from './write.ts';

const folders: string[] = [];

afterEach(async () => {
  await removeBundleFolders();
  await Promise.all(folders.splice(0).map((folder) => removeTestRoot(folder)));
});

// A repo whose lock records the holder and runs the work with `tx`. The reads are not used by these tests.
function lockedRepo(tx: RepoTx, holders: string[]): Repo {
  return {
    locked<T>(holder: string, work: (tx: RepoTx) => Promise<T>): Promise<T> {
      holders.push(holder);
      return work(tx);
    },
    changedPaths: async () => [],
    showAt: async () => null,
    showAtBytes: async () => null,
    mergeBase: async () => 'base',
    overwrittenSince: async () => new Map(),
  };
}

// The inputs of a save that the stages do not need to read, over a bundle store of `current`.
function inputOf(
  changes: SaveChange[],
  current: () => Promise<ReturnType<typeof bundleOf> | null>,
) {
  return {
    changes,
    bundles: { current },
    siteFolder: 'unused-site',
    config: { collections: {} },
    preview: previewSays(),
    media: {
      mediaFile: 'unused-media.json',
      cmsOrigin: 'http://cms.localhost:4400',
    },
    log: silentLog(),
    guard: createDeleteGuard(),
  };
}

describe('SAVE_STAGES', () => {
  it('runs the revision check, the delete guard, the planning, the validation and the write, in that order', () => {
    expect(SAVE_STAGES).toStrictEqual([
      checkRevisions,
      checkDeleteGuard,
      planChanges,
      validateChanges,
      writeChanges,
    ]);
  });
});

describe('the delete guard in a save', () => {
  it("hands the save its guard, and runs the guard hook after the commit, before the save's own hooks", async () => {
    const order: string[] = [];
    const guard: DeleteGuard = {
      indexOf: vi.fn(),
      applySave: vi.fn(() => {
        order.push('guard');
      }),
    };
    let seen: DeleteGuard | undefined;
    const own = vi.fn(async () => {
      order.push('own');
    });
    const answer = await saveChanges(
      { ...inputOf([], async () => bundleOf([])), guard, afterCommit: [own] },
      lockedRepo(fakeTx(), []),
      {
        stages: [
          (ctx) => {
            seen = ctx.guard;
            return Promise.resolve(undefined);
          },
          writeChanges,
        ],
      },
    );
    expect(answer.status).toBe(200);
    expect(seen).toBe(guard);
    expect(order).toStrictEqual(['guard', 'own']);
  });
});

describe('runStages', () => {
  it('answers with the first stop, and runs no later stage', async () => {
    const later = vi.fn(async () => undefined);
    const stop: SaveStop = { status: 409, body: { error: 'conflict' } };
    const answer = await runStages(saveContext(), [
      async () => undefined,
      async () => stop,
      later,
    ]);
    expect(answer).toBe(stop);
    expect(later).not.toHaveBeenCalled();
  });

  it('answers 200 with the revisions, no warnings and the rebuild flag when no stage stops', async () => {
    const order: string[] = [];
    const first: SaveStage = async () => {
      order.push('first');
      return undefined;
    };
    const second: SaveStage = async (ctx) => {
      order.push('second');
      ctx.revisions.set('authors/ana', 'rev');
      ctx.rebuild = true;
      return undefined;
    };
    expect(await runStages(saveContext(), [first, second])).toStrictEqual({
      status: 200,
      body: {
        revisions: { 'authors/ana': 'rev' },
        warnings: [],
        rebuild: true,
      },
    });
    expect(order).toStrictEqual(['first', 'second']);
  });
});

// A document upstream added after the bundle was built, which the CMS then edited on cms/work (2.10h). The save deletes
// it and creates it again: the recreate has no document in the save (its deletion left a tombstone), so it is a create
// and writes the file (save/plan.ts `writeOf`).
describe('a document upstream added and the bundle lacks (2.10h)', () => {
  it('creates it again after a save deleted it, and writes the file', async () => {
    const root = await makeTestRoot();
    folders.push(root);
    const upstream = '{"name":"Upstream"}\n';
    const { repo, state, config } = await saveRepoIn(root, {
      'src/content/authors/new-one.json': upstream,
    });
    const bundles = createBundleStore(
      directoryBundleSource(await bundleFolder()),
    );
    const file = join(state.siteFolder, 'src/content/authors/new-one.json');
    const save = (changes: SaveChange[]) =>
      saveChanges(
        {
          changes,
          bundles,
          siteFolder: state.siteFolder,
          config,
          preview: previewSays(),
          media: {
            mediaFile: join(root, 'media.json'),
            cmsOrigin: 'http://cms.localhost:4400',
          },
          log: silentLog(),
          guard: createDeleteGuard(),
        },
        repo,
      );
    // The re-applied edit: the CMS version of the upstream document is on cms/work, as a sync leaves it.
    const edited = '{"name":"Edited"}\n';
    await writeFile(file, edited);
    await repo.locked('save', (tx) =>
      tx.commitSave(['src/content/authors/new-one.json'], 'cms: edit new-one'),
    );
    const deleted = await save([
      {
        document: 'authors/new-one',
        baseRevision: revisionOf(edited),
        deleted: true,
        data: {},
      },
    ]);
    expect(deleted.status).toBe(200);
    const recreated = await save([
      {
        document: 'authors/new-one',
        baseRevision: null,
        deleted: false,
        data: { name: 'Recreated' },
      },
    ]);
    expect(recreated.status).toBe(200);
    expect(JSON.parse(await readFile(file, 'utf8'))).toStrictEqual({
      name: 'Recreated',
    });
  }, 30_000);
});

describe('saveChanges', () => {
  it('runs the stages inside the repo lock, under the holder "save"', async () => {
    const holders: string[] = [];
    const tx = fakeTx();
    let seen: unknown;
    const answer = await saveChanges(
      inputOf([], async () => bundleOf([])),
      lockedRepo(tx, holders),
      {
        stages: [
          (ctx) => {
            seen = ctx.tx;
            return Promise.resolve(undefined);
          },
        ],
      },
    );
    expect(holders).toStrictEqual(['save']);
    expect(seen).toBe(tx);
    expect(answer).toStrictEqual({
      status: 200,
      body: { revisions: {}, warnings: [], rebuild: false },
    });
  });

  it('answers 503 no-bundle, without running a stage, when there is no bundle', async () => {
    const stage = vi.fn(async () => undefined);
    expect(
      await saveChanges(
        inputOf([], async () => null),
        lockedRepo(fakeTx(), []),
        { stages: [stage] },
      ),
    ).toStrictEqual({ status: 503, body: { error: 'no-bundle' } });
    expect(stage).not.toHaveBeenCalled();
  });

  it('answers 500 bundle-invalid when the bundle does not parse', async () => {
    expect(
      await saveChanges(
        inputOf([], () =>
          Promise.reject(new BundleError('bundle.json', 'is not valid JSON')),
        ),
        lockedRepo(fakeTx(), []),
        { stages: [] },
      ),
    ).toStrictEqual({
      status: 500,
      body: {
        error: 'bundle-invalid',
        message: 'bundle.json: is not valid JSON',
      },
    });
  });

  it('rethrows a bundle read that fails with something other than a bundle error', async () => {
    const failure = new Error('disk gone');
    await expect(
      saveChanges(
        inputOf([], () => Promise.reject(failure)),
        lockedRepo(fakeTx(), []),
        { stages: [] },
      ),
    ).rejects.toBe(failure);
  });

  it('restores the working copy from HEAD when a write fails, so no part of the save is kept', async () => {
    const root = await makeTestRoot();
    folders.push(root);
    const { repo, state, config } = await saveRepoIn(root);
    const bundleDir = await bundleFolder();
    const bundles = createBundleStore(directoryBundleSource(bundleDir));
    const anaPath = join(
      state.siteFolder,
      'src/content/authors/ana-torres.json',
    );
    const before = await readFile(anaPath, 'utf8');
    const parsed: { name: string } = JSON.parse(before);
    const answer = await saveChanges(
      {
        changes: [
          {
            document: 'authors/ana-torres',
            baseRevision: revisionOf(before),
            deleted: false,
            data: { ...parsed, name: 'Ana T.' },
          },
          {
            document: 'authors/new-one',
            baseRevision: null,
            deleted: false,
            data: { name: 'New one' },
          },
        ],
        bundles,
        siteFolder: state.siteFolder,
        config,
        preview: previewSays(),
        media: {
          mediaFile: join(root, 'media.json'),
          cmsOrigin: 'http://cms.localhost:4400',
        },
        log: silentLog(),
        guard: createDeleteGuard(),
      },
      repo,
      {
        writeFile: async (file, text) => {
          if (file.endsWith('new-one.json')) throw new Error('disk full');
          await writeFileAtomic(file, text);
        },
      },
    );
    expect(answer).toStrictEqual({
      status: 500,
      body: {
        error: 'save-failed',
        message: 'The save was not written: disk full',
      },
    });
    expect(await readFile(anaPath, 'utf8')).toBe(before);
    expect(await git(state.repoDir, ['status', '--porcelain'])).toBe('');
    // Real git and disk writes: under the full run's load on Windows this ran past the 5 s default (q8).
  }, 30_000);
});
