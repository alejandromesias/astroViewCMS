import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../log.ts';
import {
  createPollLoop,
  type PollDeps,
  type PollLoop,
  SESSION_MS,
} from './poll.ts';
import type { SyncNowOutcome } from './sync.ts';

const INTERVAL_MS = 60_000;

/** A synced outcome that moved `cms/work` by a change of the given kind. */
function syncedOf(change: 'none' | 'content-only' | 'code'): SyncNowOutcome {
  return { kind: 'synced', change, tip: 'tip', renamed: [], upstream: 'tip' };
}

/** A loop over spies. `syncNow` answers `unchanged` unless the test replaces it. */
function loopOf(overrides: Partial<PollDeps> = {}) {
  const syncNow = vi.fn(() =>
    Promise.resolve<SyncNowOutcome>({ kind: 'unchanged' }),
  );
  const status = { setSyncError: vi.fn() };
  const trigger = vi.fn();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
  const loop = createPollLoop({
    syncNow,
    status,
    trigger,
    nodeServes: () => true,
    intervalMs: INTERVAL_MS,
    log,
    ...overrides,
  });
  return { loop, syncNow, status, trigger, log };
}

/** Calls `touch` once a minute, so the session stays open while a test watches the delays of the syncs. */
function keepOpen(loop: PollLoop): void {
  setInterval(() => loop.touch(), INTERVAL_MS);
}

