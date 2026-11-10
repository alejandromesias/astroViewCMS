// The bundle lifecycle of cms-server (WORKPLAN 2.9c, PHASE-2-DESIGN 4.4 and 5.6). A trigger names its reason. It resolves
// `cms/work` to a SHA under the repo lock, builds that SHA through the build runner (outside the lock, one build at a
// time), and swaps the node onto the new bundle. A failed swap keeps the failed bundle out of the state, and the last good
// bundle is started again when the supervisor did not roll back itself. After each served bundle the protocol check
// compares its bundle.json with PROTOCOL_VERSION: the first mismatch of a chain rebuilds once, and the new bundle carries
// the count, so a mismatch on it is only reported. A commit whose build failed is not built again by the same lifecycle:
// a restart is the retry (2.9c-B recovery rule).
import { join } from 'node:path';
import { PROTOCOL_VERSION } from 'preview-protocol';
import {
  type BundleRef,
  bundleManifestDir,
  directoryBundleSource,
} from '../bundle/source.ts';
import type { RepoTx } from '../git/ops.ts';
import { WORK_REF } from '../git/repo.ts';
import type { Logger } from '../log.ts';
import type { Builder } from './build-commit.ts';
import {
  type BuildError,
  type BuildResult,
  createBuildRunner,
} from './build-runner.ts';
import type { BundleEntry, StateStore } from './state.ts';
import type { Status } from './status.ts';
import type { Supervisor } from './supervisor.ts';

/** Why a build is asked for. `protocol-mismatch` is also what the protocol check asks for. */
export type TriggerReason =
  | 'first-start'
  | 'save-rebuild'
  | 'protocol-mismatch'
  | 'sync-code'
  | 'publish';

/** How a trigger ended. `swap-failed` says whether the supervisor rolled back to the bundle it served before. */
type TriggerOutcome =
  | { readonly kind: 'served'; readonly bundleId: string }
  | { readonly kind: 'build-failed'; readonly error: string }
  | {
      readonly kind: 'swap-failed';
      readonly error: string;
      readonly rolledBack: boolean;
    }
  | { readonly kind: 'stopped' };

/**
 * The part of the repo the lifecycle reads. `cms/work` and origin's branch are read together under the lock, so a
 * trigger's head and base are the pair it saw (a sync cannot move origin between the two reads).
 */
export interface LifecycleRepo {
  locked<T>(
    holder: string,
    work: (tx: Pick<RepoTx, 'revParse'>) => Promise<T>,
  ): Promise<T>;
}

/** The options of the lifecycle. Each outside call is passed in; `readBundle` has the real default. */
export interface LifecycleOptions {
  readonly repo: LifecycleRepo;
  /** The remote branch, as `origin/<branch>`. Its SHA is the `baseCommit` of each bundle entry. */
  readonly upstreamRef: string;
  readonly build: Builder;
  readonly supervisor: Supervisor;
  readonly state: StateStore;
  readonly status: Status;
  /** `.cms/<site>/bundles`: each bundle is a folder under it, named by its bundleId. */
  readonly bundlesDir: string;
  readonly log: Logger;
  /** Reads the bundle.json of a manifest folder. Default: the directory source's `current`. */
  readonly readBundle?:
    | ((manifestDir: string) => Promise<BundleRef | null>)
    | undefined;
  /** The id of each new bundle, as the build runner takes it. Default: a random UUID. */
  readonly newBundleId?: (() => string) | undefined;
}

/** The lifecycle: the start-up, the triggers, and the stop. */
export interface BundleLifecycle {
  /** Start-up: starts the node on the current bundle and checks it, or builds the first bundle when there is none. */
  start(): Promise<void>;
  /** Builds `cms/work` HEAD for `reason`, then serves it. Resolves with how it ended; it does not reject. */
  trigger(reason: TriggerReason): Promise<TriggerOutcome>;
  /** Stops the lifecycle: no new build starts, and the build in flight is killed. */
  stop(): Promise<void>;
  /** The bundles whose swap is queued or running: the builder keeps them when it collects old bundles (2.9c review). */
  pendingSwaps(): ReadonlySet<string>;
}

// The error a build gets when it is asked for after stop.
const STOPPING = 'The preview is stopping, so no build starts';

