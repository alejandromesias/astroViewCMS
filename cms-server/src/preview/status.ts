// The status of cms-server's preview (WORKPLAN 2.9c, PHASE-2-DESIGN 5.6): what GET /api/status reports beyond the bundle.
// The lifecycle sets the build, swap and protocol fields. The sync, upstream and publish fields are set by 2.10g, 2.10f
// and 2.10d through the setters. The node state is read from the supervisor, and the changeset size from the repo,
// on each snapshot.
import type { Supervisor } from './supervisor.ts';

/** Where the builder stands: `off` with --bundle, otherwise idle, building, or failed (the last build failed). */
export type BuildState = 'off' | 'idle' | 'building' | 'failed';

/** The publish state (2.10d): idle, publishing, or failed (the last publish failed). */
export type PublishState = 'idle' | 'publishing' | 'failed';

/** What GET /api/status adds to its `bundle` key. */
export interface StatusBody {
  readonly builder: 'on' | 'off';
  readonly build: { readonly state: BuildState; readonly error: string | null };
  readonly node: {
    readonly state: ReturnType<Supervisor['status']>['state'];
    readonly bundleId: string | null;
    readonly error: string | null;
  };
  readonly lastSync: string | null;
  readonly syncError: string | null;
  /** The number of files `cms/work` changes from origin, or null when git cannot count them. */
  readonly changesetSize: number | null;
  readonly publish: PublishState;
  readonly errors: {
    readonly protocolMismatch: string | null;
    readonly upstreamBuildFailed: string | null;
    /** The error of the last swap that failed (the node was rolled back or restarted). */
    readonly swap: string | null;
  };
}

/** Anything that answers GET /api/status with the status body. */
export interface StatusSource {
  snapshot(): Promise<StatusBody>;
}

/** The holder: the setters for the fields the lifecycle and later tasks own, and the snapshot that reads them all. */
export interface Status extends StatusSource {
  /** Sets the builder's state: building, idle, or failed. */
  setBuildState(state: BuildState): void;
  /** Sets the error of the last failed build, or clears it with null. */
  setBuildError(error: string | null): void;
  /** Sets the error of the last failed swap, or clears it with null. */
  setSwapError(error: string | null): void;
  /** Sets the protocol mismatch text of the served bundle, or clears it with null. */
  setProtocolMismatch(text: string | null): void;
  /** Sets the time of the last sync (2.10g), or clears it with null. */
  setLastSync(at: string | null): void;
  /** Sets the error of the last sync (2.10g), or clears it with null. */
  setSyncError(text: string | null): void;
  /** Sets the upstream build failure (2.10f), or clears it with null. */
  setUpstreamBuildFailed(text: string | null): void;
  /** Sets the publish state (2.10d). */
  setPublish(state: PublishState): void;
}

/** The options of the holder. `builder` is `off` with --bundle. `node` and `changedPaths` are read on each snapshot. */
export interface StatusOptions {
  readonly builder: 'on' | 'off';
  readonly node: () => ReturnType<Supervisor['status']>;
  readonly changedPaths: () => Promise<readonly unknown[]>;
}

// The values the setters write. Each field starts as the first start has it.
interface Values {
  buildState: BuildState;
  buildError: string | null;
  swapError: string | null;
  protocolMismatch: string | null;
  lastSync: string | null;
  syncError: string | null;
  upstreamBuildFailed: string | null;
  publish: PublishState;
}

/** Makes the status holder. Its fields start empty, and the builder's state is `off` when the builder is off. */
export function createStatus(options: StatusOptions): Status {
  const { builder, node, changedPaths } = options;
  const values: Values = {
    buildState: builder === 'off' ? 'off' : 'idle',
    buildError: null,
    swapError: null,
    protocolMismatch: null,
    lastSync: null,
    syncError: null,
    upstreamBuildFailed: null,
    publish: 'idle',
  };
  // The changeset size: the paths `cms/work` changes from origin, or null when git cannot count them.
  const changesetSize = (): Promise<number | null> =>
    changedPaths().then(
      (paths) => paths.length,
      () => null,
    );
  return {
    setBuildState(state) {
      values.buildState = state;
    },
    setBuildError(error) {
      values.buildError = error;
    },
    setSwapError(error) {
      values.swapError = error;
    },
    setProtocolMismatch(text) {
      values.protocolMismatch = text;
    },
    setLastSync(at) {
      values.lastSync = at;
    },
    setSyncError(text) {
      values.syncError = text;
    },
    setUpstreamBuildFailed(text) {
      values.upstreamBuildFailed = text;
    },
    setPublish(state) {
      values.publish = state;
    },
    async snapshot() {
      const current = node();
      return {
        builder,
        build: { state: values.buildState, error: values.buildError },
        node: {
          state: current.state,
          bundleId: current.bundleId,
          error: current.error,
        },
        lastSync: values.lastSync,
        syncError: values.syncError,
        changesetSize: await changesetSize(),
        publish: values.publish,
        errors: {
          protocolMismatch: values.protocolMismatch,
          upstreamBuildFailed: values.upstreamBuildFailed,
          swap: values.swapError,
        },
      };
    },
  };
}
