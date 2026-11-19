// The event-order harness of 2.10l (WORKPLAN 2.10l item 5, 2.10e-STATE-TABLE sections 3 to 5). It runs the real save, poll
// and publish functions over an in-memory repo. Git is a model (`origin` and `cms/work`), the lock is the real mutex on an
// injected clock, and a build is a point where the publish waits until the harness releases it. The curated scenarios are
// the cells of the table that need no candidate build (2.10m). The seeded random runs draw sequences of events and check
// the invariants after every step; a failure names its seed and step.
import type { PublishAnswer } from 'cms-contract';
import type { FieldError } from 'preview-protocol';
import { describe, expect, it } from 'vitest';
import { silentLog } from '../../test/helpers/repo.ts';
import {
  bundleOf,
  emptyChangeset,
  fakeTx,
  MEDIA,
  MEDIA_CONFIG,
} from '../../test/helpers/save-context.ts';
import type { ChangedDocument, Changeset } from '../documents/changeset.ts';
import { createMutex } from '../git/mutex.ts';
import type { Repo, RepoTx, FetchResult, ReapplyResult } from '../git/ops.ts';
import type { PushResult } from '../git/push.ts';
import { PreviewUnavailableError } from '../preview/client.ts';
import { createStatus } from '../preview/status.ts';
import type { PreviewClient, SaveAnswer } from '../save/context.ts';
import { createDeleteGuard } from '../save/delete-guard.ts';
import { saveChanges } from '../save/pipeline.ts';
import { type Builds, createPublish } from './publish.ts';
import { createPublishGate, type PublishGate } from './publish-gate.ts';
import { createSync, type SyncNowOutcome } from './sync.ts';

/** The points where a publish can wait: its sync (A), its validation (A), the build (W) and its push (P). */
type Point = 'fetch' | 'validate' | 'wait' | 'push';

const SAVE_REFUSED = {
  status: 409,
  body: {
    error: 'publish-in-progress',
    message:
      'A publish is running, so nothing was saved or published by this request. Try again once it is done.',
  },
} as const;

const PUBLISH_REFUSED = {
  status: 409,
  body: SAVE_REFUSED.body,
} as const;

const BUILD_WAITING = {
  status: 503,
  body: {
    error: 'build-in-progress',
    message:
      'The preview is still being rebuilt, so the changes cannot be checked yet. Nothing was published. Try again once the build is done.',
  },
} as const;

type Docs = Map<string, string>;

/** A commit the squash built: its parent, its tree's documents, and the keys the publish changed. */
interface Commit {
  readonly parent: string;
  readonly docs: Docs;
  readonly keys: readonly string[];
}

/**
 * The repo as the harness keeps it. `origin` is the remote; `work` is `cms/work`: the commit it sits on (`workBase`), its HEAD
 * (`workHead`) and the saved values (`saved`). Each new name (`o1`, `h1`, `c1`) is the next commit or HEAD of its kind.
 */
class Model {
  originTip = 'o0';
  originDocs: Docs = new Map();
  /** The last origin move was a code change, so the sync that sees it asks for a build. */
  originCode = false;
  workBase = 'o0';
  workHead = 'h0';
  saved: Docs = new Map();
  commits = new Map<string, Commit>();
  /** Every value each key was pushed with. */
  pushed = new Map<string, Set<string>>();
  /** Documents pushed with the value the remote already had: a document published twice. */
  overpushes = 0;
  /** `cms/work` HEAD moves between a squash and its push. */
  headMoves = 0;
  /** The HEAD at the last squash, until its push (invariant 6). */
  frozenHead: string | undefined;
  nodeDown = false;
  invalid = false;
  crashOnReset = false;
  private readonly counts = new Map<string, number>();

  name(prefix: string): string {
    const next = (this.counts.get(prefix) ?? 0) + 1;
    this.counts.set(prefix, next);
    return `${prefix}${next}`;
  }

  changeset(): Changeset {
    const documents: ChangedDocument[] = [];
    for (const [key, value] of this.saved)
      if (this.originDocs.get(key) !== value)
        documents.push({ key, status: 'modified', baseRevision: 'rev', value });
    return { documents, createdRecords: [], fileErrors: [] };
  }
}

/** The fetch of the model: the origin tip, and whether `cms/work` sits on another one. */
function fetched(m: Model): FetchResult {
  const reapply = m.workBase !== m.originTip;
  return {
    ok: true,
    upstream: m.originTip,
    reapply,
    change: reapply ? (m.originCode ? 'code' : 'content-only') : 'none',
    paths: [],
  };
}