/** Makes the lifecycle over `options`. Nothing runs until start() or trigger() is called. */
export function createBundleLifecycle(
  options: LifecycleOptions,
): BundleLifecycle {
  const {
    repo,
    upstreamRef,
    build,
    supervisor,
    state,
    status,
    bundlesDir,
    log,
    readBundle = (manifestDir) => directoryBundleSource(manifestDir).current(),
    newBundleId,
  } = options;
  let stopped = false;
  // The base each commit was read with, under the lock, by the trigger that asked for it.
  const baseOfCommit = new Map<string, string>();
  // The base of each bundle, by bundleId: the base read with the commit the bundle was built from.
  const baseOfBundle = new Map<string, string>();
  // The serve of each bundle, by bundleId. Triggers that share one build result share its serve, so a bundle is swapped in once.
  const serving = new Map<string, Promise<TriggerOutcome>>();
  // The protocol count each caller sharing a bundle's serve asked for, by bundleId: the largest one is kept, so a caller
  // that registers later cannot lower it, and a caller without a count changes nothing. The serve reads it when it runs.
  const inheritedOf = new Map<string, number>();
  // The bundles whose swap is queued or waiting for the node. A build's collection keeps their folders until the swap settles.
  const swapsPending = new Set<string>();
  // The triggers still under way, so stop() can wait for them.
  const working = new Set<Promise<TriggerOutcome>>();
  // The swaps and the restarts, one after another: each starts only after the one before it has settled.
  let swapChain: Promise<unknown> = Promise.resolve();
  // The number of the latest swap asked for. A failed swap recovers the last good bundle only while it is still the latest.
  let latestSwap = 0;
  // The triggers under way (build, serve and swap). The build state is building while any runs, and idle or failed once the last one ends.
  let inFlight = 0;
  // Whether the most recent build that ended failed. A nested build (a protocol rebuild) can fail while its outer trigger is
  // still under way, so the state at the end is read from this, not from the outer trigger's own outcome.
  let lastBuildFailed = false;
  // The commit of the last build that failed, and its error. A trigger for that commit is not built again (2.9c-B recovery).
  let lastFailure: { readonly commit: string; readonly error: string } | null =
    null;
  // One build at a time, and the triggers that wait merge into one queued build. After stop, a queued build is refused.
  const runner = createBuildRunner({
    build: (job) => {
      if (stopped) return Promise.reject(new Error(STOPPING));
      const base = baseOfCommit.get(job.commit);
      // Cannot happen: a trigger reads the base with its commit before it asks the runner for that commit.
      if (base === undefined) {
        return Promise.reject(new Error(`No base was read for ${job.commit}`));
      }
      baseOfBundle.set(job.bundleId, base);
      return build(job);
    },
    ...(newBundleId === undefined ? {} : { newBundleId }),
  });

  /** Start-up: a node on the current bundle, checked for protocol; or the first build when the state names none. */
  async function start(): Promise<void> {
    const current = state.get().current;
    if (current === null) {
      await runBuild('first-start', undefined);
      return;
    }
    const started = await supervisor.start({
      bundleId: current.bundleId,
      dir: join(bundlesDir, current.bundleId),
    });
    if (!started.ok) {
      log.error('The preview node did not start', {
        bundle: current.bundleId,
        error: started.error,
      });
    }
    await checkProtocol(current);
  }

  /** A trigger: builds `cms/work` HEAD for `reason`, then serves it. */
  function trigger(reason: TriggerReason): Promise<TriggerOutcome> {
    return runBuild(reason, undefined);
  }

  /**
   * Stops the lifecycle: no build starts and no swap follows. The build in flight is killed, the queued one is refused by
   * the runner, and this waits for the triggers already under way, so none of them swaps after it resolves.
   */
  async function stop(): Promise<void> {
    stopped = true;
    await build.stop();
    await Promise.allSettled([...working]);
  }

  /**
   * Builds `cms/work` HEAD and serves the result. `inherited` is the protocol count the new bundle takes: set by a
   * protocol rebuild, so the rebuilt bundle's own mismatch is only reported. Every failure is an outcome, not a rejection.
   */
  async function runBuild(
    reason: TriggerReason,
    inherited: number | undefined,
  ): Promise<TriggerOutcome> {
    inFlight += 1;
    status.setBuildState('building');
    const work = buildAndServe(reason, inherited);
    working.add(work);
    try {
      const outcome = await work;
      // The state is idle, or failed, only when this is the last trigger under way. While another one runs it stays building.
      if (inFlight === 1) {
        status.setBuildState(lastBuildFailed ? 'failed' : 'idle');
      }
      return outcome;
    } finally {
      inFlight -= 1;
      working.delete(work);
    }
  }

  /**
   * One trigger's build: reads `cms/work` HEAD and origin's branch together under the lock, waits for the build of that
   * head, then serves the bundle. Every failure is an outcome, not a rejection.
   */
  async function buildAndServe(
    reason: TriggerReason,
    inherited: number | undefined,
  ): Promise<TriggerOutcome> {
    if (stopped) return { kind: 'stopped' };
    log.info('A build was asked for', { reason });
    try {
      const pair = await repo.locked('build head', async (tx) => ({
        head: await tx.revParse(WORK_REF),
        base: await tx.revParse(upstreamRef),
      }));
      baseOfCommit.set(pair.head, pair.base);
      // The same commit fails the same way, so a commit whose build failed is not built again. A restart is the retry.
      const failure = lastFailure;
      if (failure !== null && failure.commit === pair.head) {
        log.info(
          'The commit failed to build before, so it is not built again',
          {
            reason,
            commit: pair.head,
          },
        );
        return buildFailed(failure.error, pair.head);
      }
      const result = await runner.request(pair.head);
      if (!result.ok) {
        return buildFailed(buildErrorText(result.firstError), pair.head);
      }
      lastBuildFailed = false;
      lastFailure = null;
      status.setBuildError(null);
      status.setFailedCommit(null);
      return await serveOnce(result, inherited);
    } catch (error: unknown) {
      return buildFailed(messageOf(error), null);
    }
  }

  /**
   * Records a failed build's error in the status, and returns its outcome. A build that ran (`commit` given) is kept as the
   * last failure. The node keeps serving what it served.
   */
  function buildFailed(error: string, commit: string | null): TriggerOutcome {
    lastBuildFailed = true;
    status.setBuildError(error);
    if (commit !== null) {
      lastFailure = { commit, error };
      status.setFailedCommit(commit);
    }
    return { kind: 'build-failed', error };
  }

  /**
   * Serves a built bundle once. Triggers that share one build result share its serve, and so its outcome: the node is
   * swapped once, and each trigger gets the same answer.
   */
  function serveOnce(
    built: BuildResult,
    inherited: number | undefined,
  ): Promise<TriggerOutcome> {
    // Every caller registers its count before the shared serve can write the state, whichever one created that serve.
    if (inherited !== undefined) {
      inheritedOf.set(
        built.bundleId,
        Math.max(inheritedOf.get(built.bundleId) ?? 0, inherited),
      );
    }
    const shared = serving.get(built.bundleId);
    if (shared !== undefined) return shared;
    const served = serveBundle(built);
    serving.set(built.bundleId, served);
    return served;
  }

  /** Swaps the node onto a built bundle. On success the state names it; on failure it is rolled back as the supervisor did. */
  async function serveBundle(built: BuildResult): Promise<TriggerOutcome> {
    const { bundleId, dir } = built;
    const base = baseOfBundle.get(bundleId);
    // Cannot happen: the runner builds a bundle only after its base was recorded, in the build wrapper.
    if (base === undefined) {
      throw new Error(`No base was read for bundle ${bundleId}`);
    }
    // stop() may have come while the build ran. The check is repeated where the swap starts, after any earlier swap has settled.
    if (stopped) return { kind: 'stopped' };
    const entry: BundleEntry = { bundleId, baseCommit: base };
    latestSwap += 1;
    const seq = latestSwap;
    const swap = await keepWhileSwapping(bundleId, () =>
      inOrder(async () =>
        stopped ? undefined : await supervisor.swap({ bundleId, dir }),
      ),
    );
    if (swap === undefined) return { kind: 'stopped' };
    if (!swap.ok) {
      status.setSwapError(swap.error);
      // Recover only if no newer swap was asked for meanwhile: that swap is the one the node should serve.
      if (!swap.rolledBack) {
        await inOrder(async () => {
          if (seq === latestSwap) await restartLastGood();
        });
      }
      return {
        kind: 'swap-failed',
        error: swap.error,
        rolledBack: swap.rolledBack,
      };
    }
    status.setSwapError(null);
    // The largest count any caller sharing this serve asked for, read when the state is written (after the swap).
    const attempts = new Map(state.get().protocolAttempts);
    const merged = inheritedOf.get(bundleId);
    if (merged !== undefined) attempts.set(bundleId, merged);
    await state.set({
      current: entry,
      lastGood: entry,
      protocolAttempts: attempts,
    });
    await checkProtocol(entry);
    return { kind: 'served', bundleId };
  }

  /**
   * Runs `work` after every swap and restart asked for before it has settled, so they never overlap. A failure of an
   * earlier one does not stop the chain.
   */
  function inOrder<T>(work: () => Promise<T>): Promise<T> {
    const run = swapChain.then(work);
    swapChain = run.catch(() => undefined);
    return run;
  }

  /** Starts the last good bundle again, after a swap that failed without a rollback. Nothing is started when there is none. */
  async function restartLastGood(): Promise<void> {
    const last = state.get().lastGood;
    if (last === null) return;
    const restarted = await supervisor.start({
      bundleId: last.bundleId,
      dir: join(bundlesDir, last.bundleId),
    });
    if (!restarted.ok) {
      log.error('The last good bundle did not restart', {
        bundle: last.bundleId,
        error: restarted.error,
      });
    }
  }

  /**
   * The protocol check of a served bundle. A mismatch is shown in the status. The first mismatch of a chain (the bundle
   * has no count yet) records a count of 1 and rebuilds once; the rebuilt bundle inherits the count, so its mismatch is
   * only shown.
   */
  async function checkProtocol(entry: BundleEntry): Promise<void> {
    const problem = await protocolProblem(entry.bundleId);
    // A bundle that was served before a newer one is no longer the one to show or to rebuild: the newer one decides.
    if (state.get().current?.bundleId !== entry.bundleId) return;
    status.setProtocolMismatch(problem);
    if (problem === null) return;
    const count = state.get().protocolAttempts.get(entry.bundleId) ?? 0;
    if (count > 0) return;
    const next = count + 1;
    const attempts = new Map(state.get().protocolAttempts).set(
      entry.bundleId,
      next,
    );
    await state.set({ ...state.get(), protocolAttempts: attempts });
    log.warn('The bundle does not match the protocol, so it is rebuilt once', {
      bundle: entry.bundleId,
      problem,
    });
    await runBuild('protocol-mismatch', next);
  }

  /**
   * The reason a bundle does not match the protocol, or null when it matches. A bundle with no bundle.json (built before
   * the protocol versions) counts as a mismatch, and so does a bundle.json that cannot be read.
   */
  async function protocolProblem(bundleId: string): Promise<string | null> {
    let ref: BundleRef | null;
    try {
      ref = await readBundle(bundleManifestDir(bundlesDir, bundleId));
    } catch (error: unknown) {
      return `Bundle ${bundleId} has a bundle.json that cannot be read: ${messageOf(error)}`;
    }
    if (ref === null) {
      return `Bundle ${bundleId} has no bundle.json, so it was built before the protocol versions. The server speaks protocol ${PROTOCOL_VERSION}`;
    }
    const built = ref.identity.protocolVersion;
    return built === PROTOCOL_VERSION
      ? null
      : `Bundle ${bundleId} speaks protocol ${built}, and the server speaks protocol ${PROTOCOL_VERSION}`;
  }

  /** The bundles whose swap is queued or running now, as a copy taken at the call. A collection reads it when it runs. */
  function pendingSwaps(): ReadonlySet<string> {
    return new Set(swapsPending);
  }

  /** Runs one bundle's swap while the bundle is kept: it is removed again when the swap settles, however it ends. */
  async function keepWhileSwapping<T>(
    bundleId: string,
    swap: () => Promise<T>,
  ): Promise<T> {
    swapsPending.add(bundleId);
    try {
      return await swap();
    } finally {
      swapsPending.delete(bundleId);
    }
  }

  return { start, trigger, stop, pendingSwaps };
}

/** The text of a failed build's first error: its message, with the file it names when there is one. */
function buildErrorText(error: BuildError | null): string {
  if (error === null) return 'The build failed';
  return error.file === null
    ? error.message
    : `${error.file}: ${error.message}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
