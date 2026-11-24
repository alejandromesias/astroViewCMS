// The bundle lifecycle of cms-server (WORKPLAN 2.9c, PHASE-2-DESIGN 4.4 and 5.6). A trigger names its reason. It resolves
// `cms/work` to a SHA under the repo lock, builds that SHA through the build runner (outside the lock, one build at a
// time), and swaps the node onto the new bundle. A failed swap keeps the failed bundle out of the state, and the last good
// bundle is started again when the supervisor did not roll back itself. After each served bundle the protocol check
// compares its bundle.json with PROTOCOL_VERSION and SCHEMA_VERSION: the first mismatch of a chain rebuilds once, and the
// new bundle carries the count, so a mismatch on it is only reported. A commit whose build failed is not built again by the same lifecycle:
// a restart is the retry (2.9c-B recovery rule).
import { join } from 'node:path';
import { SCHEMA_VERSION } from 'preview-contract';
import { PROTOCOL_VERSION } from 'preview-protocol';
import { BundleError, readBundle as readBundleFolder } from '../bundle/read.ts';
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
import { removeBundle } from './bundles.ts';
import type { BundleEntry, StateStore } from './state.ts';
import type { Status } from './status.ts';
import type { Supervisor } from './supervisor.ts';

/** Why a build is asked for. `protocol-mismatch` is also what the protocol check asks for. */
export type TriggerReason =
  | 'first-start'
  | 'save-rebuild'
  | 'protocol-mismatch'
  | 'sync-code'
  | 'publish'
  | 'invalid-bundle';

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

/** How one swap ended, as the swap helper reports it. The helper writes no state: its caller does (2.10m). */
type SwapStep =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'failed';
      readonly error: string;
      readonly rolledBack: boolean;
    };

/** A candidate of a publish (2.10m): the commit built before it is pushed, and the bundle it was built into. */
export interface Candidate {
  readonly commit: string;
  readonly bundleId: string;
  readonly dir: string;
}

/** How a candidate build ended. A failed candidate changes no bundle state: the node keeps serving what it served. */
export type CandidateOutcome =
  | { readonly kind: 'built'; readonly candidate: Candidate }
  | { readonly kind: 'failed'; readonly error: string };

/**
 * The part of the repo the lifecycle reads. `cms/work` and origin's branch are read together under the lock, so a
 * trigger's head and base are the pair it saw (a sync cannot move origin between the two reads).
 */