describe('createPollLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is idle until the first call: no sync runs without one', async () => {
    const { syncNow } = loopOf();
    await vi.advanceTimersByTimeAsync(10 * SESSION_MS);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('a call starts the loop: the first sync is one interval after it, then one per interval while the session is open', async () => {
    const { loop, syncNow } = loopOf();
    loop.touch();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(syncNow).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(syncNow).toHaveBeenCalledTimes(1);
    // 240 s is still under five minutes after the call, so the fourth sync runs.
    await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);
    expect(syncNow).toHaveBeenCalledTimes(4);
  });

  it('stops when the session is idle: a call five minutes old is no session, and the loop starts again on the next call', async () => {
    const { loop, syncNow } = loopOf();
    loop.touch();
    // The syncs at 60, 120, 180 and 240 s run; the one at 300 s finds the call exactly five minutes old, so it is idle.
    await vi.advanceTimersByTimeAsync(10 * INTERVAL_MS);
    expect(syncNow).toHaveBeenCalledTimes(4);
    loop.touch();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(syncNow).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(syncNow).toHaveBeenCalledTimes(5);
  });

  it('keeps polling while calls keep coming, and stops after the last one goes five minutes old', async () => {
    const { loop, syncNow } = loopOf();
    loop.touch();
    await vi.advanceTimersByTimeAsync(200_000);
    loop.touch();
    // The syncs at 240, 300, 360, 420 and 480 s find a call under five minutes old (the last one is at 200 s).
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(syncNow).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(syncNow).toHaveBeenCalledTimes(8);
  });

  it('backs off after a sync that throws: the delay doubles up to ten minutes, and the first success returns it to the interval', async () => {
    const start = Date.now();
    const times: number[] = [];
    let calls = 0;
    const { loop, status, log } = loopOf({
      syncNow: vi.fn(() => {
        times.push(Date.now() - start);
        calls += 1;
        if (calls <= 4) return Promise.reject(new Error('boom'));
        return Promise.resolve<SyncNowOutcome>({ kind: 'unchanged' });
      }),
    });
    keepOpen(loop);
    loop.touch();
    await vi.advanceTimersByTimeAsync(1_560_000);
    // Delays after each failure: 2, 4, 8 and then 10 (the ceiling) intervals; after the success, 1 interval.
    expect(times).toEqual([
      60_000, 180_000, 420_000, 900_000, 1_500_000, 1_560_000,
    ]);
    expect(status.setSyncError).toHaveBeenCalledTimes(4);
    expect(status.setSyncError).toHaveBeenCalledWith('boom');
    expect(log.warn).toHaveBeenCalledWith('The sync failed', { error: 'boom' });
  });

  it('a back-off never shortens an interval over ten minutes: a failure waits the interval again', async () => {
    const start = Date.now();
    const times: number[] = [];
    const { loop } = loopOf({
      intervalMs: 1_200_000,
      syncNow: vi.fn(() => {
        times.push(Date.now() - start);
        return Promise.reject(new Error('boom'));
      }),
    });
    keepOpen(loop);
    loop.touch();
    await vi.advanceTimersByTimeAsync(2_400_000);
    expect(times).toEqual([1_200_000, 2_400_000]);
  });

  it('a throw after a sync (the node check here) is one failed sync, and the loop still polls again', async () => {
    const start = Date.now();
    const times: number[] = [];
    const { loop, status, trigger } = loopOf({
      nodeServes: () => {
        throw new Error('node check broke');
      },
      syncNow: vi.fn(() => {
        times.push(Date.now() - start);
        return Promise.resolve(syncedOf('content-only'));
      }),
    });
    keepOpen(loop);
    loop.touch();
    // Each failed tick waits longer: 60 s, then 60 + 120 s.
    await vi.advanceTimersByTimeAsync(180_000);
    expect(times).toEqual([60_000, 180_000]);
    expect(status.setSyncError).toHaveBeenCalledWith('node check broke');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('a failed outcome backs off too, and the loop leaves the status to syncNow', async () => {
    const start = Date.now();
    const times: number[] = [];
    const { loop, status, log } = loopOf({
      syncNow: vi.fn(() => {
        times.push(Date.now() - start);
        return Promise.resolve<SyncNowOutcome>({
          kind: 'failed',
          message: 'fetch failed',
        });
      }),
    });
    keepOpen(loop);
    loop.touch();
    await vi.advanceTimersByTimeAsync(420_000);
    expect(times).toEqual([60_000, 180_000, 420_000]);
    expect(status.setSyncError).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith('The sync failed', {
      error: 'fetch failed',
    });
  });

  it.each([
    [
      (): unknown => new Error('fetch https://user:tok@github.com/x failed'),
      'fetch https://***@github.com/x failed',
    ],
    [(): unknown => 'plain text', 'plain text'],
  ] as const)(
    'a sync that throws reports its text with credentials redacted (case %#)',
    async (thrown, message) => {
      const { loop, status, log } = loopOf({
        syncNow: vi.fn(() => Promise.reject(thrown())),
      });
      loop.touch();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(status.setSyncError).toHaveBeenCalledWith(message);
      expect(log.warn).toHaveBeenCalledWith('The sync failed', {
        error: message,
      });
    },
  );

  it('a skipped sync (the lock is busy) is neither an error nor a back-off', async () => {
    const start = Date.now();
    const times: number[] = [];
    let calls = 0;
    const { loop, status, log } = loopOf({
      syncNow: vi.fn(() => {
        times.push(Date.now() - start);
        calls += 1;
        return Promise.resolve<SyncNowOutcome>(
          calls === 1 ? { kind: 'skipped' } : { kind: 'unchanged' },
        );
      }),
    });
    keepOpen(loop);
    loop.touch();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(times).toEqual([60_000, 120_000]);
    expect(status.setSyncError).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['content-only', false, 1],
    ['content-only', true, 0],
    ['code', false, 0],
    ['none', false, 0],
  ] as const)(
    'a sync that finds a %s change while nodeServes is %s asks for %i build(s)',
    async (change, nodeServes, builds) => {
      const { loop, trigger } = loopOf({
        nodeServes: () => nodeServes,
        syncNow: vi.fn(() => Promise.resolve(syncedOf(change))),
      });
      loop.touch();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(trigger).toHaveBeenCalledTimes(builds);
      if (builds === 1) expect(trigger).toHaveBeenCalledWith('sync-code');
    },
  );

  it('an unchanged origin builds nothing, even while no node serves', async () => {
    const { loop, trigger } = loopOf({ nodeServes: () => false });
    loop.touch();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('stop() cancels the next sync, and a call after it does not start the loop again', async () => {
    const { loop, syncNow } = loopOf();
    loop.touch();
    await loop.stop();
    await vi.advanceTimersByTimeAsync(10 * INTERVAL_MS);
    loop.touch();
    await vi.advanceTimersByTimeAsync(10 * INTERVAL_MS);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('stop() waits for the sync under way, and no sync runs after it', async () => {
    let release: () => void = () => {};
    const pending = new Promise<SyncNowOutcome>((resolve) => {
      release = () => resolve({ kind: 'unchanged' });
    });
    const syncNow = vi.fn(() => pending);
    const { loop } = loopOf({ syncNow });
    loop.touch();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(syncNow).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * INTERVAL_MS);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });
});
