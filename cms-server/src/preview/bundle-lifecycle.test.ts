import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type BundleJson, bundleJsonSchema } from 'preview-contract';
import { PROTOCOL_VERSION } from 'preview-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_BUNDLE } from '../../test/helpers/bundle.ts';
import type { BundleRef } from '../bundle/source.ts';
import type { RepoTx } from '../git/ops.ts';
import type { Logger } from '../log.ts';
import type { BuildJob, BuildResult } from './build-runner.ts';
import {
  type BundleLifecycle,
  createBundleLifecycle,
  type LifecycleOptions,
  type LifecycleRepo,
  type TriggerReason,
} from './bundle-lifecycle.ts';
import { collectBundles } from './bundles.ts';
import { emptyState, type PreviewState, type StateStore } from './state.ts';
import { createStatus, type Status } from './status.ts';
import type { Supervisor } from './supervisor.ts';

// The commit cms/work points to, and origin's branch. Both are full SHAs, as git prints them.
const HEAD = 'h'.repeat(40);
const BASE = 'b'.repeat(40);
// The bundles folder of the fakes. Only paths are built from it; the files of a bundle are read through the fakes.
const BUNDLES = path.resolve('lifecycle-test-bundles');
// The bundle the state names before a test's trigger.
const OLD = 'old-bundle';

type SwapAnswer = Awaited<ReturnType<Supervisor['swap']>>;
type StartAnswer = Awaited<ReturnType<Supervisor['start']>>;

/** A logger whose calls are spies. */
function spyLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

/** The result of a build that passes, for the bundle the job names. */
function okBuild(job: BuildJob): Promise<BuildResult> {
  return Promise.resolve({
    bundleId: job.bundleId,
    dir: path.join(BUNDLES, job.bundleId),
    ok: true,
    firstError: null,
  });
}

/** A build answer that fails, with `message` as its first error in `file` (or none). */
function failedBuild(message: string, file: string | null = null) {
  return (job: BuildJob): Promise<BuildResult> =>
    Promise.resolve({
      bundleId: job.bundleId,
      dir: path.join(BUNDLES, job.bundleId),
      ok: false,
      firstError: { file, message },
    });
}

/** A builder whose calls are spies. `stop` is a spy too. */
function fakeBuilder(
  answer: (job: BuildJob) => Promise<BuildResult> = okBuild,
) {
  return Object.assign(vi.fn(answer), {
    stop: vi.fn(() => Promise.resolve()),
  });
}

/** A supervisor whose calls are spies. `swap` and `start` answer `ok` unless the test gives an answer. */
function fakeSupervisor(answers: {
  swap?: (() => Promise<SwapAnswer>) | undefined;
  start?: (() => Promise<StartAnswer>) | undefined;
}) {
  return {
    start: vi.fn(
      answers.start ?? (() => Promise.resolve<StartAnswer>({ ok: true })),
    ),
    swap: vi.fn(
      answers.swap ?? (() => Promise.resolve<SwapAnswer>({ ok: true })),
    ),
    stop: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => ({
      state: 'ready' as const,
      port: 4401,
      bundleId: null,
      failures: 0,
      error: null,
    })),
  };
}

/** A state store in memory, whose `set` is a spy. */
function memoryStore(initial: PreviewState) {
  let state = initial;
  return {
    get: (): PreviewState => state,
    set: vi.fn((next: PreviewState) => {
      state = next;
      return Promise.resolve();
    }),
    keptBundles: (): ReadonlySet<string> => new Set<string>(),
  } satisfies StateStore & { set: unknown };
}

/**
 * The repo of the tests: `cms/work` resolves to HEAD, and origin's branch to `upstream` (BASE, until a test moves it).
 * Each read is recorded in order. `gate`, when given, holds each read until it resolves (a read that is still pending).
 */
function fakeRepo(gate: Promise<void> = Promise.resolve()) {
  const locks: string[] = [];
  const reads: string[] = [];
  let upstream = BASE;
  const repo: LifecycleRepo = {
    locked: (holder, work) => {
      locks.push(holder);
      const tx: Pick<RepoTx, 'revParse'> = {
        revParse: async (ref) => {
          await gate;
          reads.push(ref);
          return ref === 'origin/main' ? upstream : HEAD;
        },
      };
      return work(tx);
    },
  };
  return {
    repo,
    locks,
    reads,
    /** Moves origin's branch, as a sync that fetched a new commit would. */
    moveUpstream: (sha: string) => {
      upstream = sha;
    },
  };
}

