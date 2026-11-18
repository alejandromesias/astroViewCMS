import type { StatusAnswerBody } from 'cms-contract';
import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from './api.ts';
import {
  type PublishStatus,
  publishStatusOf,
  STATUS_POLL_MS,
  startStatusPolling,
} from './status.ts';

/** The answer `fetch` gives in these tests: its JSON is read at once, so a test waits only for microtasks. */
type Answer = Awaited<ReturnType<FetchLike>>;

/** A status answer with this body and status code. */
function answerWith(body: unknown, status = 200): Answer {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** A status answer with the publish part and the upstream build error. */
function statusAnswer(
  state: 'idle' | 'publishing' | 'failed',
  error: string | null = null,
  upstreamBuildFailed: string | null = null,
): Answer {
  // `bundle` is required by statusAnswerSchema (null without a bundle), so the fixture names it.
  return answerWith({
    bundle: null,
    publish: { state, error },
    errors: { protocolMismatch: null, upstreamBuildFailed, swap: null },
  });
}

/** A fake `fetch` that answers each call with the next answer. */
function fetchAnswering(...answers: Answer[]) {
  return vi.fn<FetchLike>(
    async () => answers.shift() ?? answerWith({ error: 'not-found' }, 404),
  );
}

/** A schedule that keeps each run it is given, so a test runs it when it chooses; `runs` lists them in order. */
function manualSchedule() {
  const runs: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule = vi.fn((run: () => void, ms: number) => {
    const entry = { run, ms, cancelled: false };
    runs.push(entry);
    return () => {
      entry.cancelled = true;
    };
  });
  return { schedule, runs };
}

/** Lets the reads already started finish: a timer runs after the microtasks. */
const flush = () => new Promise<void>((done) => setTimeout(done, 0));

describe('publishStatusOf', () => {
  it('takes the state, the error of the last publish and the upstream build error', () => {
    const body: StatusAnswerBody = {
      bundle: null,
      publish: { state: 'failed', error: 'Push refused' },
      errors: {
        protocolMismatch: null,
        upstreamBuildFailed: 'Unexpected token',
        swap: null,
      },
    };
    expect(publishStatusOf(body)).toEqual({
      state: 'failed',
      error: 'Push refused',
      upstreamBuildFailed: 'Unexpected token',
    });
  });

  it('gives no state when the status has no publish part', () => {
    expect(publishStatusOf({ bundle: null })).toEqual({
      state: undefined,
      error: null,
      upstreamBuildFailed: null,
    });
  });

  it('gives no upstream build error when the status has no errors part', () => {
    expect(
      publishStatusOf({
        bundle: null,
        publish: { state: 'idle', error: null },
      }),
    ).toEqual({ state: 'idle', error: null, upstreamBuildFailed: null });
  });
});

describe('startStatusPolling', () => {
  it('reads the status at once and reports it', async () => {
    const fetchImpl = fetchAnswering(statusAnswer('idle'));
    const onChange = vi.fn<(status: PublishStatus) => void>();
    const stop = startStatusPolling({
      fetchImpl,
      onChange,
      schedule: manualSchedule().schedule,
    });
    await flush();
    expect(fetchImpl).toHaveBeenCalledWith('/api/status');
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      state: 'idle',
      error: null,
      upstreamBuildFailed: null,
    });
    stop();
  });

  it('reads again while a publish runs, and reports a read only when it changed', async () => {
    const { schedule, runs } = manualSchedule();
    const onChange = vi.fn<(status: PublishStatus) => void>();
    startStatusPolling({
      fetchImpl: fetchAnswering(
        statusAnswer('publishing'),
        statusAnswer('publishing'),
        statusAnswer('failed', 'Push refused'),
      ),
      onChange,
      schedule,
    });
    await flush();
    expect(runs).toHaveLength(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      state: 'publishing',
      error: null,
      upstreamBuildFailed: null,
    });

    // The same state again: read, not reported.
    runs[0]?.run();
    await flush();
    expect(runs).toHaveLength(2);
    expect(onChange).toHaveBeenCalledOnce();

    // The publish failed: reported, and no read is scheduled after it.
    runs[1]?.run();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({
      state: 'failed',
      error: 'Push refused',
      upstreamBuildFailed: null,
    });
    expect(runs).toHaveLength(2);
  });

  it('reports a change of the upstream build error while a publish runs', async () => {
    const { schedule, runs } = manualSchedule();
    const onChange = vi.fn<(status: PublishStatus) => void>();
    startStatusPolling({
      fetchImpl: fetchAnswering(
        statusAnswer('publishing'),
        statusAnswer('publishing', null, 'Unexpected token'),
      ),
      onChange,
      schedule,
    });
    await flush();
    runs[0]?.run();
    await flush();
    expect(onChange).toHaveBeenLastCalledWith({
      state: 'publishing',
      error: null,
      upstreamBuildFailed: 'Unexpected token',
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('waits the interval it is given between two reads', async () => {
    const { schedule } = manualSchedule();
    startStatusPolling({
      fetchImpl: fetchAnswering(statusAnswer('publishing')),
      onChange: vi.fn(),
      schedule,
      intervalMs: 250,
    });
    await flush();
    expect(schedule).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 250);
  });

  it('waits one second between reads by default, on a real timer', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = fetchAnswering(
        statusAnswer('publishing'),
        statusAnswer('idle'),
      );
      const onChange = vi.fn<(status: PublishStatus) => void>();
      startStatusPolling({ fetchImpl, onChange });
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
      expect(fetchImpl).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(STATUS_POLL_MS);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenLastCalledWith({
        state: 'idle',
        error: null,
        upstreamBuildFailed: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops at once when no publish runs', async () => {
    const { schedule } = manualSchedule();
    const onChange = vi.fn<(status: PublishStatus) => void>();
    startStatusPolling({
      fetchImpl: fetchAnswering(statusAnswer('idle')),
      onChange,
      schedule,
    });
    await flush();
    expect(onChange).toHaveBeenCalledOnce();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('keeps polling through a read that fails while a publish runs, and stops after a read that finds none', async () => {
    const { schedule, runs } = manualSchedule();
    const onChange = vi.fn<(status: PublishStatus) => void>();
    startStatusPolling({
      fetchImpl: fetchAnswering(
        statusAnswer('publishing'),
        answerWith({ error: 'internal_error' }, 500),
        statusAnswer('idle'),
      ),
      onChange,
      schedule,
    });
    await flush();
    runs[0]?.run();
    await flush();
    // The failed read reports nothing and keeps the publish's state, so it is polled again.
    expect(onChange).toHaveBeenCalledOnce();
    expect(runs).toHaveLength(2);
    runs[1]?.run();
    await flush();
    expect(onChange).toHaveBeenLastCalledWith({
      state: 'idle',
      error: null,
      upstreamBuildFailed: null,
    });
    expect(runs).toHaveLength(2);
  });

  it('stop cancels the read that waits to run', async () => {
    const { schedule, runs } = manualSchedule();
    const stop = startStatusPolling({
      fetchImpl: fetchAnswering(statusAnswer('publishing')),
      onChange: vi.fn(),
      schedule,
    });
    await flush();
    stop();
    expect(runs[0]?.cancelled).toBe(true);
  });

  it('stop during a read reports nothing and schedules nothing', async () => {
    const { schedule } = manualSchedule();
    const onChange = vi.fn<(status: PublishStatus) => void>();
    let finish: (answer: Answer) => void = () => {};
    const stop = startStatusPolling({
      fetchImpl: vi.fn<FetchLike>(
        () =>
          new Promise<Answer>((resolve) => {
            finish = resolve;
          }),
      ),
      onChange,
      schedule,
    });
    stop();
    finish(statusAnswer('publishing'));
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
});
