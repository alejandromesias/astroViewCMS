// The poll loop of cms-server (WORKPLAN 2.10g, PHASE-2-DESIGN 4.2 and 5.6). While a session is open it calls `syncNow` every
// `intervalMs`. A session is open while the last /api call is under five minutes old: the app's middleware calls `touch`
// on each call, and the loop starts again on a call when it has gone idle. A failed sync doubles the delay, up to ten
// minutes; the first success returns it to the interval. While no node serves, a sync that finds a content-only change
// asks for a build of `cms/work` HEAD (the failed-first-build recovery, 2.9c-B). The lifecycle refuses a commit that
// already failed, so the failed SHA is not built again.
import { redact } from '../git/exec.ts';
import type { Logger } from '../log.ts';
import type { Status } from '../preview/status.ts';
import type { SyncNowOutcome } from './sync.ts';

/** A session is open while its last /api call is less than this old, in milliseconds (2.10g item 2). */
export const SESSION_MS = 5 * 60 * 1000;

/** The longest delay between two syncs while they fail, in milliseconds (2.10g item 3). */
const MAX_BACKOFF_MS = 10 * 60 * 1000;

/** The parts of the loop: the sync, the status, the trigger, the node check, the interval and the clock. */
export interface PollDeps {
  readonly syncNow: () => Promise<SyncNowOutcome>;
  readonly status: Pick<Status, 'setSyncError'>;
  /** Asks for a build of `cms/work` HEAD. It is called without waiting, as the sync's own trigger is. */
  readonly trigger: (reason: 'sync-code') => void;
  /** True while a node serves the bundle. While none does, a sync that finds a content-only change asks for a build. */
  readonly nodeServes: () => boolean;
  /** The time between two syncs, in milliseconds (`syncIntervalSeconds`). */
  readonly intervalMs: number;
  readonly log: Logger;
  /** The clock, in milliseconds since the epoch. The default is the real one. */
  readonly now?: () => number;
}

/** The loop: the call that records an API call, and the stop. */
export interface PollLoop {
  /** Records an /api call at the current time. When the loop is idle, it starts again; after a lapsed session, its first sync is one interval after this call. */
  touch(): void;
  /** Cancels the next sync and waits for the one under way. The loop does not start again after this. */
  stop(): Promise<void>;
}

/** Makes the poll loop over `deps`. It is idle until the first `touch`. */
export function createPollLoop({
  syncNow,
  status,
  trigger,
  nodeServes,
  intervalMs,
  log,
  now = () => Date.now(),
}: PollDeps): PollLoop {
  // The time of the last /api call. Undefined until one comes, so no session is open.
  let lastCall: number | undefined;
  // The syncs that failed in a row. Each one doubles the delay; a success sets it to 0.
  let failures = 0;
  // True while the loop has a sync scheduled or under way.
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The sync under way, so stop() can wait for it.
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  // True when a call starts a new session while a sync is under way: the next sync is one interval after that sync.
  let restart = false;

  function isOpen(): boolean {
    return lastCall !== undefined && now() - lastCall < SESSION_MS;
  }

  function delay(): number {
    if (failures === 0) return intervalMs;
    return Math.max(
      intervalMs,
      Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS),
    );
  }

  function schedule(wait = delay()): void {
    timer = setTimeout(() => void tick(), wait);
  }

  async function tick(): Promise<void> {
    timer = undefined;
    // The session went idle: the loop stops until the next call.
    if (!isOpen()) {
      active = false;
      return;
    }
    inFlight = pollOnce();
    try {
      await inFlight;
    } finally {
      inFlight = undefined;
      // Scheduled even when the tick threw, so one failure cannot end the loop.
      if (!stopped) schedule(restart ? intervalMs : delay());
      restart = false;
    }
  }

  // Never rejects: a throw from syncNow, or from the work after it (the trigger, the node check), is one failed sync.
  async function pollOnce(): Promise<void> {
    try {
      react(await syncNow());
    } catch (error: unknown) {
      const message = redact(messageOf(error));
      failures += 1;
      status.setSyncError(message);
      log.warn('The sync failed', { error: message });
    }
  }

  function react(outcome: SyncNowOutcome): void {
    switch (outcome.kind) {
      case 'synced':
        if (outcome.change === 'content-only' && !nodeServes())
          trigger('sync-code');
        failures = 0;
        return;
      case 'unchanged':
        failures = 0;
        return;
      case 'skipped':
        // A publish holds the lock: that is normal, so it is no error and no back-off.
        return;
      case 'failed':
        // syncNow has already set the status's syncError to the same message.
        failures += 1;
        log.warn('The sync failed', { error: outcome.message });
        return;
    }
  }

  function touch(): void {
    // Checked before the call's time is recorded: a call after five minutes without one starts a new session (2.10g).
    const newSession = !isOpen();
    lastCall = now();
    if (stopped) return;
    if (!active) {
      active = true;
      schedule(intervalMs);
      return;
    }
    if (!newSession) return;
    if (inFlight === undefined) {
      // A back-off timer from the last session is pending: the new session's first sync is one interval after this call.
      clearTimeout(timer);
      schedule(intervalMs);
    } else {
      restart = true;
    }
  }

  async function stop(): Promise<void> {
    stopped = true;
    clearTimeout(timer);
    timer = undefined;
    await inFlight;
  }

  return { touch, stop };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
