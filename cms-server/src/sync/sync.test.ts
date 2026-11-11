import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bundleFolder,
  FIXTURE_BUNDLE,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import {
  cloneRemote,
  commitAndPush,
  git,
  makeTestRoot,
  removeTestRoot,
} from '../../test/helpers/git.ts';
import { saveRepoIn, silentLog } from '../../test/helpers/repo.ts';
import type { Bundle } from '../bundle/read.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import { type BundleStore, createBundleStore } from '../bundle/store.ts';
import type { CmsConfig } from '../config/schema.ts';
import type { RenamedDocument } from '../documents/reapply.ts';
import { LockTimeoutError } from '../git/mutex.ts';
import type {
  FetchOriginResult,
  FetchResult,
  ReapplyResult,
  Repo,
  RepoTx,
} from '../git/ops.ts';
import { type RepoState, WORK, WORK_REF } from '../git/repo.ts';
import type { RecheckInput } from '../save/context.ts';
import { createDeleteGuard } from '../save/delete-guard.ts';
import { createSync, type SyncTx } from './sync.ts';

// Each test makes its own remote and clone, so one test may take a few git calls.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// The clock of the lastSync field: a fixed instant, so the status value is exact.
const NOW = new Date('2026-11-10T12:00:00.000Z');
const NOW_TEXT = '2026-11-10T12:00:00.000Z';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTestRoot(root)));
  await removeBundleFolders();
});

// What a test needs from a real clone: the operations, the config, the clone's state and a bundle store that reads the
// bundle built on the seed commit.
interface Fixture {
  readonly root: string;
  readonly repo: Repo;
  readonly state: RepoState;
  readonly config: CmsConfig;
  readonly store: BundleStore;
}

// A clone of a new remote, with the bundle fixture's site, and a bundle built on the seed commit. The bundle's documents
// are the fixture's, so an upstream change to a post is classified as content-only.
async function fixtureIn(): Promise<Fixture> {
  const root = await makeTestRoot();
  roots.push(root);
  const { repo, state, config } = await saveRepoIn(root);
  const seed = (await git(state.repoDir, ['rev-parse', 'origin/main'])).trim();
  const dir = await bundleFolder({
    'bundle.json': bundleJson('sync-base', seed),
  });
  return {
    root,
    repo,
    state,
    config,
    store: createBundleStore(directoryBundleSource(dir)),
  };
}

// The bundle.json of a bundle with this id and siteCommit.
function bundleJson(bundleId: string, siteCommit: string): string {
  return `${JSON.stringify({ bundleId, siteCommit, protocolVersion: 2, astroVersion: '7.4.2', builtAt: '2026-11-04T03:42:22.323Z' }, null, 2)}\n`;
}

// The text of a site file as it is in the working copy now.
function textOf(siteFolder: string, file: string): Promise<string> {
  return readFile(join(siteFolder, file), 'utf8');
}

// The text of a post with its author line set to `author`. The bundle fixture's posts name the author on one line.
function withAuthor(text: string, author: string): string {
  return text.replace(/^author: .*$/m, `author: ${author}`);
}

// Makes a save on cms/work, as the save route does: each path gets its text (or is removed when the text is null), then
// the paths are committed alone.
async function saveOn(
  fixture: Fixture,
  edits: Record<string, string | null>,
): Promise<void> {
  for (const [file, text] of Object.entries(edits)) {
    const target = join(fixture.state.siteFolder, file);
    if (text === null) await rm(target);
    else await writeFile(target, text);
  }
  await fixture.repo.locked('save', (tx) =>
    tx.commitSave(Object.keys(edits), 'save: the CMS user'),
  );
}

// The saves of the scenario: the author Ana is deleted, and the two posts that named her name Kofi instead. Each save
// clears the reference, as the guard requires. Returns the text of blog-1 before the saves, for a post upstream adds.
async function deleteAna(fixture: Fixture): Promise<string> {
  const site = fixture.state.siteFolder;
  const blog1 = await textOf(site, 'src/content/blog/blog-1.md');
  await saveOn(fixture, {
    'src/content/authors/ana-torres.json': null,
    'src/content/blog/blog-1.md': withAuthor(blog1, 'kofi-mensah'),
    'src/content/blog/blog-3.md': withAuthor(
      await textOf(site, 'src/content/blog/blog-3.md'),
      'kofi-mensah',
    ),
  });
  return blog1;
}