/** The fixture's bundle.json, parsed, with its protocolVersion set to `protocolVersion`. */
async function identityWith(protocolVersion: number): Promise<BundleJson> {
  const text = await readFile(path.join(FIXTURE_BUNDLE, 'bundle.json'), 'utf8');
  return { ...bundleJsonSchema.parse(JSON.parse(text)), protocolVersion };
}

/** The bundle id of a manifest folder: the folder above `manifest/`. */
function bundleIdOf(manifestDir: string): string {
  return path.basename(path.dirname(manifestDir));
}

interface RigOptions {
  readonly state?: PreviewState;
  readonly build?: (job: BuildJob) => Promise<BuildResult>;
  readonly swap?: () => Promise<SwapAnswer>;
  readonly start?: () => Promise<StartAnswer>;
  /** The protocolVersion of each bundle, by bundleId. A bundle absent here is the server's own. `null` is no bundle.json. */
  readonly versions?: ReadonlyMap<string, number | null>;
  /** The default: a fake reader over `versions`. `real` leaves the lifecycle's own reader, which reads the folder. */
  readonly reader?: 'fake' | 'real';
  /** Replaces the fake reader with `readBundle`. Ignored with `reader: 'real'`. */
  readonly readBundle?: LifecycleOptions['readBundle'];
  readonly bundlesDir?: string;
  /** Holds every read of the repo until it resolves, so a test can stop the lifecycle while a read is pending. */
  readonly gate?: Promise<void>;
}

/** A lifecycle over fakes, with the parts a test checks. Bundle ids are `b-1`, `b-2`, ... in build order. */
async function rigOf(options: RigOptions = {}) {
  const log = spyLog();
  const { repo, locks, reads, moveUpstream } = fakeRepo(options.gate);
  const build = fakeBuilder(options.build);
  const supervisor = fakeSupervisor({
    swap: options.swap,
    start: options.start,
  });
  const store = memoryStore(options.state ?? emptyState());
  const status: Status = createStatus({
    builder: 'on',
    node: () => supervisor.status(),
    changedPaths: () => Promise.resolve([]),
  });
  const versions = options.versions ?? new Map<string, number | null>();
  const fakeReader: LifecycleOptions['readBundle'] = async (manifestDir) => {
    const bundleId = bundleIdOf(manifestDir);
    const version = versions.has(bundleId)
      ? versions.get(bundleId)
      : PROTOCOL_VERSION;
    if (version === null || version === undefined) return null;
    const ref: BundleRef = {
      dir: manifestDir,
      identity: await identityWith(version),
    };
    return ref;
  };
  let made = 0;
  const lifecycle: BundleLifecycle = createBundleLifecycle({
    repo,
    upstreamRef: 'origin/main',
    build,
    supervisor,
    state: store,
    status,
    bundlesDir: options.bundlesDir ?? BUNDLES,
    log,
    readBundle:
      options.reader === 'real'
        ? undefined
        : (options.readBundle ?? fakeReader),
    newBundleId: () => {
      made += 1;
      return `b-${made}`;
    },
  });
  return {
    lifecycle,
    build,
    supervisor,
    store,
    status,
    log,
    locks,
    reads,
    moveUpstream,
  };
}

/** An entry of the state: a bundle id with the base it was built on. */
const entry = (bundleId: string) => ({ bundleId, baseCommit: BASE });

/** A state that names `OLD` as both the served and the last good bundle. */
const oldState = (): PreviewState => ({
  ...emptyState(),
  current: entry(OLD),
  lastGood: entry(OLD),
});

