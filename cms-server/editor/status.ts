// The publish state of the CMS, read from GET /api/status (WORKPLAN 2.11d). `startStatusPolling` reads the status at once and
// reports each change of the publish state, the preview node or the upstream build error. While the server reports a publish
// running, or the preview changing (a build runs, or the node is starting or restarting), it reads again every `intervalMs`;
// otherwise every `idleIntervalMs`. The reads go on until `stop`; the editor stops them while its page is hidden. A publish
// this page starts is answered by its own request. The module names no DOM type, and `fetch` and the timer are passed in.
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
  /** `node.state`: the preview node's state; undefined when the status has no node part. */
  readonly node?: NodeState | undefined;
  /** `build.state`: the state of the build; undefined when the status has no build part. */
  readonly build?: BuildState | undefined;
}

/** The state of the preview node, from `node.state`. */
type NodeState = NonNullable<StatusAnswerBody['node']>['state'];

/** The state of the build, from `build.state`. */
type BuildState = NonNullable<StatusAnswerBody['build']>['state'];

/** How many milliseconds pass between two reads while a publish runs or the preview changes. */
export const STATUS_POLL_MS = 1000;

/** How many milliseconds pass between two reads while nothing runs. A build-driven swap shows in a read before the node leaves ready; a crash restart has no build signal, so its first read can come this long after it starts. */
export const STATUS_IDLE_POLL_MS = 5000;

/** The part of a status answer the publish controls read. A status without a publish part gives no state. */
export function publishStatusOf(body: StatusAnswerBody): PublishStatus {
  return {
    state: body.publish?.state,
    error: body.publish?.error ?? null,
    upstreamBuildFailed: body.errors?.upstreamBuildFailed ?? null,
    node: body.node?.state,
    build: body.build?.state,
  };
}

/** True while the preview changes: a build runs, or the node is starting or restarting after one. The reads go on then, so the
 *  page sees the node become ready. */
export function previewChanging(status: PublishStatus): boolean {
  return (
    status.build === 'building' ||
    status.node === 'starting' ||
    status.node === 'restarting'
  );
}

/** Why Save is off while the preview node is not ready, for the button's tooltip. Empty when the node is ready or not reported:
 *  the preview refuses a save then, so the button waits for it. */
export function previewNotReadyText(node: NodeState | undefined): string {
  if (node === undefined || node === 'ready') return '';
  if (node === 'starting') return 'Preview is starting';
  if (node === 'restarting') return 'Preview is restarting';
  return 'Preview is not ready';
}

/** The status after a failed publish: its failed state is shown as idle, so the status line does not repeat the error that
 *  the publish's own answer shows. The upstream build error stays (2.11d). */
export function withoutFailedPublish(status: PublishStatus): PublishStatus {
  return {
    ...status,
    state: status.state === 'failed' ? 'idle' : status.state,
    error: null,
  };
}

/** The options of `startStatusPolling`. Only `fetchImpl` and `onChange` are needed; the rest have the real defaults. */
export interface StatusPollOptions {
  readonly fetchImpl: FetchLike;
  /** Called with the status when it differs from the one reported before. A failed read reports nothing. */
  readonly onChange: (status: PublishStatus) => void;
  /** The milliseconds between two reads while a publish runs or the preview changes. */
  readonly intervalMs?: number;
  /** The milliseconds between two reads while nothing runs. */
  readonly idleIntervalMs?: number;
  /** Whether the state the caller last saw was busy. It decides the interval after a first read that fails. Default false. */
  readonly initiallyBusy?: boolean;
  /** Runs `run` after `ms` and returns a function that cancels it. The default is `setTimeout`. */
  readonly schedule?: (run: () => void, ms: number) => () => void;
  /** Called with every answered read, changed or not (`onChange` is not, for an unchanged answer). */
  readonly onRead?: (status: PublishStatus) => void;
}

/** The real timer: `setTimeout`, cancelled with `clearTimeout`. */
function scheduleTimeout(run: () => void, ms: number): () => void {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
}

/**
 * Starts reading `GET /api/status`. The first read happens at once, and the next one comes after `intervalMs` while something
 * runs and after `idleIntervalMs` while nothing does. Returns `stop`, which ends the reads and cancels the one waiting to run.
 * A read that fails keeps the last state: a publish that was running keeps being polled at its interval.
 */
export function startStatusPolling(options: StatusPollOptions): () => void {
  const {
    fetchImpl,
    onChange,
    intervalMs = STATUS_POLL_MS,
    idleIntervalMs = STATUS_IDLE_POLL_MS,
    schedule = scheduleTimeout,
    onRead,
    initiallyBusy = false,
  } = options;
  let stopped = false;
  /** Whether the last answered read found something running. A failed read keeps it, starting from `initiallyBusy`. */
  let busy = initiallyBusy;
  let cancelNext: (() => void) | undefined;
  /** The last status reported, as text, so an unchanged answer is not reported again. */
  let reported: string | undefined;

  /** Reads the status, reports it when it changed, and schedules the next read at the interval for what the read found. */
  async function poll(): Promise<void> {
    // A read that rejects (its body could not be read) is a failed read: the last state stands and the next read is still scheduled.
    const answer = await getStatus(fetchImpl).catch(() => undefined);
    if (stopped) return;
    if (answer?.ok) {
      const status = publishStatusOf(answer.body);
      const text = JSON.stringify(status);
      busy = status.state === 'publishing' || previewChanging(status);
      onRead?.(status);
      if (text !== reported) {
        reported = text;
        onChange(status);
      }
    }
    cancelNext = schedule(
      () => void poll(),
      busy ? intervalMs : idleIntervalMs,
    );
  }

  void poll();
  return () => {
    stopped = true;
    cancelNext?.();
  };
}