// A second person's clone that pushes `files` (site-relative) to origin.
async function pushUpstream(
  fixture: Fixture,
  files: Record<string, string>,
  message: string,
): Promise<void> {
  const dir = await cloneRemote(
    fixture.config.remote,
    join(fixture.root, 'upstream'),
  );
  const prefixed = Object.fromEntries(
    Object.entries(files).map(([file, text]) => [`site/${file}`, text]),
  );
  await commitAndPush(dir, prefixed, message);
}

// A bundle store whose current bundle is the one of `folder`.
function storeOf(folder: string): BundleStore {
  return createBundleStore(directoryBundleSource(folder));
}

// The recheck's input: the bundle of `store`, and the clone's reads of its changeset.
async function recheckOf(
  fixture: Fixture,
  store: BundleStore,
): Promise<RecheckInput> {
  const bundle: Bundle | null = await store.current();
  if (bundle === null) throw new Error('the test bundle is missing');
  return {
    bundle,
    repo: fixture.repo,
    siteFolder: fixture.state.siteFolder,
    config: fixture.config,
    log: silentLog(),
  };
}

// The 409 that the recheck gives for the author Ana, with these referrers.
function anaReferredBy(referrers: readonly string[]) {
  return {
    status: 409,
    body: {
      error: 'referenced-by',
      document: 'authors/ana-torres',
      referrers,
    },
  };
}

// The status setters of a sync, as spies.
function statusSpy() {
  return {
    setLastSync: vi.fn(),
    setSyncError: vi.fn(),
    setRenamed: vi.fn(),
  };
}

describe('syncNow on a real clone (2.10c, both paths of the done-when)', () => {
  it('reports no change when origin has not moved: no re-apply, no build, cms/work as the head', async () => {
    const fixture = await fixtureIn();
    const status = statusSpy();
    const trigger = vi.fn();
    const sync = createSync({
      repo: fixture.repo,
      bundles: fixture.store,
      guard: { invalidate: vi.fn() },
      status,
      trigger,
      now: () => NOW,
    });
    expect(await sync.syncNow()).toStrictEqual({
      kind: 'synced',
      change: 'none',
      tip: await fixture.repo.revParse(WORK),
      renamed: [],
    });
    expect(trigger).not.toHaveBeenCalled();
    expect(status.setLastSync).toHaveBeenCalledWith(NOW_TEXT);
    expect(status.setSyncError).toHaveBeenCalledWith(null);
    expect(status.setRenamed).not.toHaveBeenCalled();
  });

  it('(a) a content-only upstream change that cites a deleted author: the guard is invalidated, and the recheck answers referenced-by', async () => {
    const fixture = await fixtureIn();
    await deleteAna(fixture);
    const guard = createDeleteGuard();
    // Before the sync the index holds no reference to Ana: nothing answers.
    expect(
      await guard.recheck(await recheckOf(fixture, fixture.store)),
    ).toBeUndefined();

    const blog2 = await textOf(
      fixture.state.siteFolder,
      'src/content/blog/blog-2.md',
    );
    await pushUpstream(
      fixture,
      { 'src/content/blog/blog-2.md': withAuthor(blog2, 'ana-torres') },
      'upstream: blog-2 names Ana',
    );
    const trigger = vi.fn();
    const sync = createSync({
      repo: fixture.repo,
      bundles: fixture.store,
      guard,
      status: statusSpy(),
      trigger,
      now: () => NOW,
    });
    expect(await sync.syncNow()).toStrictEqual({
      kind: 'synced',
      change: 'content-only',
      tip: await fixture.repo.revParse(WORK),
      renamed: [],
    });
    expect(trigger).not.toHaveBeenCalled();
    expect(
      await guard.recheck(await recheckOf(fixture, fixture.store)),
    ).toStrictEqual(anaReferredBy(['blog/blog-2']));
  });

  it('(b) an upstream push that adds a post citing the deleted author: sync-code is asked, and the recheck of the new bundle answers referenced-by', async () => {
    const fixture = await fixtureIn();
    const seed = (
      await git(fixture.state.repoDir, ['rev-parse', 'origin/main'])
    ).trim();
    const blog1 = await deleteAna(fixture);
    await pushUpstream(
      fixture,
      { 'src/content/blog/blog-new.md': blog1 },
      'upstream: a new post names Ana',
    );
    // The new bundle is built from cms/work, so it lacks the deleted author; it holds the new post.
    const documents = JSON.parse(
      await readFile(join(FIXTURE_BUNDLE, 'documents.json'), 'utf8'),
    ) as Record<string, unknown>[];
    const nextDir = await bundleFolder({
      'bundle.json': bundleJson('sync-next', seed),
      'documents.json': JSON.stringify([
        ...documents.filter((entry) => entry.key !== 'authors/ana-torres'),
        {
          key: 'blog/blog-new',
          file: 'src/content/blog/blog-new.md',
          format: 'md',
          buildTime: false,
          revision: '0123456789abcdef',
        },
      ]),
    });
    // The served bundle is swapped from the base to the new one after the sync, as the lifecycle does.
    let served = fixture.store;
    const bundles: BundleStore = { current: () => served.current() };
    const guard = createDeleteGuard();
    const trigger = vi.fn();
    const sync = createSync({
      repo: fixture.repo,
      bundles,
      guard,
      status: statusSpy(),
      trigger,
      now: () => NOW,
    });
    expect(await sync.syncNow()).toStrictEqual({
      kind: 'synced',
      change: 'code',
      tip: await fixture.repo.revParse(WORK),
      renamed: [],
    });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('sync-code');

    served = storeOf(nextDir);
    expect(await guard.recheck(await recheckOf(fixture, served))).toStrictEqual(
      anaReferredBy(['blog/blog-new']),
    );
  });
});

