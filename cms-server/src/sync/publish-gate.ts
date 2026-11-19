// The publish gate (WORKPLAN 2.10l, 2.10e-STATE-TABLE section 4 invariant 6, PHASE-2-DESIGN 4.2). It is the only place that
// decides whether a save or a poll tick may run while a publish is in progress, and the only place that handles the saves
// made since the snapshot `S`, the `cms/work` HEAD that a publish squashed. The publish click closes the gate at once,
// before it waits for the repo lock. A save or a poll tick checks the gate before it takes the lock and again after it, so
// one that queued on the lock while the click arrived sees the closed gate. Phase 2 refuses those saves and asserts that
// `cms/work` is still at `S` around the push. Design 1 (phase 4 or 5) would accept them and re-apply them onto `C`.
import { apiError, type ApiError } from 'cms-contract';
import type { RepoTx } from '../git/ops.ts';
import { WORK_REF } from '../git/repo.ts';
import type { Status } from '../preview/status.ts';

/** The one call the gate makes on `cms/work` inside the lock: its HEAD. */
export type WorkTx = Pick<RepoTx, 'revParse'>;

/** The text of a 409 `publish-in-progress`: a save or a second publish that meets the closed gate. Nothing was written. */
const PUBLISH_RUNNING =
  'A publish is running, so nothing was saved or published by this request. Try again once it is done.';

/** The gate of the app. One gate serves the save routes, the poll loop and the publish. */
export interface PublishGate {
  /**
   * The publish click. Closes the gate at once, before any wait for the repo lock. Undefined when it closed the gate, so
   * the publish may run. A publish that already holds the gate gets the 409, and changes nothing.
   */
  begin(): ApiError<'publish-in-progress'> | undefined;
  /** Reopens the gate. A publish calls it once its answer is decided, on every path. */
  end(): void;
  /**
   * Whether a save may run: undefined, or the 409 that refuses it. A pure check, called before the save takes the lock and
   * again under it.
   */
  saveStop(): ApiError<'publish-in-progress'> | undefined;
  /**
   * Called under the lock by a save that may run: clears a sticky `failed` publish status, so the next save or publish
   * starts from `idle` (2.10l).
   */
  clearFailed(): void;
  /** Whether a poll tick may sync. Called before the tick takes the lock and again under it. */
  pollMayRun(): boolean;
  /** Under the lock, before the push: asserts `cms/work` is still at `base`, the snapshot `S` of this attempt. */
  beforePush(tx: WorkTx, base: string): Promise<void>;
  /** Under the lock, after an accepted push and before `cms/work` moves to the pushed commit: the same assertion. */
  afterPush(tx: WorkTx, base: string): Promise<void>;
}

/** The parts of the gate: the status, whose publish state a save that may run clears when it is `failed`. */
export interface PublishGateDeps {
  readonly status: Pick<Status, 'setPublish'>;
}

/** Makes the gate over `status`. It starts open. */
export function createPublishGate({ status }: PublishGateDeps): PublishGate {
  // True from a publish click to that publish's answer.
  let closed = false;

  function refusal(): ApiError<'publish-in-progress'> {
    return apiError('publish-in-progress', { message: PUBLISH_RUNNING });
  }

  // `cms/work` must not have moved from `base`. A move is a bug, not a race: the gate keeps the saves out.
  async function assertAt(
    tx: WorkTx,
    base: string,
    when: string,
  ): Promise<void> {
    const head = await tx.revParse(WORK_REF);
    if (head !== base)
      throw new Error(
        `cms/work moved from ${base} to ${head} ${when}, so the publish stops`,
      );
  }

  return {
    begin() {
      if (closed) return refusal();
      closed = true;
      return undefined;
    },
    end() {
      closed = false;
    },
    saveStop() {
      return closed ? refusal() : undefined;
    },
    clearFailed() {
      status.setPublish('idle');
    },
    pollMayRun() {
      return !closed;
    },
    beforePush(tx, base) {
      return assertAt(tx, base, 'before the push');
    },
    afterPush(tx, base) {
      return assertAt(tx, base, 'during the push');
    },
  };
}