/** Makes the world the events run in: the model, the pauses and the lock. A restart keeps the model and makes new parts. */
function rig(builderOn = true) {
  const m = new Model();
  let holds = new Set<Point>();
  let pause: { readonly point: Point; readonly resume: () => void } | undefined;
  const timers: { readonly callback: () => void; readonly handle: object }[] =
    [];
  const mutex = createMutex({
    clock: {
      setTimeout: (callback) => {
        const handle = {};
        timers.push({ callback, handle });
        return handle;
      },
      clearTimeout: (handle) => {
        const at = timers.findIndex((timer) => timer.handle === handle);
        if (at >= 0) timers.splice(at, 1);
      },
    },
  });

  // The publish waits here when the harness holds the point, until `release`.
  function at(point: Point): Promise<void> {
    if (!holds.delete(point)) return Promise.resolve();
    return new Promise<void>((resume) => {
      pause = { point, resume };
    });
  }

  const tx: RepoTx = fakeTx({
    fetch: async () => {
      await at('fetch');
      return fetched(m);
    },
    reapply: async (upstream): Promise<ReapplyResult> => {
      m.workBase = upstream;
      m.workHead = m.name('h');
      return { tip: m.workHead, renamed: [] };
    },
    revParse: async () => m.workHead,
    hasSavedChanges: async () => m.changeset().documents.length > 0,
    squash: async () => {
      const { documents } = m.changeset();
      if (documents.length === 0) return null;
      const commit = m.name('c');
      const docs: Docs = new Map(m.originDocs);
      for (const document of documents)
        docs.set(document.key, String(document.value));
      m.commits.set(commit, {
        parent: m.workBase,
        docs,
        keys: documents.map((document) => document.key),
      });
      m.frozenHead = m.workHead;
      return commit;
    },
    push: async (commit): Promise<PushResult> => {
      await at('push');
      if (m.frozenHead !== m.workHead) m.headMoves += 1;
      m.frozenHead = undefined;
      const pushed = m.commits.get(commit);
      if (pushed === undefined) throw new Error(`no commit ${commit}`);
      if (pushed.parent !== m.originTip)
        return { ok: false, race: true, message: 'rejected (fetch first)' };
      for (const key of pushed.keys) {
        const value = pushed.docs.get(key) ?? '';
        if (m.originDocs.get(key) === value) m.overpushes += 1;
        const values = m.pushed.get(key) ?? new Set<string>();
        values.add(value);
        m.pushed.set(key, values);
      }
      m.originTip = commit;
      m.originDocs = pushed.docs;
      m.originCode = false;
      return { ok: true };
    },
    resetWork: async (commit) => {
      if (m.crashOnReset) {
        m.crashOnReset = false;
        throw new Error('the process stopped before the reset');
      }
      m.workBase = commit;
      m.workHead = m.name('h');
      m.saved = new Map();
      m.frozenHead = undefined;
    },
  });

  const repo: Repo = {
    locked: (holder, work) => mutex.run(holder, () => work(tx)),
    fetchOrigin: async () => ({ ok: true, upstream: m.originTip }),
    changedPaths: async () => [],
    showAt: async () => null,
    showAtBytes: async () => null,
    mergeBase: async () => m.workBase,
    revParse: async () => m.workHead,
    overwrittenSince: async () => new Map<string, string>(),
    changesetReader: async () => emptyChangeset(),
  };
  const builds: Builds = {
    busy: () => false,
    waitForIdle: async () => {
      await at('wait');
      return true;
    },
  };
  const preview: PreviewClient = {
    validate: async (): Promise<FieldError[]> => {
      await at('validate');
      if (m.nodeDown) throw new PreviewUnavailableError('the node is down');
      return m.invalid
        ? [{ key: 'a', path: ['name'], message: 'is not a name' }]
        : [];
    },
  };
  const bundles = { current: async () => bundleOf([]) };
  const guard = { recheck: async () => undefined, invalidate: () => {} };
  const deleteGuard = createDeleteGuard();

  // One process: its status, its gate, its sync and its publish. A restart makes a new one over the same model.
  function world(): {
    readonly gate: PublishGate;
    readonly sync: ReturnType<typeof createSync>;
    readonly publish: () => Promise<PublishAnswer>;
  } {
    const status = createStatus({
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
    const gate = createPublishGate({ status });
    const sync = createSync({
      repo,
      bundles,
      guard,
      status,
      trigger: () => {},
      gate,
    });
    const publish = createPublish({
      repo,
      bundles,
      siteFolder: 'unused-site',
      config: { collections: {}, media: MEDIA_CONFIG },
      preview,
      media: MEDIA,
      guard,
      syncLocked: sync.syncLocked,
      status,
      builds,
      gate,
      builderOn,
      trigger: () => {},
      log: silentLog(),
      readChangeset: async () => m.changeset(),
    });
    return { gate, sync, publish };
  }

  let current = world();

  return {
    m,
    world: () => current,
    paused: () => pause !== undefined,
    hold(points: readonly Point[]): void {
      holds = new Set(points);
    },
    clearHolds(): void {
      holds = new Set();
    },
    release(): void {
      const resumed = pause;
      pause = undefined;
      resumed?.resume();
    },
    // A lock taken by someone else (a rebuild, a sync) until the returned function is called.
    holdLock(): () => void {
      let free: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        free = resolve;
      });
      void mutex.run('sync', () => done);
      return free;
    },
    // Fires every pending lock timeout: the waiters give up with `LockTimeoutError`.
    expireLockWaits(): void {
      for (const timer of timers.splice(0)) timer.callback();
    },
    save(key: string, value: string): Promise<SaveAnswer> {
      const { gate } = current;
      return saveChanges(
        {
          changes: [],
          bundles,
          siteFolder: 'unused-site',
          config: { collections: {}, media: MEDIA_CONFIG },
          preview,
          media: MEDIA,
          log: silentLog(),
          guard: deleteGuard,
          gate,
        },
        repo,
        {
          stages: [
            async () => {
              m.saved.set(key, value);
              m.workHead = m.name('h');
              return undefined;
            },
          ],
        },
      );
    },
    poll(): Promise<SyncNowOutcome> {
      return current.sync.syncNow();
    },
    publish(): Promise<PublishAnswer> {
      return current.publish();
    },
    restart(): void {
      current = world();
    },
  };
}