export interface LifecycleRepo {
  locked<T>(
    holder: string,
    work: (tx: Pick<RepoTx, 'revParse' | 'isAncestor'>) => Promise<T>,
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
  /**
   * Reads every file of a bundle folder as the CMS serves it, and rejects with the first error (bundle/read.ts). A bundle.json
   * that is missing or invalid is not counted here: the protocol check reports it. Default: the bundle reader.
   */
  readonly readFiles?: ((manifestDir: string) => Promise<void>) | undefined;
  /** The id of each new bundle, as the build runner takes it. Default: a random UUID. */
  readonly newBundleId?: (() => string) | undefined;
}

/** The lifecycle: the start-up, the triggers, and the stop. */
export interface BundleLifecycle {
  /** Start-up: starts the node on the current bundle and checks it, or builds the first bundle when there is none. */
  start(): Promise<void>;
  /**
   * Builds `cms/work` HEAD for `reason`, then serves it. Resolves with how it ended; it does not reject. A `sync-code` names
   * the origin tip its sync integrated (`upstream`): when that build fails, the tip is built once to tell whose fault it is (2.10f).
   */
  trigger(reason: TriggerReason, upstream?: string): Promise<TriggerOutcome>;
  /** Stops the lifecycle: no new build starts, and the build in flight is killed. */
  stop(): Promise<void>;
  /**
   * The bundles the builder keeps when it collects old bundles (2.9c review): those whose swap is queued or running, and
   * the one the node was swapped onto while no state write names it yet (2.10m).
   */
  pendingSwaps(): ReadonlySet<string>;
  /** True while a trigger is under way (a build, its swap, or a nested protocol rebuild). A publish reads it (2.10d). */
  busy(): boolean;
  /**
   * Resolves true once no trigger is under way, at once when none is, or false after `timeoutMs` (2.10d). A publish waits
   * here, with the repo lock released, for the build that a sync of code asked for.
   */
  waitForIdle(timeoutMs: number): Promise<boolean>;
  /**
   * Builds `commit` as a candidate of a publish (2.10m). It takes the build slot after the builds already queued, and runs
   * the raw builder. A failure is an outcome and changes no bundle state.
   */
  buildCandidate(commit: string): Promise<CandidateOutcome>;
  /**
   * Under the repo lock, after the candidate's push: swaps the node onto it and writes the state. `tx` reads origin's branch,
   * since a lock taken here would deadlock. Resolves false when the swap failed. No protocol check runs here (afterAdopt).
   */
  adopt(candidate: Candidate, tx: Pick<RepoTx, 'revParse'>): Promise<boolean>;
  /** After the lock is released: runs the protocol check of an adopted candidate. Does nothing once a newer bundle is served. */
  afterAdopt(candidate: Candidate): Promise<void>;
  /** Removes a candidate's bundle folder. The builder has already removed the candidate's worktree. */
  discard(candidate: Candidate): Promise<void>;
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
    readFiles = readFilesOf,
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
  // The bundle the node was last swapped onto, while the state does not name it: its state write failed, or has not run
  // yet. It is kept, as the node serves it. A later swap that succeeds replaces it; its state write clears it.
  let unrecorded: string | null = null;
  // The triggers still under way, so stop() can wait for them.
  const working = new Set<Promise<TriggerOutcome>>();
  // The swaps and the restarts, one after another: each starts only after the one before it has settled.
  let swapChain: Promise<unknown> = Promise.resolve();
  // The number of the latest swap asked for. A failed swap recovers the last good bundle only while it is still the latest.
  let latestSwap = 0;
  // The triggers under way (build, serve and swap). The build state is building while any runs, and idle or failed once the last one ends.
  let inFlight = 0;
  // The publishes waiting for `inFlight` to reach 0: each resolves its wait with true.
  const idleWaiters = new Set<() => void>();
  // Whether the most recent build that ended failed. A nested build (a protocol rebuild) can fail while its outer trigger is
  // still under way, so the state at the end is read from this, not from the outer trigger's own outcome.
  let lastBuildFailed = false;
  // The commit of the last build that failed, and its error, recorded by the build wrapper as each build ends. A commit
  // with a failure is not built again by this lifecycle (2.9c-B recovery).
  let lastFailure: { readonly commit: string; readonly error: string } | null =
    null;
  // The candidate adopted last, by its commit and bundle: a trigger that reads that commit answers from it (2.10m).
  let adopted: { readonly commit: string; readonly bundleId: string } | null =
    null;
  // One build at a time, and the triggers that wait merge into one queued build. After stop, a queued build is refused.
  const runner = createBuildRunner({
    build: async (job) => {
      if (stopped) throw new Error(STOPPING);
      const base = baseOfCommit.get(job.commit);
      // Cannot happen: a trigger reads the base with its commit before it asks the runner for that commit.
      if (base === undefined)
        throw new Error(`No base was read for ${job.commit}`);
      // Checked when the build starts, not when the trigger asks: a queued build for a commit that failed meanwhile does not run.
      const failure = lastFailure;
      if (failure !== null && failure.commit === job.commit) {
        log.info(
          'The commit failed to build before, so it is not built again',
          {
            commit: job.commit,
          },
        );
        return {
          bundleId: job.bundleId,
          dir: join(bundlesDir, job.bundleId),
          ok: false,
          firstError: { file: null, message: failure.error },
        };
      }
      baseOfBundle.set(job.bundleId, base);
      const result = await build(job);
      // Recorded before the next queued build starts, so that build sees this failure.
      lastFailure = result.ok
        ? null
        : { commit: job.commit, error: buildErrorText(result.firstError) };
      status.setFailedCommit(lastFailure?.commit ?? null);
      return result;
    },
    // A candidate runs the raw builder: its failure is not a failed request, so it touches none of the bookkeeping above.
    buildCandidate: build,
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
    // A bundle with a missing or invalid file is replaced by a build, not checked for protocol (2.14a-2, F9).
    const problem = await filesProblem(current.bundleId);
    if (problem !== null) {
      log.warn(
        'The bundle the state names is invalid, so a build is asked for',
        {
          bundle: current.bundleId,
          error: problem,
        },
      );
      await runBuild('invalid-bundle', undefined);
      return;
    }
    await checkProtocol(current);
  }

  /** A trigger: builds `cms/work` HEAD for `reason`, then serves it. */
  function trigger(
    reason: TriggerReason,
    upstream?: string,
  ): Promise<TriggerOutcome> {
    return runBuild(reason, undefined, upstream);
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
    upstream?: string,
  ): Promise<TriggerOutcome> {
    inFlight += 1;
    status.setBuildState('building');
    const work = buildAndServe(reason, inherited, upstream);
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
      if (inFlight === 0) {
        for (const waiter of idleWaiters) waiter();
        idleWaiters.clear();
      }
    }
  }

