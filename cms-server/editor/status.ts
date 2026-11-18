// The publish state of the CMS, read from GET /api/status (WORKPLAN 2.11d). `startStatusPolling` reads the status at once and
// reports each change of the publish state or the upstream build error. While the server reports a publish running, it reads
// again every `intervalMs`; when no publish runs, it stops. A publish this page starts is answered by its own request, so
// the page does not need a poll for it. The module names no DOM type, and `fetch` and the timer are passed in.
import type { StatusAnswerBody } from 'cms-contract';
import { type FetchLike, getStatus } from './api.ts';

/** The publish state of the server: idle, publishing, or failed (its last publish). */
type PublishState = NonNullable<StatusAnswerBody['publish']>['state'];

/** The part of the status the publish controls show. */
export interface PublishStatus {
  /** `publish.state`; undefined when the status has no publish part (the server does not publish). */
  readonly state: PublishState | undefined;
  /** `publish.error`: the message of the last publish that failed, or null. */
  readonly error: string | null;
  /** `errors.upstreamBuildFailed`: the build error of the upstream code, or null. */
  readonly upstreamBuildFailed: string | null;
}

/** How many milliseconds pass between two reads while a publish runs. */
export const STATUS_POLL_MS = 1000;

/** The part of a status answer the publish controls read. A status without a publish part gives no state. */
export function publishStatusOf(body: StatusAnswerBody): PublishStatus {
  return {
    state: body.publish?.state,
    error: body.publish?.error ?? null,
    upstreamBuildFailed: body.errors?.upstreamBuildFailed ?? null,
  };
}

/** The options of `startStatusPolling`. Only `fetchImpl` and `onChange` are needed; the rest have the real defaults. */
export interface StatusPollOptions {
  readonly fetchImpl: FetchLike;
  /** Called with the status when it differs from the one reported before. A failed read reports nothing. */
  readonly onChange: (status: PublishStatus) => void;
  /** The milliseconds between two reads while a publish runs. */
  readonly intervalMs?: number;
  /** Runs `run` after `ms` and returns a function that cancels it. The default is `setTimeout`. */
  readonly schedule?: (run: () => void, ms: number) => () => void;
}

/** The real timer: `setTimeout`, cancelled with `clearTimeout`. */
function scheduleTimeout(run: () => void, ms: number): () => void {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
}

/**
 * Starts reading `GET /api/status`. The first read happens at once. Returns `stop`, which ends the reads and cancels the
 * one waiting to run. A read that fails keeps the last state: a publish that was running keeps being polled.
 */
export function startStatusPolling(options: StatusPollOptions): () => void {
  const {
    fetchImpl,
    onChange,
    intervalMs = STATUS_POLL_MS,
    schedule = scheduleTimeout,
  } = options;
  let stopped = false;
  let running = false;
  let cancelNext: (() => void) | undefined;
  /** The last status reported, as text, so an unchanged answer is not reported again. */
  let reported: string | undefined;

  /** Reads the status, reports it when it changed, and schedules the next read while a publish runs. */
  async function poll(): Promise<void> {
    const answer = await getStatus(fetchImpl);
    if (stopped) return;
    if (answer.ok) {
      const status = publishStatusOf(answer.body);
      const text = JSON.stringify(status);
      running = status.state === 'publishing';
      if (text !== reported) {
        reported = text;
        onChange(status);
      }
    }
    if (running) cancelNext = schedule(() => void poll(), intervalMs);
  }

  void poll();
  return () => {
    stopped = true;
    cancelNext?.();
  };
}