// Whether an answer is one the table allows for a publish: a 200, or a refusal or failure the table names.
function allowed(answer: PublishAnswer): boolean {
  if (answer.status === 200) return true;
  return [
    'publish-in-progress',
    'build-in-progress',
    'preview-unavailable',
    'push-rejected',
  ].includes(answer.body.error);
}

/** Waits until `condition` holds, a macrotask at a time, so the publish's file read can finish; fails rather than hangs. */
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 10_000 && !condition(); turn += 1)
    await new Promise((resolve) => setImmediate(resolve));
  if (!condition()) throw new Error('the publish neither answered nor paused');
}

/** A driver over one world: it issues the events, and it checks the invariants after each one. */
function driver() {
  const r = rig();
  const m = r.m;
  // The value of the last save that answered 200, per key: invariant 1 is checked for each.
  const latest = new Map<string, string>();
  const answers: PublishAnswer[] = [];
  const pending: Promise<PublishAnswer>[] = [];
  let inFlight = false;

  const snapshot = (): string =>
    JSON.stringify({
      saved: [...m.saved],
      head: m.workHead,
      base: m.workBase,
      origin: m.originTip,
    });

  // A publish click: while one runs, it is refused at once; otherwise it starts one.
  function click(): Promise<PublishAnswer> {
    if (inFlight) return r.publish();
    inFlight = true;
    const answer = r.publish().then((done) => {
      inFlight = false;
      answers.push(done);
      return done;
    });
    pending.push(answer);
    return answer;
  }

  return {
    m,
    world: r.world,
    paused: r.paused,
    hold: r.hold,
    clearHolds: r.clearHolds,
    holdLock: r.holdLock,
    expireLockWaits: r.expireLockWaits,
    restart: r.restart,
    snapshot,
    isInFlight: (): boolean => inFlight,
    origin: () => ({
      tip: m.originTip,
      docs: Object.fromEntries(m.originDocs),
    }),
    // A publish click that starts a publish, and the answer when one is refused (checked by the caller).
    click,
    // Starts a publish with `points` held and waits until it pauses or answers. The answer comes as a promise, so the
    // caller awaits it after a release. During a publish, the click is refused, and that refusal is what the promise holds.
    async start(
      points: readonly Point[] = [],
    ): Promise<{ readonly answer: Promise<PublishAnswer> }> {
      if (inFlight) {
        const refused = click();
        expect(await refused, 'a second click').toStrictEqual(PUBLISH_REFUSED);
        return { answer: refused };
      }
      r.hold(points);
      const answer = click();
      await waitUntil(() => !inFlight || r.paused());
      return { answer };
    },
    async release(): Promise<void> {
      r.release();
      await waitUntil(() => !inFlight || r.paused());
    },
    // A save: a save during a publish is refused without a write, and any other save answers without that refusal.
    async save(key: string, value: string): Promise<SaveAnswer> {
      const during = inFlight;
      const before = snapshot();
      const answer = await r.save(key, value);
      if (during) {
        expect(answer, `a save during a publish`).toStrictEqual(SAVE_REFUSED);
        expect(snapshot(), 'a refused save writes nothing').toBe(before);
      } else if (answer.status === 200) {
        latest.set(key, value);
      }
      return answer;
    },
    // A poll tick that is not checked here: the caller says what it expects (a tick queued before a click is skipped later).
    pollQueued(): Promise<SyncNowOutcome> {
      return r.poll();
    },
    // A poll tick: skipped during a publish, and run otherwise.
    async poll(): Promise<SyncNowOutcome> {
      const during = inFlight;
      const outcome = await r.poll();
      if (during)
        expect(outcome, 'a poll tick during a publish').toStrictEqual({
          kind: 'skipped',
        });
      else
        expect(outcome.kind, 'a poll tick outside a publish').not.toBe(
          'skipped',
        );
      return outcome;
    },
    // Lets the queued work reach its lock (a save or a poll is issued before the click, and waits there).
    async flush(): Promise<void> {
      for (let turn = 0; turn < 5; turn += 1)
        await new Promise((resolve) => setImmediate(resolve));
    },
    // The invariants of the state table, checked after every step.
    check(where: string): void {
      expect(
        r.world().gate.pollMayRun(),
        `${where}: the gate is open exactly when no publish runs`,
      ).toBe(!inFlight);
      expect(m.overpushes, `${where}: a document pushed unchanged`).toBe(0);
      expect(m.headMoves, `${where}: cms/work moved during a publish`).toBe(0);
      for (const [key, value] of latest) {
        const kept =
          m.saved.get(key) === value ||
          m.originDocs.get(key) === value ||
          (m.pushed.get(key)?.has(value) ?? false);
        expect(
          kept,
          `${where}: a save of ${key} answered 200 and is in neither cms/work nor the remote`,
        ).toBe(true);
      }
    },
    // Releases every hold, lets every publish answer, and checks the answers the table allows.
    async drain(where: string): Promise<void> {
      r.clearHolds();
      for (let turn = 0; turn < 20 && inFlight; turn += 1) await this.release();
      expect(inFlight, `${where}: a publish never answered`).toBe(false);
      await Promise.all(pending);
      for (const answer of answers)
        expect(
          allowed(answer),
          `${where}: the publish answered ${JSON.stringify(answer)}`,
        ).toBe(true);
    },
  };
}