  /**
   * One trigger's build: reads `cms/work` HEAD and origin's branch together under the lock, waits for the build of that
   * head, then serves the bundle. Every failure is an outcome, not a rejection.
   */
  async function buildAndServe(
    reason: TriggerReason,
    inherited: number | undefined,
    upstream: string | undefined,
  ): Promise<TriggerOutcome> {
    if (stopped) return { kind: 'stopped' };
    log.info('A build was asked for', { reason });
    try {
      const pair = await repo.locked('build head', async (tx) => {
        const head = await tx.revParse(WORK_REF);
        const base = await tx.revParse(upstreamRef);
        return { head, base, holdsTip: await tx.isAncestor(base, head) };
      });
      baseOfCommit.set(pair.head, pair.base);
      // A candidate adopted for this commit, on this base, already serves it: the trigger has nothing to build (2.10m). A
      // protocol rebuild (`inherited` set) is never answered from it: the adopted bundle is the one that does not match.
      const current = state.get().current;
      if (
        inherited === undefined &&
        adopted?.commit === pair.head &&
        current?.bundleId === adopted.bundleId &&
        current.baseCommit === pair.base
      )
        return { kind: 'served', bundleId: adopted.bundleId };
      const result = await runner.request(pair.head);
      if (!result.ok) {
        if (upstream !== undefined) await checkUpstream(upstream, pair.base);
        return buildFailed(buildErrorText(result.firstError));
      }
      lastBuildFailed = false;
      status.setBuildError(null);
      // A passing build of a commit that holds origin's tip clears the upstream failure, whatever the trigger (2.10f). A tip
      // that moved on after the head was made is not held, so the next sync's build decides.
      if (pair.holdsTip) status.setUpstreamBuildFailed(null);
      return await serveOnce(result, inherited);
    } catch (error: unknown) {
      return buildFailed(messageOf(error));
    }
  }

  /**
   * After a failed `sync-code` build, builds the origin tip the sync integrated, once (2.10f). A tip that fails is the
   * upstream's fault, and is recorded with its first error. A tip that builds means the changeset is at fault, so the
   * failure of `cms/work` stands alone, and a flag is cleared while origin still reads that tip. The candidate is always
   * discarded. Nothing is recorded once stop() has come.
   */
  async function checkUpstream(
    upstream: string,
    current: string,
  ): Promise<void> {
    const tip = await buildCandidate(upstream);
    if (tip.kind === 'built') {
      await discard(tip.candidate);
      if (current === upstream) status.setUpstreamBuildFailed(null);
      return;
    }
    if (!stopped)
      status.setUpstreamBuildFailed({ sha: upstream, firstError: tip.error });
  }