/** Waits a macrotask, so the promises the test started have run as far as they can. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

const mismatchOf = (bundleId: string, speaks: number) =>
  `Bundle ${bundleId} speaks protocol ${speaks}, and the server speaks protocol ${PROTOCOL_VERSION}`;
const noBundleJson = (bundleId: string) =>
  `Bundle ${bundleId} has no bundle.json, so it was built before the protocol versions. The server speaks protocol ${PROTOCOL_VERSION}`;

afterEach(() => {
  vi.clearAllMocks();
});

describe('the triggers', () => {
  it.each([
    'first-start',
    'save-rebuild',
    'protocol-mismatch',
    'sync-code',
    'publish',
  ] satisfies TriggerReason[])(
    '%s builds the commit cms/work points to, under the lock, and serves it',
    async (reason) => {
      const rig = await rigOf();
      expect(await rig.lifecycle.trigger(reason)).toStrictEqual({
        kind: 'served',
        bundleId: 'b-1',
      });
      expect(rig.build.mock.calls).toStrictEqual([
        [{ commit: HEAD, bundleId: 'b-1' }],
      ]);
      expect(rig.locks).toStrictEqual(['build head']);
      expect(rig.reads).toStrictEqual(['refs/heads/cms/work', 'origin/main']);
    },
  );

  it('logs the reason of each build it is asked for', async () => {
    const rig = await rigOf();
    await rig.lifecycle.trigger('save-rebuild');
    expect(rig.log.info).toHaveBeenCalledWith('A build was asked for', {
      reason: 'save-rebuild',
    });
  });

  it('serves the built bundle at its folder, and the state names it with the base it was built on', async () => {
    const rig = await rigOf();
    await rig.lifecycle.trigger('publish');
    expect(rig.supervisor.swap.mock.calls).toStrictEqual([
      [{ bundleId: 'b-1', dir: path.join(BUNDLES, 'b-1') }],
    ]);
    expect(rig.store.get()).toStrictEqual({
      current: entry('b-1'),
      lastGood: entry('b-1'),
      protocolAttempts: new Map(),
    });
  });

  it('after stop, a trigger builds nothing and says it stopped', async () => {
    const rig = await rigOf();
    await rig.lifecycle.stop();
    expect(await rig.lifecycle.trigger('publish')).toStrictEqual({
      kind: 'stopped',
    });
    expect(rig.build).not.toHaveBeenCalled();
  });
});

describe('a failed build', () => {
  it('is reported with its file and message, and the node and the state keep what they had', async () => {
    const initial = oldState();
    const rig = await rigOf({
      state: initial,
      build: failedBuild('unexpected token', 'src/pages/a.astro'),
    });
    expect(await rig.lifecycle.trigger('save-rebuild')).toStrictEqual({
      kind: 'build-failed',
      error: 'src/pages/a.astro: unexpected token',
    });
    expect(rig.supervisor.swap).not.toHaveBeenCalled();
    expect(rig.store.set).not.toHaveBeenCalled();
    expect((await rig.status.snapshot()).build).toStrictEqual({
      state: 'failed',
      error: 'src/pages/a.astro: unexpected token',
    });
  });

  it('without a first error says that the build failed', async () => {
    const rig = await rigOf({
      build: (job) =>
        Promise.resolve({
          bundleId: job.bundleId,
          dir: BUNDLES,
          ok: false,
          firstError: null,
        }),
    });
    expect(await rig.lifecycle.trigger('publish')).toStrictEqual({
      kind: 'build-failed',
      error: 'The build failed',
    });
  });

  it('whose build rejects is a failed build with the rejection message', async () => {
    const rig = await rigOf({
      build: () => Promise.reject(new Error('spawn failed')),
    });
    expect(await rig.lifecycle.trigger('publish')).toStrictEqual({
      kind: 'build-failed',
      error: 'spawn failed',
    });
    expect((await rig.status.snapshot()).build.state).toBe('failed');
  });

  it('is cleared from the status by the next build that passes', async () => {
    const rig = await rigOf({ build: failedBuild('bad') });
    await rig.lifecycle.trigger('publish');
    expect((await rig.status.snapshot()).build.error).toBe('bad');
    rig.build.mockImplementation(okBuild);
    await rig.lifecycle.trigger('publish');
    expect((await rig.status.snapshot()).build).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });
});

describe('a swap that fails', () => {
  it('rolled back: the failed bundle stays out of the state, and its error is in the status', async () => {
    const initial = oldState();
    const rig = await rigOf({
      state: initial,
      swap: () =>
        Promise.resolve({ ok: false, error: 'node down', rolledBack: true }),
    });
    expect(await rig.lifecycle.trigger('save-rebuild')).toStrictEqual({
      kind: 'swap-failed',
      error: 'node down',
      rolledBack: true,
    });
    expect(rig.store.get()).toStrictEqual(initial);
    expect(rig.store.set).not.toHaveBeenCalled();
    expect(rig.supervisor.start).not.toHaveBeenCalled();
    expect((await rig.status.snapshot()).errors.swap).toBe('node down');
  });

  it('not rolled back: the last good bundle is started again on its folder', async () => {
    const rig = await rigOf({
      state: oldState(),
      swap: () =>
        Promise.resolve({ ok: false, error: 'no port', rolledBack: false }),
    });
    expect(await rig.lifecycle.trigger('save-rebuild')).toStrictEqual({
      kind: 'swap-failed',
      error: 'no port',
      rolledBack: false,
    });
    expect(rig.supervisor.start.mock.calls).toStrictEqual([
      [{ bundleId: OLD, dir: path.join(BUNDLES, OLD) }],
    ]);
  });

  it('not rolled back with no last good bundle starts nothing', async () => {
    const rig = await rigOf({
      swap: () =>
        Promise.resolve({ ok: false, error: 'no port', rolledBack: false }),
    });
    await rig.lifecycle.trigger('first-start');
    expect(rig.supervisor.start).not.toHaveBeenCalled();
  });

  it('whose last good bundle does not restart is logged with its error', async () => {
    const rig = await rigOf({
      state: oldState(),
      swap: () =>
        Promise.resolve({ ok: false, error: 'no port', rolledBack: false }),
      start: () => Promise.resolve({ ok: false, error: 'still busy' }),
    });
    await rig.lifecycle.trigger('save-rebuild');
    expect(rig.log.error).toHaveBeenCalledWith(
      'The last good bundle did not restart',
      { bundle: OLD, error: 'still busy' },
    );
  });

  it('is cleared from the status by the next swap that passes', async () => {
    let answer: SwapAnswer = { ok: false, error: 'bad', rolledBack: true };
    const rig = await rigOf({ swap: () => Promise.resolve(answer) });
    await rig.lifecycle.trigger('publish');
    expect((await rig.status.snapshot()).errors.swap).toBe('bad');
    answer = { ok: true };
    await rig.lifecycle.trigger('publish');
    expect((await rig.status.snapshot()).errors.swap).toBeNull();
  });
});

describe('start-up', () => {
  it('starts the node on the current bundle and builds nothing', async () => {
    const rig = await rigOf({ state: oldState() });
    await rig.lifecycle.start();
    expect(rig.supervisor.start.mock.calls).toStrictEqual([
      [{ bundleId: OLD, dir: path.join(BUNDLES, OLD) }],
    ]);
    expect(rig.build).not.toHaveBeenCalled();
  });

  it('with no state, builds the first bundle and serves it', async () => {
    const rig = await rigOf();
    await rig.lifecycle.start();
    expect(rig.build).toHaveBeenCalledTimes(1);
    expect(rig.supervisor.swap).toHaveBeenCalledTimes(1);
    expect(rig.log.info).toHaveBeenCalledWith('A build was asked for', {
      reason: 'first-start',
    });
  });

  it('logs a node that does not start, with its bundle and error', async () => {
    const rig = await rigOf({
      state: oldState(),
      start: () => Promise.resolve({ ok: false, error: 'boom' }),
    });
    await rig.lifecycle.start();
    expect(rig.log.error).toHaveBeenCalledWith(
      'The preview node did not start',
      { bundle: OLD, error: 'boom' },
    );
  });
});

describe('the protocol check', () => {
  it('a bundle with no bundle.json counts as a mismatch: it is rebuilt once, and the rebuilt one is only reported', async () => {
    const rig = await rigOf({
      versions: new Map<string, number | null>([
        ['b-1', null],
        ['b-2', null],
      ]),
    });
    await rig.lifecycle.trigger('first-start');
    expect(rig.build.mock.calls).toStrictEqual([
      [{ commit: HEAD, bundleId: 'b-1' }],
      [{ commit: HEAD, bundleId: 'b-2' }],
    ]);
    expect(rig.store.get()).toStrictEqual({
      current: entry('b-2'),
      lastGood: entry('b-2'),
      protocolAttempts: new Map([
        ['b-1', 1],
        ['b-2', 1],
      ]),
    });
    expect((await rig.status.snapshot()).errors.protocolMismatch).toBe(
      noBundleJson('b-2'),
    );
    expect(rig.log.warn).toHaveBeenCalledWith(
      'The bundle does not match the protocol, so it is rebuilt once',
      { bundle: 'b-1', problem: noBundleJson('b-1') },
    );
  });

  it('a protocolVersion that differs is reported, and a rebuild that matches clears it', async () => {
    const rig = await rigOf({ versions: new Map([['b-1', 1]]) });
    await rig.lifecycle.trigger('publish');
    expect(rig.build).toHaveBeenCalledTimes(2);
    expect((await rig.status.snapshot()).errors.protocolMismatch).toBeNull();
    expect(rig.store.get().protocolAttempts).toStrictEqual(
      new Map([
        ['b-1', 1],
        ['b-2', 1],
      ]),
    );
  });

  it('a bundle that was rebuilt once before is only reported on start-up: no second rebuild', async () => {
    const rig = await rigOf({
      state: {
        ...oldState(),
        protocolAttempts: new Map([[OLD, 1]]),
      },
      versions: new Map([[OLD, 1]]),
    });
    await rig.lifecycle.start();
    expect(rig.build).not.toHaveBeenCalled();
    expect((await rig.status.snapshot()).errors.protocolMismatch).toBe(
      mismatchOf(OLD, 1),
    );
  });

  it('a bundle.json that cannot be read is a mismatch, with the reason, and the rebuild that reads is served clean', async () => {
    const rig = await rigOf({
      readBundle: async (manifestDir) => {
        if (bundleIdOf(manifestDir) === 'b-1') throw new Error('bad json');
        return {
          dir: manifestDir,
          identity: await identityWith(PROTOCOL_VERSION),
        };
      },
    });
    await rig.lifecycle.trigger('publish');
    expect(rig.build).toHaveBeenCalledTimes(2);
    expect(rig.log.warn).toHaveBeenCalledWith(
      'The bundle does not match the protocol, so it is rebuilt once',
      {
        bundle: 'b-1',
        problem: 'Bundle b-1 has a bundle.json that cannot be read: bad json',
      },
    );
    expect((await rig.status.snapshot()).errors.protocolMismatch).toBeNull();
  });

  it('a bundle that matches clears a mismatch shown for an earlier bundle', async () => {
    const rig = await rigOf({
      state: { ...oldState(), protocolAttempts: new Map([[OLD, 1]]) },
      versions: new Map([[OLD, 1]]),
    });
    await rig.lifecycle.start();
    expect((await rig.status.snapshot()).errors.protocolMismatch).toBe(
      mismatchOf(OLD, 1),
    );
    await rig.lifecycle.trigger('publish');
    expect((await rig.status.snapshot()).errors.protocolMismatch).toBeNull();
  });

  it('reads bundle.json from the bundle folder by default: a folder without one is a mismatch', async () => {
    const bundles = await mkdtemp(path.join(tmpdir(), 'lifecycle-real-'));
    try {
      const rig = await rigOf({ bundlesDir: bundles, reader: 'real' });
      await rig.lifecycle.trigger('publish');
      expect(rig.build).toHaveBeenCalledTimes(2);
      expect((await rig.status.snapshot()).errors.protocolMismatch).toBe(
        noBundleJson('b-2'),
      );
    } finally {
      await rm(bundles, { recursive: true, force: true });
    }
  });

  it('reads bundle.json from the bundle folder by default: a matching one is served with no rebuild', async () => {
    const bundles = await mkdtemp(path.join(tmpdir(), 'lifecycle-real-'));
    try {
      const manifest = path.join(bundles, 'b-1', 'manifest');
      await mkdir(manifest, { recursive: true });
      await copyFile(
        path.join(FIXTURE_BUNDLE, 'bundle.json'),
        path.join(manifest, 'bundle.json'),
      );
      const rig = await rigOf({ bundlesDir: bundles, reader: 'real' });
      await rig.lifecycle.trigger('publish');
      expect(rig.build).toHaveBeenCalledTimes(1);
      expect((await rig.status.snapshot()).errors.protocolMismatch).toBeNull();
    } finally {
      await rm(bundles, { recursive: true, force: true });
    }
  });
});

describe('review fixes: one swap per build, no swap after stop, the base read with the head', () => {
  it('triggers that share one build result swap the node once, and all get the same outcome', async () => {
    let release: (result: BuildResult) => void = () => undefined;
    let calls = 0;
    const rig = await rigOf({
      build: (job) => {
        calls += 1;
        if (calls === 1) {
          return new Promise<BuildResult>((resolve) => {
            release = resolve;
          });
        }
        return okBuild(job);
      },
    });
    const first = rig.lifecycle.trigger('save-rebuild');
    await settle();
    // The two triggers queue behind the held build, and the runner merges them into one queued build.
    const second = rig.lifecycle.trigger('publish');
    const third = rig.lifecycle.trigger('sync-code');
    await settle();
    release({
      bundleId: 'b-1',
      dir: path.join(BUNDLES, 'b-1'),
      ok: true,
      firstError: null,
    });
    expect(await first).toStrictEqual({ kind: 'served', bundleId: 'b-1' });
    expect(await second).toStrictEqual({ kind: 'served', bundleId: 'b-2' });
    expect(await third).toStrictEqual({ kind: 'served', bundleId: 'b-2' });
    expect(rig.supervisor.swap.mock.calls).toStrictEqual([
      [{ bundleId: 'b-1', dir: path.join(BUNDLES, 'b-1') }],
      [{ bundleId: 'b-2', dir: path.join(BUNDLES, 'b-2') }],
    ]);
  });

  it('stop() while a read is pending: the build is refused, and no swap follows', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const rig = await rigOf({ gate });
    const pending = rig.lifecycle.trigger('publish');
    await settle();
    const stopping = rig.lifecycle.stop();
    open();
    await stopping;
    expect(await pending).toStrictEqual({
      kind: 'build-failed',
      error: 'The preview is stopping, so no build starts',
    });
    expect(rig.build).not.toHaveBeenCalled();
    expect(rig.supervisor.swap).not.toHaveBeenCalled();
  });

  it('stop() while the build runs: a build that answers after the stop is not swapped in', async () => {
    let release: (result: BuildResult) => void = () => undefined;
    const rig = await rigOf({
      build: () =>
        new Promise<BuildResult>((resolve) => {
          release = resolve;
        }),
    });
    const pending = rig.lifecycle.trigger('publish');
    await settle();
    const stopping = rig.lifecycle.stop();
    release({
      bundleId: 'b-1',
      dir: path.join(BUNDLES, 'b-1'),
      ok: true,
      firstError: null,
    });
    await stopping;
    expect(await pending).toStrictEqual({ kind: 'stopped' });
    expect(rig.supervisor.swap).not.toHaveBeenCalled();
    expect(rig.store.set).not.toHaveBeenCalled();
  });

  it('the entry keeps the origin SHA read with the head at the trigger, though origin moved during the build', async () => {
    const moved = 'd'.repeat(40);
    const rig = await rigOf({
      build: (job) => {
        rig.moveUpstream(moved);
        return okBuild(job);
      },
    });
    expect(await rig.lifecycle.trigger('publish')).toStrictEqual({
      kind: 'served',
      bundleId: 'b-1',
    });
    expect(rig.store.get().current).toStrictEqual(entry('b-1'));
    expect(rig.store.get().current?.baseCommit).toBe(BASE);
  });
});

describe('review fixes 2: swaps in order, and the build state while another trigger runs', () => {
  it('a swap for a newer bundle waits for the swap before it, and the older swap does not restart last-good over it', async () => {
    let releaseFirst: (answer: SwapAnswer) => void = () => undefined;
    let swaps = 0;
    const rig = await rigOf({
      state: oldState(),
      swap: () => {
        swaps += 1;
        if (swaps === 1) {
          return new Promise<SwapAnswer>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve({ ok: true });
      },
    });
    const first = rig.lifecycle.trigger('publish');
    const second = rig.lifecycle.trigger('save-rebuild');
    await settle();
    // The second bundle is built while the first swap waits for readiness, but its swap does not start until that one settles.
    expect(rig.supervisor.swap.mock.calls).toStrictEqual([
      [{ bundleId: 'b-1', dir: path.join(BUNDLES, 'b-1') }],
    ]);
    releaseFirst({ ok: false, error: 'not ready', rolledBack: false });
    expect(await first).toStrictEqual({
      kind: 'swap-failed',
      error: 'not ready',
      rolledBack: false,
    });
    expect(await second).toStrictEqual({ kind: 'served', bundleId: 'b-2' });
    // The older swap failed, but a newer one was asked for: last-good is not started over the newer bundle.
    expect(rig.supervisor.start).not.toHaveBeenCalled();
    expect(rig.supervisor.swap.mock.calls).toStrictEqual([
      [{ bundleId: 'b-1', dir: path.join(BUNDLES, 'b-1') }],
      [{ bundleId: 'b-2', dir: path.join(BUNDLES, 'b-2') }],
    ]);
    expect(rig.store.get().current).toStrictEqual(entry('b-2'));
  });

  it('the build state stays building while a queued build runs behind a finished swap, and is idle only once both are settled', async () => {
    let release: (result: BuildResult) => void = () => undefined;
    let builds = 0;
    const rig = await rigOf({
      build: (job) => {
        builds += 1;
        if (builds === 2) {
          return new Promise<BuildResult>((resolve) => {
            release = resolve;
          });
        }
        return okBuild(job);
      },
    });
    const first = rig.lifecycle.trigger('publish');
    const second = rig.lifecycle.trigger('save-rebuild');
    expect(await first).toStrictEqual({ kind: 'served', bundleId: 'b-1' });
    expect((await rig.status.snapshot()).build.state).toBe('building');
    release({
      bundleId: 'b-2',
      dir: path.join(BUNDLES, 'b-2'),
      ok: true,
      firstError: null,
    });
    expect(await second).toStrictEqual({ kind: 'served', bundleId: 'b-2' });
    expect((await rig.status.snapshot()).build.state).toBe('idle');
  });
});

describe('review fix 3: the protocol count of a serve shared by two triggers', () => {
  // A normal trigger and a protocol rebuild (count 1) share one queued build. Whichever registers first, the bundle is
  // stored with count 1, so its own mismatch is only reported: two builds in all, not a third one.
  it.each(['normal-first', 'protocol-first'] as const)(
    'the shared bundle keeps the count 1 when the %s',
    async (order) => {
      let releaseHeld: (result: BuildResult) => void = () => undefined;
      let builds = 0;
      const rig = await rigOf({
        state: oldState(),
        // The old bundle mismatches, so start() rebuilds it (count 1), and the rebuilt bundle mismatches too.
        versions: new Map([
          [OLD, 1],
          ['b-2', 1],
        ]),
        build: (job) => {
          builds += 1;
          if (builds === 1) {
            return new Promise<BuildResult>((resolve) => {
              releaseHeld = resolve;
            });
          }
          return okBuild(job);
        },
      });
      // The first build is held, so the next two requests queue behind it and share one queued build.
      const held = rig.lifecycle.trigger('save-rebuild');
      await settle();
      let normal: ReturnType<BundleLifecycle['trigger']>;
      let protocol: Promise<void>;
      if (order === 'normal-first') {
        normal = rig.lifecycle.trigger('publish');
        await settle();
        protocol = rig.lifecycle.start();
      } else {
        protocol = rig.lifecycle.start();
        await settle();
        normal = rig.lifecycle.trigger('publish');
      }
      await settle();
      releaseHeld({
        bundleId: 'b-1',
        dir: path.join(BUNDLES, 'b-1'),
        ok: true,
        firstError: null,
      });
      await held;
      expect(await normal).toStrictEqual({ kind: 'served', bundleId: 'b-2' });
      await protocol;
      expect(rig.build.mock.calls).toHaveLength(2);
      expect(rig.store.get().current).toStrictEqual(entry('b-2'));
      expect(rig.store.get().protocolAttempts).toStrictEqual(
        new Map([
          [OLD, 1],
          ['b-2', 1],
        ]),
      );
      expect((await rig.status.snapshot()).errors.protocolMismatch).toBe(
        mismatchOf('b-2', 1),
      );
    },
  );
});

describe('the bundles a pending swap keeps from collection (2.9c review)', () => {
  /** A bundles folder with one complete bundle per id: its bundle.json is dated `seconds`, so the collection ranks it. */
  async function bundlesAt(
    root: string,
    written: Readonly<Record<string, number>>,
  ): Promise<void> {
    for (const [bundleId, seconds] of Object.entries(written)) {
      const manifest = path.join(root, bundleId, 'manifest');
      await mkdir(manifest, { recursive: true });
      const file = path.join(manifest, 'bundle.json');
      await copyFile(path.join(FIXTURE_BUNDLE, 'bundle.json'), file);
      await utimes(file, seconds, seconds);
    }
  }

  /**
   * A lifecycle whose first swap waits until `release` is called (the node is not ready yet); later swaps are ok. The
   * bundles folder is `root`, and `b-1` is the bundle of the first swap.
   */
  async function heldSwapRig(root: string) {
    let releaseFirst: (answer: SwapAnswer) => void = () => undefined;
    let swaps = 0;
    const rig = await rigOf({
      bundlesDir: root,
      swap: () => {
        swaps += 1;
        if (swaps === 1) {
          return new Promise<SwapAnswer>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve({ ok: true });
      },
    });
    return {
      rig,
      release: (answer: SwapAnswer) => releaseFirst(answer),
    };
  }

  it('a bundle whose swap is waiting for readiness survives a later collection, though two newer bundles exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lifecycle-keep-'));
    try {
      // b-1 is the oldest; b-2, b-3 and b-4 are newer, so the collection keeps only b-3 and b-4 by age.
      await bundlesAt(root, {
        'b-1': 1000,
        'b-2': 2000,
        'b-3': 3000,
        'b-4': 4000,
      });
      const { rig, release } = await heldSwapRig(root);
      const first = rig.lifecycle.trigger('publish');
      await settle();
      expect([...rig.lifecycle.pendingSwaps()]).toStrictEqual(['b-1']);
      await collectBundles(root, rig.lifecycle.pendingSwaps());
      expect((await readdir(root)).sort()).toStrictEqual(['b-1', 'b-3', 'b-4']);
      release({ ok: false, error: 'not ready', rolledBack: true });
      await first;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('once the swap has settled, the bundle is no longer kept, and a later collection removes it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lifecycle-keep-'));
    try {
      await bundlesAt(root, {
        'b-1': 1000,
        'b-2': 2000,
        'b-3': 3000,
        'b-4': 4000,
      });
      const { rig, release } = await heldSwapRig(root);
      const first = rig.lifecycle.trigger('publish');
      await settle();
      release({ ok: false, error: 'not ready', rolledBack: true });
      expect(await first).toStrictEqual({
        kind: 'swap-failed',
        error: 'not ready',
        rolledBack: true,
      });
      expect([...rig.lifecycle.pendingSwaps()]).toStrictEqual([]);
      await collectBundles(root, rig.lifecycle.pendingSwaps());
      expect((await readdir(root)).sort()).toStrictEqual(['b-3', 'b-4']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('the keep set is read when a collection runs: a set taken at the start of the build does not show the pending swap', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lifecycle-keep-'));
    try {
      await bundlesAt(root, {
        'b-1': 1000,
        'b-2': 2000,
        'b-3': 3000,
        'b-4': 4000,
      });
      const { rig, release } = await heldSwapRig(root);
      // Taken before the build starts: nothing is pending yet, and a copy does not change afterwards.
      const atStart = rig.lifecycle.pendingSwaps();
      const first = rig.lifecycle.trigger('publish');
      await settle();
      expect([...atStart]).toStrictEqual([]);
      await collectBundles(root, rig.lifecycle.pendingSwaps());
      expect((await readdir(root)).sort()).toStrictEqual(['b-1', 'b-3', 'b-4']);
      release({ ok: false, error: 'not ready', rolledBack: true });
      await first;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('stop', () => {
  it('kills the build in flight, and a build queued behind it is refused and never starts', async () => {
    let release: (result: BuildResult) => void = () => undefined;
    const rig = await rigOf({
      build: () =>
        new Promise<BuildResult>((resolve) => {
          release = resolve;
        }),
    });
    const first = rig.lifecycle.trigger('save-rebuild');
    await settle();
    const queued = rig.lifecycle.trigger('publish');
    await settle();
    // stop() waits for the triggers under way, so it is awaited after the held build is released.
    const stopping = rig.lifecycle.stop();
    await settle();
    expect(rig.build.stop).toHaveBeenCalledTimes(1);
    // The killed build ends, and the queued build is taken next: the runner refuses it because of stop.
    release({
      bundleId: 'b-1',
      dir: path.join(BUNDLES, 'b-1'),
      ok: false,
      firstError: { file: null, message: 'killed' },
    });
    expect(await first).toStrictEqual({
      kind: 'build-failed',
      error: 'killed',
    });
    expect(await queued).toStrictEqual({
      kind: 'build-failed',
      error: 'The preview is stopping, so no build starts',
    });
    expect(rig.build).toHaveBeenCalledTimes(1);
    await stopping;
  });
});
