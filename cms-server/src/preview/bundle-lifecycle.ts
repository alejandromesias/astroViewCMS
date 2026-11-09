// The bundle lifecycle of cms-server (WORKPLAN 2.9c, PHASE-2-DESIGN 4.4 and 5.6). A trigger names its reason. It resolves
// `cms/work` to a SHA under the repo lock, builds that SHA through the build runner (outside the lock, one build at a
// time), and swaps the node onto the new bundle. A failed swap keeps the failed bundle out of the state, and the last good
// bundle is started again when the supervisor did not roll back itself. After each served bundle the protocol check
// compares its bundle.json with PROTOCOL_VERSION: the first mismatch of a chain rebuilds once, and the new bundle carries
// the count, so a mismatch on it is only reported.
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

/** The part of the repo the lifecycle reads: `cms/work` under the lock, and origin's branch without it. */
export interface LifecycleRepo {
  locked<T>(
    holder: string,
    work: (tx: Pick<RepoTx, 'revParse'>) => Promise<T>,
  ): Promise<T>;
  revParse(ref: string): Promise<string>;
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
  // One build at a time, and the triggers that wait merge into one queued build. After stop, a queued build is refused.
  const runner = createBuildRunner({
    build: (job) =>
      stopped ? Promise.reject(new Error(STOPPING)) : build(job),
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

  /** Stops the lifecycle, then kills the build in flight. The queued build, if any, is refused by the runner. */
  async function stop(): Promise<void> {
    stopped = true;
    await build.stop();
  }

  /**
   * Builds `cms/work` HEAD and serves the result. `inherited` is the protocol count the new bundle takes: set by a
   * protocol rebuild, so the rebuilt bundle's own mismatch is only reported. Every failure is an outcome, not a rejection.
   */
  async function runBuild(
    reason: TriggerReason,
    inherited: number | undefined,
  ): Promise<TriggerOutcome> {
    if (stopped) return { kind: 'stopped' };
    log.info('A build was asked for', { reason });
    status.setBuildState('building');
    try {
      const commit = await repo.locked('build head', (tx) =>
        tx.revParse(WORK_REF),
      );
      const result = await runner.request(commit);
      if (!result.ok) return buildFailed(buildErrorText(result.firstError));
      status.setBuildError(null);
      return await serve(result, inherited);
    } catch (error: unknown) {
      return buildFailed(messageOf(error));
    }
  }

  /** Records a failed build in the status, and returns its outcome. The node keeps serving what it served. */
  function buildFailed(error: string): TriggerOutcome {
    status.setBuildState('failed');
    status.setBuildError(error);
    return { kind: 'build-failed', error };
  }

  /** Swaps the node onto a built bundle. On success the state names it; on failure it is rolled back as the supervisor did. */
  async function serve(
    built: BuildResult,
    inherited: number | undefined,
  ): Promise<TriggerOutcome> {
    const { bundleId, dir } = built;
    const entry: BundleEntry = {
      bundleId,
      baseCommit: await repo.revParse(upstreamRef),
    };
    const swap = await supervisor.swap({ bundleId, dir });
    status.setBuildState('idle');
    if (!swap.ok) {
      status.setSwapError(swap.error);
      if (!swap.rolledBack) await restartLastGood();
      return {
        kind: 'swap-failed',
        error: swap.error,
        rolledBack: swap.rolledBack,
      };
    }
    status.setSwapError(null);
    const attempts = new Map(state.get().protocolAttempts);
    if (inherited !== undefined) attempts.set(bundleId, inherited);
    await state.set({
      current: entry,
      lastGood: entry,
      protocolAttempts: attempts,
    });
    await checkProtocol(entry);
    return { kind: 'served', bundleId };
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

  return { start, trigger, stop };
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