describe('the sync routine, with fakes', () => {
  // A transaction whose calls are spies. The defaults are a sync with no change.
  function txOf(parts: Partial<SyncTx> = {}): SyncTx {
    return {
      fetch: vi.fn(
        async (): Promise<FetchResult> => ({
          ok: true,
          upstream: 'upstream-sha',
          reapply: false,
          change: 'none',
          paths: [],
        }),
      ),
      reapply: vi.fn(
        async (): Promise<ReapplyResult> => ({
          tip: 'reapplied-sha',
          renamed: [],
        }),
      ),
      revParse: vi.fn(async () => 'head-sha'),
      ...parts,
    };
  }

  // A repo whose `locked` runs its work with `tx`, and whose `fetchOrigin` answers `origin.current`. It counts the takes, and it
  // throws when a take starts while one is held.
  function repoOf(
    tx: SyncTx,
    origin: { current: FetchOriginResult } = {
      current: { ok: true, upstream: 'upstream-sha' },
    },
  ): {
    repo: Pick<Repo, 'locked' | 'fetchOrigin'>;
    takes: () => number;
  } {
    let held = false;
    let count = 0;
    return {
      takes: () => count,
      repo: {
        locked: async (holder, work) => {
          if (held)
            throw new Error(`${holder} took the lock while it was held`);
          held = true;
          count += 1;
          try {
            return await work(tx as RepoTx);
          } finally {
            held = false;
          }
        },
        fetchOrigin: async () => origin.current,
      },
    };
  }

  // A sync over the fakes, with its spies.
  function syncOver(tx: SyncTx, repo: Pick<Repo, 'locked' | 'fetchOrigin'>) {
    const status = statusSpy();
    const guard = { invalidate: vi.fn() };
    const trigger = vi.fn();
    const sync = createSync({
      repo,
      bundles: { current: vi.fn(async () => null) },
      guard,
      status,
      trigger,
      now: () => NOW,
    });
    return { sync, status, guard, trigger, tx };
  }

  it('syncNow takes the lock once, and the sync inside it takes none', async () => {
    const tx = txOf();
    const { repo, takes } = repoOf(tx);
    const { sync } = syncOver(tx, repo);
    expect(await sync.syncNow()).toStrictEqual({
      kind: 'synced',
      change: 'none',
      tip: 'head-sha',
      renamed: [],
    });
    expect(takes()).toBe(1);
  });

  it('syncLocked runs inside a lock the caller holds, and takes none itself', async () => {
    const tx = txOf();
    const { repo, takes } = repoOf(tx);
    const { sync } = syncOver(tx, repo);
    const outcome = await repo.locked('publish', (held) =>
      sync.syncLocked(held),
    );
    expect(outcome).toStrictEqual({
      kind: 'synced',
      change: 'none',
      tip: 'head-sha',
      renamed: [],
    });
    expect(takes()).toBe(1);
  });

  it('skips the tick when the lock times out: no error, no status change, no back-off signal', async () => {
    const repo: Pick<Repo, 'locked' | 'fetchOrigin'> = {
      locked: async () => {
        throw new LockTimeoutError('publish', 30_000);
      },
      fetchOrigin: async () => ({ ok: true, upstream: 'upstream-sha' }),
    };
    const { sync, status, trigger } = syncOver(txOf(), repo);
    expect(await sync.syncNow()).toStrictEqual({ kind: 'skipped' });
    expect(status.setLastSync).not.toHaveBeenCalled();
    expect(status.setSyncError).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('rethrows an error of the lock that is not a timeout', async () => {
    const repo: Pick<Repo, 'locked' | 'fetchOrigin'> = {
      locked: async () => {
        throw new Error('the clone is gone');
      },
      fetchOrigin: async () => ({ ok: true, upstream: 'upstream-sha' }),
    };
    const { sync } = syncOver(txOf(), repo);
    await expect(sync.syncNow()).rejects.toThrow('the clone is gone');
  });

  it('syncNow fetches with no lock, and takes the lock only while origin moved since the last sync', async () => {
    const tx = txOf();
    const origin = {
      current: { ok: true, upstream: 'sha-1' } as FetchOriginResult,
    };
    const { repo, takes } = repoOf(tx, origin);
    const { sync, status } = syncOver(tx, repo);
    expect((await sync.syncNow()).kind).toBe('synced');
    expect(takes()).toBe(1);
    // The integration fetched without a second network fetch: the probe already did it.
    expect(tx.fetch).toHaveBeenCalledWith(expect.anything(), { remote: false });
    expect(await sync.syncNow()).toStrictEqual({ kind: 'unchanged' });
    expect(takes()).toBe(1);
    expect(status.setLastSync).toHaveBeenCalledTimes(2);
    origin.current = { ok: true, upstream: 'sha-2' };
    expect((await sync.syncNow()).kind).toBe('synced');
    expect(takes()).toBe(2);
  });

  it('a failed origin fetch is a failed sync: its message is the status error, it takes no lock, and nothing else moves', async () => {
    const tx = txOf();
    const origin = {
      current: {
        ok: false,
        syncError: { kind: 'failed', message: 'git fetch failed: offline' },
      } as FetchOriginResult,
    };
    const { repo, takes } = repoOf(tx, origin);
    const { sync, status, guard, trigger } = syncOver(tx, repo);
    expect(await sync.syncNow()).toStrictEqual({
      kind: 'failed',
      message: 'git fetch failed: offline',
    });
    expect(takes()).toBe(0);
    expect(status.setSyncError).toHaveBeenCalledWith(
      'git fetch failed: offline',
    );
    expect(status.setLastSync).not.toHaveBeenCalled();
    expect(tx.reapply).not.toHaveBeenCalled();
    expect(guard.invalidate).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('a failed integration is not remembered: the next tick takes the lock and tries again', async () => {
    const tx = txOf({
      fetch: vi
        .fn<SyncTx['fetch']>()
        .mockResolvedValueOnce({
          ok: false,
          syncError: { kind: 'failed', message: 'git fetch failed: busy' },
        })
        .mockResolvedValue({
          ok: true,
          upstream: 'upstream-sha',
          reapply: false,
          change: 'none',
          paths: [],
        }),
    });
    const { repo, takes } = repoOf(tx);
    const { sync } = syncOver(tx, repo);
    expect(await sync.syncNow()).toStrictEqual({
      kind: 'failed',
      message: 'git fetch failed: busy',
    });
    expect((await sync.syncNow()).kind).toBe('synced');
    expect(takes()).toBe(2);
  });

  it('syncLocked fetches over the network by default, as publish needs', async () => {
    const tx = txOf();
    const { repo } = repoOf(tx);
    const { sync } = syncOver(tx, repo);
    await repo.locked('publish', (held) => sync.syncLocked(held));
    expect(tx.fetch).toHaveBeenCalledWith(expect.anything(), { remote: true });
  });

  it('a failed fetch is a failed sync: its message is the status error, and nothing else moves', async () => {
    const tx = txOf({
      fetch: vi.fn(
        async (): Promise<FetchResult> => ({
          ok: false,
          syncError: { kind: 'failed', message: 'git fetch failed: offline' },
        }),
      ),
    });
    const { sync, status, guard, trigger } = syncOver(tx, repoOf(tx).repo);
    expect(await sync.syncLocked(tx)).toStrictEqual({
      kind: 'failed',
      message: 'git fetch failed: offline',
    });
    expect(status.setSyncError).toHaveBeenCalledWith(
      'git fetch failed: offline',
    );
    expect(status.setLastSync).not.toHaveBeenCalled();
    expect(tx.reapply).not.toHaveBeenCalled();
    expect(guard.invalidate).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('a re-apply that throws is a failed sync, with the error as the status text', async () => {
    const tx = txOf({
      fetch: vi.fn(
        async (): Promise<FetchResult> => ({
          ok: true,
          upstream: 'upstream-sha',
          reapply: true,
          change: 'code',
          paths: [],
        }),
      ),
      reapply: vi.fn(async (): Promise<ReapplyResult> => {
        throw new Error('There is no bundle to re-apply the saves on.');
      }),
    });
    const { sync, status, guard, trigger } = syncOver(tx, repoOf(tx).repo);
    expect(await sync.syncLocked(tx)).toStrictEqual({
      kind: 'failed',
      message: 'There is no bundle to re-apply the saves on.',
    });
    expect(status.setSyncError).toHaveBeenCalledWith(
      'There is no bundle to re-apply the saves on.',
    );
    expect(status.setLastSync).not.toHaveBeenCalled();
    expect(status.setRenamed).not.toHaveBeenCalled();
    expect(guard.invalidate).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('a re-apply invalidates the guard and sets the renamed documents of its result', async () => {
    const renamed: RenamedDocument[] = [
      {
        key: 'blog/a',
        from: 'src/content/blog/a.md',
        to: 'src/content/blog/b.md',
      },
    ];
    const tx = txOf({
      fetch: vi.fn(
        async (): Promise<FetchResult> => ({
          ok: true,
          upstream: 'upstream-sha',
          reapply: true,
          change: 'content-only',
          paths: [],
        }),
      ),
      reapply: vi.fn(
        async (): Promise<ReapplyResult> => ({ tip: 'reapplied-sha', renamed }),
      ),
    });
    const { sync, status, guard, trigger } = syncOver(tx, repoOf(tx).repo);
    expect(await sync.syncLocked(tx)).toStrictEqual({
      kind: 'synced',
      change: 'content-only',
      tip: 'reapplied-sha',
      renamed,
    });
    expect(tx.reapply).toHaveBeenCalledWith('upstream-sha', expect.anything());
    expect(guard.invalidate).toHaveBeenCalledTimes(1);
    expect(status.setRenamed).toHaveBeenCalledWith(renamed);
    expect(status.setSyncError).toHaveBeenCalledWith(null);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('a code change asks for a sync-code build, once', async () => {
    const tx = txOf({
      fetch: vi.fn(
        async (): Promise<FetchResult> => ({
          ok: true,
          upstream: 'upstream-sha',
          reapply: true,
          change: 'code',
          paths: [],
        }),
      ),
    });
    const { sync, trigger } = syncOver(tx, repoOf(tx).repo);
    await sync.syncLocked(tx);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('sync-code');
  });

  it('without a re-apply it keeps the renamed list of the status, and uses the head of cms/work', async () => {
    const tx = txOf();
    const { sync, status, guard } = syncOver(tx, repoOf(tx).repo);
    expect(await sync.syncLocked(tx)).toStrictEqual({
      kind: 'synced',
      change: 'none',
      tip: 'head-sha',
      renamed: [],
    });
    expect(tx.revParse).toHaveBeenCalledWith(WORK_REF);
    expect(tx.reapply).not.toHaveBeenCalled();
    expect(guard.invalidate).not.toHaveBeenCalled();
    expect(status.setRenamed).not.toHaveBeenCalled();
  });

  it('records lastSync with the real clock when none is injected', async () => {
    const tx = txOf();
    const status = statusSpy();
    const sync = createSync({
      repo: repoOf(tx).repo,
      bundles: { current: vi.fn(async () => null) },
      guard: { invalidate: vi.fn() },
      status,
      trigger: vi.fn(),
    });
    await sync.syncLocked(tx);
    expect(status.setLastSync).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    );
  });
});
