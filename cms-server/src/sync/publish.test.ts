import type { FieldError, MediaInfo } from 'preview-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bundleOf,
  fakeTx,
  MEDIA,
  MEDIA_CONFIG,
} from '../../test/helpers/save-context.ts';
import { BundleError } from '../bundle/read.ts';
import type { BundleStore } from '../bundle/store.ts';
import type { ChangedDocument, Changeset } from '../documents/changeset.ts';
import { LockTimeoutError } from '../git/mutex.ts';
import type { RepoTx } from '../git/ops.ts';
import type { PushResult } from '../git/push.ts';
import { MAX_BODY_BYTES } from '../http/changes-routes.ts';
import type { Logger } from '../log.ts';
import { PreviewUnavailableError } from '../preview/client.ts';
import { createStatus, type Status } from '../preview/status.ts';
import type { PreviewClient, SaveStop } from '../save/context.ts';
import {
  type Builds,
  createPublish,
  type PublishAnswer,
  validateInBatches,
} from './publish.ts';
import type { SyncOutcome } from './sync.ts';

afterEach(() => {
  vi.clearAllMocks();
});

const UPSTREAM = 'u'.repeat(40);
const BASE = 'b'.repeat(40);

// A changed document that holds a value, with the fields of the changeset a test sets.
function changed(
  key: string,
  value: unknown,
  extra: Partial<ChangedDocument> = {},
): ChangedDocument {
  return { key, status: 'modified', baseRevision: 'rev', value, ...extra };
}

function changesetOf(...documents: ChangedDocument[]): Changeset {
  return { documents, createdRecords: [], fileErrors: [] };
}

const synced = (
  overrides: Partial<SyncOutcome & { kind: 'synced' }> = {},
): SyncOutcome => ({
  kind: 'synced',
  change: 'none',
  tip: 'tip',
  renamed: [],
  upstream: UPSTREAM,
  ...overrides,
});