  /** Records a failed build's error in the status, and returns its outcome. The node keeps serving what it served. */
  function buildFailed(error: string): TriggerOutcome {
    lastBuildFailed = true;
    status.setBuildError(error);
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
    const swap = await swapOnto(bundleId, dir);
    if (swap.kind === 'stopped') return { kind: 'stopped' };
    if (swap.kind === 'failed')
      return {
        kind: 'swap-failed',
        error: swap.error,
        rolledBack: swap.rolledBack,
      };
    // The largest count any caller sharing this serve asked for, read when the state is written (after the swap).
    const attempts = new Map(state.get().protocolAttempts);
    const merged = inheritedOf.get(bundleId);
    if (merged !== undefined) attempts.set(bundleId, merged);
    await state.set({
      current: entry,
      lastGood: entry,
      protocolAttempts: attempts,
    });
    if (unrecorded === bundleId) unrecorded = null;
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
   * One swap of the chain (serveBundle's and adopt's): its number, the bundle kept while it swaps, the swap error set or
   * cleared, and the rollback. A failed swap that was not rolled back starts the last good bundle again, unless a newer
   * swap was asked for meanwhile. `stopped` when a stop reached the swap before it started.
   */
  async function swapOnto(bundleId: string, dir: string): Promise<SwapStep> {
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
      return { kind: 'failed', error: swap.error, rolledBack: swap.rolledBack };
    }
    status.setSwapError(null);
    unrecorded = bundleId;
    return { kind: 'ok' };
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
    log.warn(
      'The bundle does not match the protocol or the schema version, so it is rebuilt once',
      {
        bundle: entry.bundleId,
        problem,
      },
    );
    await runBuild('protocol-mismatch', next);
  }

  /**
   * The reason a bundle does not match the protocol or the schema version, or null when it matches. A bundle with no
   * bundle.json (built before the protocol versions) counts as a mismatch, and so does a bundle.json that cannot be read.
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
    if (built !== PROTOCOL_VERSION) {
      return `Bundle ${bundleId} speaks protocol ${built}, and the server speaks protocol ${PROTOCOL_VERSION}`;
    }
    return schemaProblem(bundleId, ref.identity.schemaVersion);
  }

  /**
   * The reason the files of a bundle cannot be read as the CMS reads them, or null when they can. A bundle.json that is
   * missing or invalid is no reason here: checkProtocol reports it, and rebuilds it once.
   */
  async function filesProblem(bundleId: string): Promise<string | null> {
    try {
      await readFiles(bundleManifestDir(bundlesDir, bundleId));
      return null;
    } catch (error: unknown) {
      if (error instanceof BundleError && error.file === 'bundle.json')
        return null;
      return messageOf(error);
    }
  }