describe('publish event order: curated scenarios (2.10l)', () => {
  it('a publish with nothing saved answers 200 null, and one with a save publishes it', async () => {
    const d = driver();
    expect(await d.click()).toStrictEqual({
      status: 200,
      body: { commit: null, overwritten: [], renamed: [] },
    });
    await d.save('a', '1');
    expect(await d.click()).toStrictEqual({
      status: 200,
      body: { commit: 'c1', overwritten: [], renamed: [] },
    });
    expect(d.origin()).toStrictEqual({ tip: 'c1', docs: { a: '1' } });
    d.check('after the publish');
  });

  it('a publish waits for a running build, then publishes the save it had', async () => {
    const d = driver();
    await d.save('a', '1');
    const { answer } = await d.start(['wait']);
    expect(d.paused()).toBe(true);
    await d.release();
    expect(await answer).toStrictEqual({
      status: 200,
      body: { commit: 'c1', overwritten: [], renamed: [] },
    });
    expect(d.origin()).toStrictEqual({ tip: 'c1', docs: { a: '1' } });
    d.check('after the build');
  });

  it.each<Point>(['fetch', 'validate', 'wait', 'push'])(
    'refuses a save while the publish is paused at %s: nothing written, and a save works after the answer',
    async (point) => {
      const d = driver();
      await d.save('a', '1');
      const before = d.snapshot();
      await d.start([point]);
      expect(d.paused()).toBe(true);
      expect(await d.save('b', '2')).toStrictEqual(SAVE_REFUSED);
      expect(d.snapshot()).toBe(before);
      await d.release();
      expect(d.isInFlight()).toBe(false);
      expect(await d.save('c', '3')).toStrictEqual({
        status: 200,
        body: { revisions: {}, warnings: [], rebuild: false },
      });
      d.check(`paused at ${point}`);
    },
  );

  it.each<Point>(['fetch', 'validate', 'wait', 'push'])(
    'skips a poll tick while the publish is paused at %s, and leaves cms/work and the remote as they were',
    async (point) => {
      const d = driver();
      await d.save('a', '1');
      const before = d.snapshot();
      await d.start([point]);
      expect(await d.poll()).toStrictEqual({ kind: 'skipped' });
      expect(d.snapshot()).toBe(before);
      await d.release();
      expect(await d.poll()).not.toStrictEqual({ kind: 'skipped' });
      d.check(`a poll paused at ${point}`);
    },
  );

  it('refuses a second publish click while one runs, and the first still answers 200', async () => {
    const d = driver();
    await d.save('a', '1');
    const { answer } = await d.start(['wait']);
    expect(await d.click()).toStrictEqual(PUBLISH_REFUSED);
    await d.release();
    expect(await answer).toStrictEqual({
      status: 200,
      body: { commit: 'c1', overwritten: [], renamed: [] },
    });
    expect(d.origin()).toStrictEqual({ tip: 'c1', docs: { a: '1' } });
    d.check('after the second click');
  });

  it('refuses a save and a poll tick that queued on the lock before the click, once the click has closed the gate', async () => {
    const d = driver();
    await d.save('a', '1');
    const unlock = d.holdLock();
    // Both are issued while the gate is open, so they queue on the lock; the click queues behind them.
    const queuedSave = d.save('b', '2');
    const queuedPoll = d.pollQueued();
    await d.flush();
    const first = d.click();
    unlock();
    expect(await queuedSave).toStrictEqual(SAVE_REFUSED);
    expect(await queuedPoll).toStrictEqual({ kind: 'skipped' });
    expect(await first).toStrictEqual({
      status: 200,
      body: { commit: 'c1', overwritten: [], renamed: [] },
    });
    // The refused save is not in the commit: it was never written.
    expect(d.origin()).toStrictEqual({ tip: 'c1', docs: { a: '1' } });
    d.check('a queued save');
  });

  it('answers 503 busy when the publish cannot take the lock at the start, and reopens the gate', async () => {
    const d = driver();
    await d.save('a', '1');
    const unlock = d.holdLock();
    const first = d.click();
    await d.flush();
    d.expireLockWaits();
    expect(await first).toStrictEqual({
      status: 503,
      body: {
        error: 'busy',
        message:
          'The site is busy with another operation (sync). Try again in a moment.',
      },
    });
    expect(d.world().gate.pollMayRun()).toBe(true);
    unlock();
    expect(await d.click()).toStrictEqual({
      status: 200,
      body: { commit: 'c1', overwritten: [], renamed: [] },
    });
    d.check('after the lock timeout');
  });

  it('retries a push the remote refused after a move with content, and publishes the retry', async () => {
    const d = driver();
    await d.save('a', '1');
    const { answer } = await d.start(['wait']);
    d.m.originTip = d.m.name('o');
    d.m.originDocs = new Map([['b', 'remote']]);
    await d.release();
    // The first push is refused (its parent is the old tip); the retry syncs, squashes c2 on the new tip, and pushes it.
    expect(await answer).toStrictEqual({
      status: 200,
      body: { commit: 'c2', overwritten: [], renamed: [] },
    });
    expect(d.origin()).toStrictEqual({
      tip: 'c2',
      docs: { a: '1', b: 'remote' },
    });
    d.check('after a push race with content');
  });

  it('answers 503 build-in-progress when the retry finds new code, pushes nothing, and keeps the save', async () => {
    const d = driver();
    await d.save('a', '1');
    const { answer } = await d.start(['wait']);
    d.m.originTip = d.m.name('o');
    d.m.originCode = true;
    await d.release();
    // The retry's sync took the code change in (and asked for its build), so nothing was pushed and the save stays.
    expect(await answer).toStrictEqual(BUILD_WAITING);
    expect(d.isInFlight()).toBe(false);
    expect(d.m.saved.get('a')).toBe('1');
    expect(d.origin()).toStrictEqual({ tip: 'o1', docs: {} });
    d.check('after a push race with code');
    // Nothing new is upstream now, so the next sync is quiet, and the next publish publishes the save on the new code.
    expect(await d.poll()).toMatchObject({
      kind: 'synced',
      change: 'none',
      upstream: 'o1',
    });
    expect(await d.click()).toStrictEqual({
      status: 200,
      body: { commit: 'c2', overwritten: [], renamed: [] },
    });
  });

  it('answers 503 preview-unavailable when the node is down, and 422 when it refuses a value, and reopens the gate each time', async () => {
    const d = driver();
    await d.save('a', '1');
    d.m.nodeDown = true;
    expect(await d.click()).toStrictEqual({
      status: 503,
      body: { error: 'preview-unavailable', message: 'the node is down' },
    });
    expect(d.world().gate.pollMayRun()).toBe(true);
    d.m.nodeDown = false;
    d.m.invalid = true;
    expect((await d.click()).status).toBe(422);
    expect(d.world().gate.pollMayRun()).toBe(true);
    d.m.invalid = false;
    expect(await d.click()).toStrictEqual({
      status: 200,
      body: { commit: 'c1', overwritten: [], renamed: [] },
    });
    d.check('after the refusals');
  });

  it('after a crash between the push and the reset, a restart publishes nothing twice', async () => {
    const d = driver();
    await d.save('a', '1');
    d.m.crashOnReset = true;
    expect(await d.click()).toStrictEqual({
      status: 500,
      body: {
        error: 'publish-failed',
        message:
          'Publishing failed unexpectedly: the process stopped before the reset',
      },
    });
    // The remote has the commit; cms/work still holds the save, and the gate is open again.
    expect(d.origin()).toStrictEqual({ tip: 'c1', docs: { a: '1' } });
    expect(d.world().gate.pollMayRun()).toBe(true);
    d.restart();
    expect(await d.click()).toStrictEqual({
      status: 200,
      body: { commit: null, overwritten: [], renamed: [] },
    });
    expect(d.m.overpushes).toBe(0);
    d.check('after the restart');
  });

  it('publishes only the save made after the last publish', async () => {
    const d = driver();
    await d.save('a', '1');
    await d.click();
    await d.save('b', '2');
    expect(await d.click()).toStrictEqual({
      status: 200,
      body: { commit: 'c2', overwritten: [], renamed: [] },
    });
    expect(d.m.commits.get('c2')?.keys).toStrictEqual(['b']);
    d.check('the second publish');
  });
});