function spyLog(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface RigOptions {
  /** The changeset the working copy gives, per read (the last one repeats). */
  readonly changesets?: readonly Changeset[];
  /** The outcomes of the syncs, per call (the last one repeats). */
  readonly syncs?: readonly SyncOutcome[];
  readonly hasSavedChanges?: boolean;
  /** The answers of `tx.squash`, per call. The default makes `c1`, `c2`, ... */
  readonly squashes?: readonly (string | null)[];
  /** The answers of `tx.push`, per call (the last one repeats). */
  readonly pushes?: readonly PushResult[];
  /** Whether the wait for idle succeeds. */
  readonly idle?: boolean;
  /** Whether the lifecycle is busy when the second lock is taken (a save started a rebuild). */
  readonly busyAfterWait?: boolean;
  readonly recheck?: SaveStop | undefined;
  readonly validate?: PreviewClient['validate'];
  /** The lock takes (1-based) that time out. */
  readonly lockTimeouts?: readonly number[];
  readonly bundle?: 'none' | 'invalid' | 'ok';
  readonly squashThrows?: unknown;
  readonly maxBatchBytes?: number;
  readonly buildWaitMs?: number;
  /** Whether a builder runs (the default). */
  readonly builderOn?: boolean;
}

function rig(options: RigOptions = {}) {
  const events: string[] = [];
  let held = false;
  let takes = 0;
  const log = spyLog();
  const status: Status = createStatus({
    builder: 'on',
    node: () => ({
      state: 'ready',
      port: 4401,
      bundleId: null,
      failures: 0,
      error: null,
    }),
    changedPaths: async () => [],
  });
  let squashes = 0;
  let pushes = 0;
  let syncs = 0;
  let reads = 0;
  const tx: RepoTx = fakeTx({
    hasSavedChanges: vi.fn(async () => {
      events.push('hasSavedChanges');
      return options.hasSavedChanges ?? true;
    }),
    squash: vi.fn(async (message: string) => {
      events.push(`squash:${message}`);
      if (options.squashThrows !== undefined) throw options.squashThrows;
      squashes += 1;
      return options.squashes === undefined
        ? `c${squashes}`
        : (options.squashes[squashes - 1] ?? null);
    }),
    push: vi.fn(async (commit: string) => {
      events.push(`push:${commit}`);
      const list = options.pushes ?? [{ ok: true }];
      const answer = list[Math.min(pushes, list.length - 1)] ?? { ok: true };
      pushes += 1;
      return answer;
    }),
    resetWork: vi.fn(async (commit: string) => {
      events.push(`reset:${commit}`);
    }),
  });
  const repo = {
    locked: async <T>(
      holder: string,
      work: (tx: RepoTx) => Promise<T>,
    ): Promise<T> => {
      takes += 1;
      if (options.lockTimeouts?.includes(takes))
        throw new LockTimeoutError('save', 30_000);
      held = true;
      events.push(`lock:${holder}`);
      try {
        return await work(tx);
      } finally {
        held = false;
        events.push('unlock');
      }
    },
    changesetReader: vi.fn(async () => {
      events.push('reader');
      return {
        changedPaths: async () => [],
        mergeBase: async () => BASE,
        showAtBytes: async () => null,
        overwrittenSince: async () => new Map<string, string>(),
      };
    }),
    mergeBase: vi.fn(async () => BASE),
  };
  const bundle = bundleOf([]);
  const bundles: BundleStore = {
    current: vi.fn(async () => {
      if (options.bundle === 'none') return null;
      if (options.bundle === 'invalid')
        throw new BundleError('documents.json', 'is not valid');
      return bundle;
    }),
  };
  const preview: PreviewClient = {
    validate: vi.fn(options.validate ?? (async () => [])),
  };
  const guard = {
    recheck: vi.fn(async () => {
      events.push('recheck');
      return options.recheck;
    }),
    invalidate: vi.fn(() => {
      events.push('invalidate');
    }),
  };
  const statusDuring: unknown[] = [];
  const syncLocked = vi.fn(async (): Promise<SyncOutcome> => {
    events.push('sync');
    statusDuring.push((await status.snapshot()).publish);
    const list = options.syncs ?? [synced()];
    const outcome = list[Math.min(syncs, list.length - 1)] ?? synced();
    syncs += 1;
    return outcome;
  });
  const builds: Builds = {
    busy: vi.fn(() => {
      events.push('busy?');
      return options.busyAfterWait ?? false;
    }),
    waitForIdle: vi.fn(async () => {
      events.push(`waitForIdle(lock held: ${held})`);
      return options.idle ?? true;
    }),
  };
  const trigger = vi.fn((reason: 'publish') => {
    events.push(`trigger:${reason}`);
  });
  const list = options.changesets ?? [
    changesetOf(changed('notes/a', { title: 'A' })),
  ];
  const readChangeset = vi.fn(async () => {
    const changeset = list[Math.min(reads, list.length - 1)] ?? changesetOf();
    reads += 1;
    return changeset;
  });
  const publish = createPublish({
    repo,
    bundles,
    siteFolder: 'unused-site',
    config: { collections: {}, media: MEDIA_CONFIG },
    preview,
    media: MEDIA,
    guard,
    syncLocked,
    status,
    builds,
    builderOn: options.builderOn ?? true,
    trigger,
    log,
    readChangeset,
    ...(options.maxBatchBytes === undefined
      ? {}
      : { maxBatchBytes: options.maxBatchBytes }),
    ...(options.buildWaitMs === undefined
      ? {}
      : { buildWaitMs: options.buildWaitMs }),
  });
  return {
    publish,
    events,
    status,
    tx,
    repo,
    preview,
    guard,
    syncLocked,
    builds,
    trigger,
    log,
    bundles,
    statusDuring,
  };
}

const OK = { ok: true } as const;
const RACE: PushResult = {
  ok: false,
  race: true,
  message: 'rejected (fetch first)',
};

describe('createPublish: the order of a publish', () => {
  it('syncs under a lock, releases it to wait, then rechecks, validates, squashes, pushes and resets under a second lock', async () => {
    const { publish, events } = rig();
    const answer = await publish();
    expect(answer).toStrictEqual({
      status: 200,
      body: { commit: 'c1', overwritten: [], renamed: [] },
    });
    expect(events).toStrictEqual([
      'lock:publish',
      'sync',
      'hasSavedChanges',
      'unlock',
      'waitForIdle(lock held: false)',
      'lock:publish',
      'busy?',
      'reader',
      'recheck',
      'squash:cms: publish 1 documents',
      'push:c1',
      'reset:c1',
      'invalidate',
      'trigger:publish',
      'unlock',
    ]);
  });

  it('waits up to 120 seconds by default, and up to the given time otherwise', async () => {
    const first = rig();
    await first.publish();
    expect(first.builds.waitForIdle).toHaveBeenCalledWith(120_000);
    const second = rig({ buildWaitMs: 5_000 });
    await second.publish();
    expect(second.builds.waitForIdle).toHaveBeenCalledWith(5_000);
  });

  it('validates the values of the changeset once, with the media map, before it squashes', async () => {
    const { publish, preview, events } = rig({
      changesets: [
        changesetOf(
          changed('notes/a', { title: 'A' }),
          changed('notes/b', 'text'),
        ),
      ],
    });
    await publish();
    expect(preview.validate).toHaveBeenCalledTimes(1);
    expect(preview.validate).toHaveBeenCalledWith(
      { 'notes/a': { title: 'A' }, 'notes/b': 'text' },
      {},
    );
    expect(events.indexOf('squash:cms: publish 2 documents')).toBeGreaterThan(
      events.indexOf('recheck'),
    );
  });

  it('sends the keys of content as plain keys: __proto__, constructor and toString', async () => {
    const { publish, preview } = rig({
      changesets: [
        changesetOf(
          changed('__proto__', { a: 1 }),
          changed('constructor', { b: 2 }),
          changed('toString', { c: 3 }),
        ),
      ],
    });
    await publish();
    const sent = vi.mocked(preview.validate).mock.calls[0]?.[0] ?? {};
    expect(Object.keys(sent)).toStrictEqual([
      '__proto__',
      'constructor',
      'toString',
    ]);
    expect(Object.getPrototypeOf(sent)).toBe(Object.prototype);
  });

  it('does not send a deleted document or one that cannot be read, and sends nothing when nothing is left', async () => {
    const { publish, preview } = rig({
      changesets: [
        changesetOf(
          { key: 'notes/gone', status: 'deleted', baseRevision: 'rev' },
          {
            key: 'notes/broken',
            status: 'modified',
            baseRevision: 'rev',
            error: { code: 'invalid', message: 'bad yaml' },
          },
        ),
      ],
    });
    const answer = await publish();
    expect(preview.validate).not.toHaveBeenCalled();
    expect(answer.status).toBe(200);
  });

  it('sends a value that is falsy but defined: null, 0 and the empty string', async () => {
    const { publish, preview } = rig({
      changesets: [
        changesetOf(changed('a', null), changed('b', 0), changed('c', '')),
      ],
    });
    await publish();
    expect(preview.validate).toHaveBeenCalledWith({ a: null, b: 0, c: '' }, {});
  });
});

describe('createPublish: what it answers', () => {
  it('200: the pushed commit, the overwritten documents in key order, and the renamed documents', async () => {
    const renamed = [{ key: 'blog/a', from: 'a.md', to: 'b.md' }];
    const { publish, events, status, preview } = rig({
      changesets: [
        changesetOf(
          changed('notes/b', 'B', { overwritten: 'sha-b' }),
          changed('notes/a', 'A', { overwritten: 'sha-a' }),
          changed('notes/c', 'C'),
        ),
      ],
    });
    status.setRenamed(renamed);
    const answer = await publish();
    expect(answer).toStrictEqual({
      status: 200,
      body: {
        commit: 'c1',
        overwritten: [
          { key: 'notes/a', commit: 'sha-a' },
          { key: 'notes/b', commit: 'sha-b' },
        ],
        renamed,
      },
    });
    expect(events).toContain(
      'squash:cms: publish 3 documents (overwrote notes/a from sha-a, notes/b from sha-b)',
    );
    expect(preview.validate).toHaveBeenCalledTimes(1);
    expect((await status.snapshot()).renamed).toStrictEqual([]);
  });

  it('names no overwrite in the message when none happened, and counts one document as documents', async () => {
    const { publish, events } = rig();
    await publish();
    expect(events).toContain('squash:cms: publish 1 documents');
  });

  it('logs the commit and the number of documents', async () => {
    const { publish, log } = rig();
    await publish();
    expect(log.info).toHaveBeenCalledWith('published', {
      commit: 'c1',
      documents: 1,
    });
  });

  it('after a success it resets cms/work to the pushed commit, invalidates the guard and triggers the publish build once', async () => {
    const { publish, tx, guard, trigger } = rig();
    await publish();
    expect(tx.resetWork).toHaveBeenCalledTimes(1);
    expect(tx.resetWork).toHaveBeenCalledWith('c1');
    expect(guard.invalidate).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('publish');
  });

  it('answers 200 with commit null for an empty changeset after the sync, resets cms/work to the origin tip and builds nothing', async () => {
    const { publish, events, tx, trigger, builds, status, preview } = rig({
      hasSavedChanges: false,
    });
    status.setRenamed([{ key: 'old', from: 'a', to: 'b' }]);
    const answer = await publish();
    expect(answer).toStrictEqual({
      status: 200,
      body: { commit: null, overwritten: [], renamed: [] },
    });
    expect(events).toStrictEqual([
      'lock:publish',
      'sync',
      'hasSavedChanges',
      `reset:${UPSTREAM}`,
      'unlock',
    ]);
    expect(tx.squash).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect(builds.waitForIdle).not.toHaveBeenCalled();
    expect(preview.validate).not.toHaveBeenCalled();
    expect(status.getRenamed()).toStrictEqual([]);
  });

  it('answers 200 with commit null when the saves turned out empty while it waited, and resets to the base', async () => {
    const { publish, tx, trigger, repo, status } = rig({ squashes: [null] });
    const answer = await publish();
    expect(answer).toStrictEqual({
      status: 200,
      body: { commit: null, overwritten: [], renamed: [] },
    });
    expect(repo.mergeBase).toHaveBeenCalledTimes(1);
    expect(tx.resetWork).toHaveBeenCalledWith(BASE);
    expect(tx.push).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('409 with the body of the guard when a deleted document is still referenced, and nothing is validated or pushed', async () => {
    const referenced: SaveStop = {
      status: 409,
      body: {
        error: 'referenced-by',
        document: 'authors/ana',
        referrers: ['posts/one'],
      },
    };
    const { publish, preview, tx, status } = rig({ recheck: referenced });
    const answer = await publish();
    expect(answer).toStrictEqual(referenced);
    expect(preview.validate).not.toHaveBeenCalled();
    expect(tx.squash).not.toHaveBeenCalled();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('422 with the validate error shape, a refinement that threw not counted, and nothing pushed', async () => {
    const errors: FieldError[] = [
      { key: 'notes/a', path: ['title'], message: 'Required', kind: 'invalid' },
      {
        key: 'notes/a',
        path: ['slug'],
        message: 'threw',
        kind: 'refinement-threw',
      },
    ];
    const { publish, tx, status } = rig({ validate: async () => errors });
    const answer = await publish();
    expect(answer).toStrictEqual({
      status: 422,
      body: {
        error: 'invalid',
        errors: [{ key: 'notes/a', path: ['title'], message: 'Required' }],
      },
    });
    expect(tx.squash).not.toHaveBeenCalled();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('a refinement that threw alone does not block the publish', async () => {
    const { publish } = rig({
      validate: async () => [
        {
          key: 'notes/a',
          path: [],
          message: 'threw',
          kind: 'refinement-threw',
        },
      ],
    });
    expect((await publish()).status).toBe(200);
  });

  it('503 preview-unavailable with the message of the client when the node cannot check', async () => {
    const { publish, tx, status, log } = rig({
      validate: async () => {
        throw new PreviewUnavailableError(
          'The preview build failed: bad component',
          500,
        );
      },
    });
    const answer = await publish();
    expect(answer).toStrictEqual({
      status: 503,
      body: {
        error: 'preview-unavailable',
        message: 'The preview build failed: bad component',
      },
    });
    expect(tx.squash).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      'the preview node did not check the save',
      {
        reason: 'The preview build failed: bad component',
        status: 500,
      },
    );
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('503 no-bundle without a bundle, and idle', async () => {
    const { publish, status } = rig({ bundle: 'none' });
    expect(await publish()).toStrictEqual({
      status: 503,
      body: { error: 'no-bundle' },
    });
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('500 bundle-invalid when the bundle does not parse, and failed with its message', async () => {
    const { publish, status } = rig({ bundle: 'invalid' });
    expect(await publish()).toStrictEqual({
      status: 500,
      body: {
        error: 'bundle-invalid',
        message: 'documents.json: is not valid',
      },
    });
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'failed',
      error: 'documents.json: is not valid',
    });
  });
});

describe('createPublish: builds', () => {
  it('503 build-in-progress when the wait runs out; nothing else runs under a second lock', async () => {
    const { publish, events, status } = rig({ idle: false });
    const answer = await publish();
    expect(answer).toStrictEqual({
      status: 503,
      body: {
        error: 'build-in-progress',
        message:
          'The preview is still being rebuilt, so the changes cannot be checked yet. Nothing was published. Try again once the build is done.',
      },
    });
    expect(events.filter((event) => event === 'lock:publish')).toHaveLength(1);
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('503 build-in-progress, with no second wait, when a save started another rebuild while the lock was free', async () => {
    const { publish, builds, events, tx, status, preview } = rig({
      busyAfterWait: true,
    });
    const answer = await publish();
    expect(answer.status).toBe(503);
    expect(answer).toMatchObject({ body: { error: 'build-in-progress' } });
    expect(builds.waitForIdle).toHaveBeenCalledTimes(1);
    expect(events).toContain('busy?');
    expect(preview.validate).not.toHaveBeenCalled();
    expect(tx.squash).not.toHaveBeenCalled();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('waits for the builds even when the sync found no code change', async () => {
    const { publish, builds } = rig({
      syncs: [synced({ change: 'content-only' })],
    });
    await publish();
    expect(builds.waitForIdle).toHaveBeenCalledTimes(1);
  });
});

describe('createPublish: a retry whose sync changes the code', () => {
  it('answers 503 build-in-progress instead of pushing a changeset that was validated against the old code', async () => {
    const { publish, tx, preview, trigger, status, syncLocked, guard } = rig({
      pushes: [RACE, OK],
      syncs: [synced(), synced({ change: 'code' })],
    });
    const answer = await publish();
    expect(answer).toStrictEqual({
      status: 503,
      body: {
        error: 'build-in-progress',
        message:
          'The preview is still being rebuilt, so the changes cannot be checked yet. Nothing was published. Try again once the build is done.',
      },
    });
    expect(syncLocked).toHaveBeenCalledTimes(2);
    // One push, no second squash; the saves are not reset, and no publish build is asked for.
    expect(tx.push).toHaveBeenCalledTimes(1);
    expect(tx.squash).toHaveBeenCalledTimes(1);
    expect(tx.resetWork).not.toHaveBeenCalled();
    expect(guard.invalidate).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect(preview.validate).toHaveBeenCalledTimes(1);
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('with the builder off it keeps the status and the code, but says no build is waited for', async () => {
    const { publish, tx, trigger, status } = rig({
      builderOn: false,
      pushes: [RACE, OK],
      syncs: [synced(), synced({ change: 'code' })],
    });
    const answer = await publish();
    expect(answer).toStrictEqual({
      status: 503,
      body: {
        error: 'build-in-progress',
        message:
          'The upstream code changed while the publish ran, so nothing was published. Try again.',
      },
    });
    expect(tx.push).toHaveBeenCalledTimes(1);
    expect(tx.resetWork).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('with the builder off, the other 503 build-in-progress keeps its text: it only comes from a build that runs', async () => {
    const { publish } = rig({ builderOn: false, idle: false });
    expect(await publish()).toMatchObject({
      status: 503,
      body: {
        error: 'build-in-progress',
        message:
          'The preview is still being rebuilt, so the changes cannot be checked yet. Nothing was published. Try again once the build is done.',
      },
    });
  });

  it('stops before it reads the changeset again', async () => {
    const { publish, guard } = rig({
      pushes: [RACE],
      syncs: [synced(), synced({ change: 'code' })],
    });
    await publish();
    expect(guard.recheck).toHaveBeenCalledTimes(1);
  });

  it.each(['none', 'content-only'] as const)(
    'a %s change keeps the retry going: it pushes again and publishes',
    async (change) => {
      const { publish, tx } = rig({
        pushes: [RACE, OK],
        syncs: [synced(), synced({ change })],
      });
      expect(await publish()).toMatchObject({
        status: 200,
        body: { commit: 'c2' },
      });
      expect(tx.push).toHaveBeenCalledTimes(2);
    },
  );

  it('a code change in the first sync does not stop the publish: the wait covers that rebuild', async () => {
    const { publish, builds } = rig({
      syncs: [synced({ change: 'code' })],
    });
    expect(await publish()).toMatchObject({ status: 200 });
    expect(builds.waitForIdle).toHaveBeenCalledTimes(1);
  });
});

describe('createPublish: the push', () => {
  it('a refused push syncs again and pushes again: the second commit is the one that is reset, announced and returned', async () => {
    const { publish, events, log, syncLocked, preview, guard, trigger, tx } =
      rig({
        pushes: [RACE, OK],
      });
    const answer = await publish();
    expect(answer).toMatchObject({ status: 200, body: { commit: 'c2' } });
    expect(syncLocked).toHaveBeenCalledTimes(2);
    expect(guard.recheck).toHaveBeenCalledTimes(2);
    // The values are validated once, before the first push; a retry does not validate again.
    expect(preview.validate).toHaveBeenCalledTimes(1);
    expect(tx.resetWork).toHaveBeenCalledTimes(1);
    expect(tx.resetWork).toHaveBeenCalledWith('c2');
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'the remote moved during a publish, so it syncs and pushes again',
      {
        retry: 1,
        commit: 'c1',
      },
    );
    expect(events.slice(events.indexOf('push:c1'))).toStrictEqual([
      'push:c1',
      'sync',
      'reader',
      'recheck',
      'squash:cms: publish 1 documents',
      'push:c2',
      'reset:c2',
      'invalidate',
      'trigger:publish',
      'unlock',
    ]);
  });

  it('the message of the retry comes from the changeset after the sync: a new overwrite is named', async () => {
    const { publish, events } = rig({
      pushes: [RACE, OK],
      changesets: [
        changesetOf(changed('notes/a', 'A')),
        changesetOf(changed('notes/a', 'A', { overwritten: 'dev-sha' })),
      ],
    });
    const answer = await publish();
    expect(events).toContain('squash:cms: publish 1 documents');
    expect(events).toContain(
      'squash:cms: publish 1 documents (overwrote notes/a from dev-sha)',
    );
    expect(answer).toMatchObject({
      body: { overwritten: [{ key: 'notes/a', commit: 'dev-sha' }] },
    });
  });

  it('retries at most 3 times: 4 pushes, then 502 with nothing reset or built, and the status failed', async () => {
    const { publish, tx, trigger, syncLocked, status, guard } = rig({
      pushes: [RACE],
    });
    const answer = await publish();
    const message =
      'The remote branch moved on each of 4 pushes, so nothing was published. The saved changes are kept. Try again in a moment.';
    expect(answer).toStrictEqual({
      status: 502,
      body: { error: 'push-rejected', message },
    });
    expect(tx.push).toHaveBeenCalledTimes(4);
    expect(syncLocked).toHaveBeenCalledTimes(4);
    expect(tx.resetWork).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect(guard.invalidate).not.toHaveBeenCalled();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'failed',
      error: message,
    });
  });

  it('succeeds on the last retry', async () => {
    const { publish, tx } = rig({ pushes: [RACE, RACE, RACE, OK] });
    expect(await publish()).toMatchObject({
      status: 200,
      body: { commit: 'c4' },
    });
    expect(tx.push).toHaveBeenCalledTimes(4);
  });

  it('any other refusal is an immediate 502 with git’s message, one push only', async () => {
    const { publish, tx, syncLocked, status, trigger } = rig({
      pushes: [
        { ok: false, race: false, message: 'git push failed: hook declined' },
      ],
    });
    const answer = await publish();
    const message =
      'The remote refused the push, so nothing was published: git push failed: hook declined';
    expect(answer).toStrictEqual({
      status: 502,
      body: { error: 'push-failed', message },
    });
    expect(tx.push).toHaveBeenCalledTimes(1);
    expect(syncLocked).toHaveBeenCalledTimes(1);
    expect(tx.resetWork).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'failed',
      error: message,
    });
  });

  it('hides the credentials of a remote in a failure message', async () => {
    const { publish } = rig({
      pushes: [
        {
          ok: false,
          race: false,
          message: 'cannot reach https://user:secret@example.test/r.git',
        },
      ],
    });
    const answer = await publish();
    expect(JSON.stringify(answer)).not.toContain('secret');
    expect(JSON.stringify(answer)).toContain('https://***@example.test/r.git');
  });

  it('a retry whose changeset turned out empty answers 200 with commit null', async () => {
    const { publish, tx } = rig({ pushes: [RACE], squashes: ['c1', null] });
    expect(await publish()).toStrictEqual({
      status: 200,
      body: { commit: null, overwritten: [], renamed: [] },
    });
    expect(tx.resetWork).toHaveBeenCalledWith(BASE);
  });

  it('a retry whose recheck finds a new referrer answers 409', async () => {
    const referenced: SaveStop = {
      status: 409,
      body: {
        error: 'referenced-by',
        document: 'authors/ana',
        referrers: ['posts/new'],
      },
    };
    const { publish, guard, tx } = rig({ pushes: [RACE] });
    vi.mocked(guard.recheck)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(referenced);
    expect(await publish()).toStrictEqual(referenced);
    expect(tx.push).toHaveBeenCalledTimes(1);
  });
});

describe('createPublish: a sync that fails', () => {
  const failedSync: SyncOutcome = {
    kind: 'failed',
    message: 'could not resolve host',
  };

  it('stops before anything else with 502, and the status is failed', async () => {
    const { publish, builds, tx, status } = rig({ syncs: [failedSync] });
    const answer = await publish();
    const message =
      'The site could not be brought up to date with the remote, so nothing was published: could not resolve host';
    expect(answer).toStrictEqual({
      status: 502,
      body: { error: 'sync-failed', message },
    });
    expect(tx.hasSavedChanges).not.toHaveBeenCalled();
    expect(builds.waitForIdle).not.toHaveBeenCalled();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'failed',
      error: message,
    });
  });

  it('during a retry it answers 502 too, and the saves stay as they are', async () => {
    const { publish, tx } = rig({
      pushes: [RACE],
      syncs: [synced(), failedSync],
    });
    const answer = await publish();
    expect(answer).toMatchObject({
      status: 502,
      body: { error: 'sync-failed' },
    });
    expect(tx.push).toHaveBeenCalledTimes(1);
    expect(tx.resetWork).not.toHaveBeenCalled();
  });
});

describe('createPublish: the lock times out', () => {
  it.each([
    [1, 'the first lock, before the sync'],
    [2, 'the second lock, after the wait'],
  ])(
    'lock take %i (%s) answers 503 busy and leaves the status idle',
    async (take) => {
      const { publish, status } = rig({ lockTimeouts: [take] });
      expect(await publish()).toStrictEqual({
        status: 503,
        body: {
          error: 'busy',
          message:
            'The site is busy with another operation (save). Try again in a moment.',
        },
      });
      expect((await status.snapshot()).publish).toStrictEqual({
        state: 'idle',
        error: null,
      });
    },
  );
});

describe('createPublish: an unexpected error', () => {
  it('answers 500 publish-failed with the message, logs it and sets the status failed', async () => {
    const { publish, status, log } = rig({
      squashThrows: new Error('boom at C:\\secret'),
    });
    const answer = await publish();
    const message = 'Publishing failed unexpectedly: boom at C:\\secret';
    expect(answer).toStrictEqual({
      status: 500,
      body: { error: 'publish-failed', message },
    });
    expect(log.error).toHaveBeenCalledWith('a publish failed unexpectedly', {
      error: message,
    });
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'failed',
      error: message,
    });
  });

  it('reads a thrown value that is not an Error as text', async () => {
    const { publish } = rig({ squashThrows: 'plain text' });
    expect(await publish()).toStrictEqual({
      status: 500,
      body: {
        error: 'publish-failed',
        message: 'Publishing failed unexpectedly: plain text',
      },
    });
  });

  it('does not log a failure it answers itself as unexpected', async () => {
    const { publish, log } = rig({
      pushes: [{ ok: false, race: false, message: 'denied' }],
    });
    await publish();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('createPublish: the publish status', () => {
  it('is publishing while the publish runs, with no error', async () => {
    const { publish, statusDuring } = rig();
    await publish();
    expect(statusDuring).toStrictEqual([{ state: 'publishing', error: null }]);
  });

  it('is idle with no error after a success', async () => {
    const { publish, status } = rig();
    await publish();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });

  it('keeps a failure until the next publish starts, which clears it', async () => {
    const failing = { kind: 'failed', message: 'down' } as const;
    const { publish, status, statusDuring } = rig({
      syncs: [failing, synced()],
    });
    await publish();
    expect((await status.snapshot()).publish.state).toBe('failed');
    await publish();
    // The second publish was publishing with no error, though the first one failed.
    expect(statusDuring).toStrictEqual([
      { state: 'publishing', error: null },
      { state: 'publishing', error: null },
    ]);
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });
});

describe('createPublish: a changeset over the body cap (2.10d item 6)', () => {
  it('is validated in more than one call, each under the cap, and the errors of every call come back', async () => {
    const big = 'x'.repeat(1.5 * 1024 * 1024);
    const bodies: number[] = [];
    const { publish, preview, tx } = rig({
      changesets: [
        changesetOf(
          changed('docs/one', big),
          changed('docs/two', big),
          changed('docs/three', big),
        ),
      ],
      validate: async (documents, media) => {
        bodies.push(Buffer.byteLength(JSON.stringify({ documents, media })));
        return Object.keys(documents).map(
          (key): FieldError => ({
            key,
            path: ['body'],
            message: `bad ${key}`,
            kind: 'invalid',
          }),
        );
      },
    });
    const answer = await publish();
    expect(
      vi
        .mocked(preview.validate)
        .mock.calls.map(([documents]) => Object.keys(documents)),
    ).toStrictEqual([['docs/one', 'docs/two'], ['docs/three']]);
    for (const size of bodies) expect(size).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(answer).toStrictEqual({
      status: 422,
      body: {
        error: 'invalid',
        errors: [
          { key: 'docs/one', path: ['body'], message: 'bad docs/one' },
          { key: 'docs/two', path: ['body'], message: 'bad docs/two' },
          { key: 'docs/three', path: ['body'], message: 'bad docs/three' },
        ],
      },
    });
    expect(tx.squash).not.toHaveBeenCalled();
  });

  it('uses the batch size it is given', async () => {
    const { publish, preview } = rig({
      changesets: [changesetOf(changed('a', 'x'), changed('b', 'y'))],
      maxBatchBytes: 27 + 10,
    });
    await publish();
    expect(preview.validate).toHaveBeenCalledTimes(2);
  });

  it('answers 503 when a later batch cannot be checked', async () => {
    let calls = 0;
    const { publish, tx } = rig({
      changesets: [changesetOf(changed('a', 'x'), changed('b', 'y'))],
      maxBatchBytes: 27 + 10,
      validate: async () => {
        calls += 1;
        if (calls === 2) throw new PreviewUnavailableError('node stopped');
        return [];
      },
    });
    expect(await publish()).toMatchObject({
      status: 503,
      body: { error: 'preview-unavailable', message: 'node stopped' },
    });
    expect(tx.squash).not.toHaveBeenCalled();
  });
});

describe('validateInBatches', () => {
  const NO_MEDIA: Record<string, MediaInfo> = {};
  // `{"documents":{},"media":{}}` is 27 bytes; the entry "a":"xxxx", is 11.
  const ENVELOPE = 27;
  const entries = [
    ['a', 'xxxx'],
    ['b', 'xxxx'],
    ['c', 'xxxx'],
  ] as const;

  function previewRecording(): { preview: PreviewClient; calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      preview: {
        validate: async (documents) => {
          calls.push(Object.keys(documents));
          return [];
        },
      },
    };
  }

  it('puts as many documents in a call as fit: the size that fits exactly is one call', async () => {
    const { preview, calls } = previewRecording();
    await validateInBatches(preview, entries, NO_MEDIA, ENVELOPE + 11 + 11);
    expect(calls).toStrictEqual([['a', 'b'], ['c']]);
  });

  it('splits one byte earlier: the size one byte short is a call for each', async () => {
    const { preview, calls } = previewRecording();
    await validateInBatches(preview, entries, NO_MEDIA, ENVELOPE + 11 + 11 - 1);
    expect(calls).toStrictEqual([['a'], ['b'], ['c']]);
  });

  it('keeps all in one call when they fit', async () => {
    const { preview, calls } = previewRecording();
    await validateInBatches(preview, entries, NO_MEDIA, ENVELOPE + 33);
    expect(calls).toStrictEqual([['a', 'b', 'c']]);
  });

  it('counts bytes, not characters', async () => {
    const { preview, calls } = previewRecording();
    // "éé" is 6 bytes (4 characters): the entry costs 11 bytes, and two of them need 49.
    await validateInBatches(
      preview,
      [
        ['a', 'éé'],
        ['b', 'éé'],
      ],
      NO_MEDIA,
      48,
    );
    expect(calls).toStrictEqual([['a'], ['b']]);
  });

  it('counts the key as well as the value', async () => {
    const { preview, calls } = previewRecording();
    // A key of 10 characters costs 12 bytes with its quotes: the entry is 20, and two need 27 + 40.
    await validateInBatches(
      preview,
      [
        ['k'.repeat(10), 'xxxx'],
        ['m'.repeat(10), 'xxxx'],
      ],
      NO_MEDIA,
      27 + 39,
    );
    expect(calls).toHaveLength(2);
  });

  it('counts the media map in the size of every call, and sends it with every call', async () => {
    const media: Record<string, MediaInfo> = {
      '/m/a.png': {
        url: 'https://cms.example.test/m/a.png',
        width: 1,
        height: 1,
        format: 'png',
      },
    };
    const envelope = Buffer.byteLength(
      JSON.stringify({ documents: {}, media }),
    );
    const seen: unknown[] = [];
    const preview: PreviewClient = {
      validate: async (_documents, sent) => {
        seen.push(sent);
        return [];
      },
    };
    await validateInBatches(preview, entries, media, envelope + 11 + 11);
    expect(seen).toStrictEqual([media, media]);
    seen.length = 0;
    await validateInBatches(preview, entries, media, envelope + 11 + 11 - 1);
    expect(seen).toHaveLength(3);
  });

  it('gives a document that is over the cap alone a call of its own, between the others', async () => {
    const { preview, calls } = previewRecording();
    await validateInBatches(
      preview,
      [
        ['a', 'xxxx'],
        ['big', 'y'.repeat(100)],
        ['c', 'xxxx'],
      ],
      NO_MEDIA,
      60,
    );
    expect(calls).toStrictEqual([['a'], ['big'], ['c']]);
  });

  it('gives a first document that is over the cap a call of its own, with no empty call before it', async () => {
    const { preview, calls } = previewRecording();
    await validateInBatches(
      preview,
      [
        ['big', 'y'.repeat(100)],
        ['a', 'xxxx'],
      ],
      NO_MEDIA,
      60,
    );
    expect(calls).toStrictEqual([['big'], ['a']]);
  });

  it('merges the errors of the calls in call order', async () => {
    const preview: PreviewClient = {
      validate: async (documents) =>
        Object.keys(documents).map(
          (key): FieldError => ({
            key,
            path: [],
            message: key,
            kind: 'invalid',
          }),
        ),
    };
    const errors = await validateInBatches(
      preview,
      entries,
      NO_MEDIA,
      ENVELOPE + 11,
    );
    expect(errors.map((error) => error.key)).toStrictEqual(['a', 'b', 'c']);
  });

  it('makes no call for no documents', async () => {
    const { preview, calls } = previewRecording();
    await expect(
      validateInBatches(preview, [], NO_MEDIA, 100),
    ).resolves.toStrictEqual([]);
    expect(calls).toStrictEqual([]);
  });

  it('lets a rejection of the node through', async () => {
    const preview: PreviewClient = {
      validate: async () => {
        throw new PreviewUnavailableError('down');
      },
    };
    await expect(
      validateInBatches(preview, entries, NO_MEDIA, 1000),
    ).rejects.toThrow('down');
  });
});

describe('the answer type', () => {
  it('is accepted by a route: status and body of every answer', async () => {
    const { publish } = rig();
    const answer: PublishAnswer = await publish();
    expect(answer.status).toBe(200);
  });
});