  /** The bundles a collection keeps now, as a copy taken at the call (see the interface). A collection reads it when it runs. */
  function pendingSwaps(): ReadonlySet<string> {
    const kept = new Set(swapsPending);
    if (unrecorded !== null) kept.add(unrecorded);
    return kept;
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

  /** True while any trigger is under way. */
  function busy(): boolean {
    return inFlight > 0;
  }

  /** Waits for `inFlight` to reach 0, up to `timeoutMs`. */
  function waitForIdle(timeoutMs: number): Promise<boolean> {
    if (inFlight === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      // A waiter that timed out stays in the set until the next idle, which calls it with no effect.
      const timer = setTimeout(() => resolve(false), timeoutMs);
      idleWaiters.add(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Builds `commit` as a candidate. No bundle state changes; a failure is an outcome. */
  async function buildCandidate(commit: string): Promise<CandidateOutcome> {
    if (stopped) return { kind: 'failed', error: STOPPING };
    log.info('A candidate build was asked for', { commit });
    try {
      const result = await runner.candidate(commit);
      if (!result.ok)
        return { kind: 'failed', error: buildErrorText(result.firstError) };
      return {
        kind: 'built',
        candidate: { commit, bundleId: result.bundleId, dir: result.dir },
      };
    } catch (error: unknown) {
      return { kind: 'failed', error: messageOf(error) };
    }
  }

  /**
   * Swaps the node onto a pushed candidate, and writes the state (serveBundle's path, without the protocol check). The
   * entry's base is origin's branch, read with `tx` under the lock the caller holds.
   */
  async function adopt(
    candidate: Candidate,
    tx: Pick<RepoTx, 'revParse'>,
  ): Promise<boolean> {
    // A read that fails before the swap leaves the node on its bundle, so the candidate is refused, not unknown (2.10m).
    let base: string;
    try {
      base = await tx.revParse(upstreamRef);
    } catch (error: unknown) {
      log.error('The candidate was not adopted: origin could not be read', {
        bundleId: candidate.bundleId,
        error: messageOf(error),
      });
      return false;
    }
    if (stopped) return false;
    const entry: BundleEntry = {
      bundleId: candidate.bundleId,
      baseCommit: base,
    };
    const swap = await swapOnto(candidate.bundleId, candidate.dir);
    if (swap.kind !== 'ok') return false;
    // Only a candidate that passed its build and was pushed reaches here: it sits on the origin tip it was pushed on, so the
    // upstream failure of that tip, if one is set, is over (2.10f). Cleared after the swap: a read or swap that fails leaves the
    // node on its old bundle, and the status keeps saying that upstream does not build.
    status.setUpstreamBuildFailed(null);
    // The node serves a candidate that built and swapped, so the errors of earlier builds and swaps no longer apply (as buildAndServe).
    lastBuildFailed = false;
    status.setBuildError(null);
    // The build state is idle when no trigger is under way; with one under way, the trigger sets it when it ends (runBuild).
    if (inFlight === 0) status.setBuildState('idle');
    await state.set({
      current: entry,
      lastGood: entry,
      protocolAttempts: new Map(state.get().protocolAttempts),
    });
    if (unrecorded === candidate.bundleId) unrecorded = null;
    adopted = { commit: candidate.commit, bundleId: candidate.bundleId };
    return true;
  }

  /**
   * The protocol check of an adopted candidate. Runs without the lock: a rebuild takes it. It is a trigger under way from the
   * call on, so `busy` and `waitForIdle` see it before the check awaits anything.
   */
  async function afterAdopt(candidate: Candidate): Promise<void> {
    inFlight += 1;
    try {
      const current = state.get().current;
      if (current === null || current.bundleId !== candidate.bundleId) return;
      await checkProtocol(current);
    } finally {
      // The state is set as runBuild sets it, when this is the last trigger under way.
      if (inFlight === 1)
        status.setBuildState(lastBuildFailed ? 'failed' : 'idle');
      inFlight -= 1;
      if (inFlight === 0) {
        for (const waiter of idleWaiters) waiter();
        idleWaiters.clear();
      }
    }
  }

  /** Removes the folder of a candidate that is not adopted. A failure is logged: the publish that calls this has its answer. */
  async function discard(candidate: Candidate): Promise<void> {
    await removeBundle(bundlesDir, candidate.bundleId).catch(
      (error: unknown) => {
        log.warn('Could not remove the candidate bundle', {
          bundleId: candidate.bundleId,
          error: messageOf(error),
        });
      },
    );
  }

  return {
    start,
    trigger,
    stop,
    pendingSwaps,
    busy,
    waitForIdle,
    buildCandidate,
    adopt,
    afterAdopt,
    discard,
  };
}

/**
 * Reads a manifest folder's files as the CMS serves it: bundle.json, then the others with it (bundle/read.ts). A folder
 * without bundle.json has nothing to read here, so it resolves.
 */
async function readFilesOf(manifestDir: string): Promise<void> {
  const ref = await directoryBundleSource(manifestDir).current();
  if (ref !== null) await readBundleFolder(manifestDir, ref.identity);
}

/** The text of a failed build's first error: its message, with the file it names when there is one. */
function buildErrorText(error: BuildError | null): string {
  if (error === null) return 'The build failed';
  return error.file === null
    ? error.message
    : `${error.file}: ${error.message}`;
}

/**
 * The reason a bundle's schema.json version is not the server's, or null when it is. A bundle.json with no schemaVersion
 * (built before schema version 2) counts as a mismatch, with its own message.
 */
function schemaProblem(
  bundleId: string,
  built: number | undefined,
): string | null {
  if (built === SCHEMA_VERSION) return null;
  return built === undefined
    ? `Bundle ${bundleId} has no schema version, and the server expects schema version ${SCHEMA_VERSION}`
    : `Bundle ${bundleId} has schema version ${built}, and the server expects schema version ${SCHEMA_VERSION}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