describe('publish event order: seeded random runs (2.10l)', () => {
  // A small generator with a fixed sequence per seed, so a failing seed replays the same events.
  function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick<T>(random: () => number, items: readonly T[]): T {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }

  const KEYS = ['a', 'b', 'c'] as const;
  const POINTS: readonly Point[] = ['fetch', 'validate', 'wait', 'push'];

  async function runSeed(seed: number): Promise<void> {
    const random = generator(seed);
    const d = driver();
    const length = 8 + Math.floor(random() * 5);
    const trail: string[] = [];
    for (let step = 1; step <= length; step += 1) {
      const roll = random();
      let event: string;
      if (roll < 0.3) {
        const key = pick(random, KEYS);
        event = `save ${key}`;
        await d.save(key, `v${step}`);
      } else if (roll < 0.45) {
        event = 'poll';
        await d.poll();
      } else if (roll < 0.6) {
        const points = POINTS.filter(() => random() < 0.4);
        event = `publish holding [${points.join(',')}]`;
        await d.start(points);
      } else if (roll < 0.7) {
        event = 'release';
        await d.release();
      } else if (roll < 0.85) {
        const key = pick(random, KEYS);
        event = `remote ${key}`;
        d.m.originTip = d.m.name('o');
        d.m.originDocs = new Map(d.m.originDocs).set(key, `r${step}`);
        d.m.originCode = false;
      } else if (roll < 0.92) {
        event = 'remote code';
        d.m.originTip = d.m.name('o');
        d.m.originCode = true;
      } else {
        event = 'node toggles';
        d.m.nodeDown = !d.m.nodeDown;
      }
      trail.push(event);
      d.check(`seed ${seed}, step ${step}: ${trail.join(' | ')}`);
    }
    d.m.nodeDown = false;
    d.m.invalid = false;
    await d.drain(`seed ${seed}`);
    expect(
      await d.click(),
      `seed ${seed}: the last publish after the run answers 200 (${trail.join(' | ')})`,
    ).toMatchObject({ status: 200 });
    d.check(`seed ${seed}, the end`);
  }

  it('keeps the invariants over 200 seeded sequences of 8 to 12 events', async () => {
    for (let seed = 1; seed <= 200; seed += 1) await runSeed(seed);
  });
});
