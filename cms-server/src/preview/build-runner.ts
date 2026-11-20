// The build queue of cms-server (WORKPLAN 2.9a, PHASE-2-DESIGN 4.4). One build runs at a time. A trigger
// during a build queues one more build, and each trigger during that queued build merges into it. The queued
// build takes the newest commit asked for. Every caller gets the result of the build that covers its request.
import { randomUUID } from 'node:crypto';

/** The first failing file of a build, and its message. `file` is relative to the site folder, when the build named one. */
export interface BuildError {
  readonly file: string | null;
  readonly message: string;
}

/**
 * The outcome of one build. `dir` is the bundle folder. A failed build's folder is removed, so check `ok` first.
 */
export interface BuildResult {
  readonly bundleId: string;
  readonly dir: string;
  readonly ok: boolean;
  readonly firstError: BuildError | null;
}

/** One build to run: the commit to build, and the id its bundle gets. */
export interface BuildJob {
  readonly commit: string;
  readonly bundleId: string;
}

/** Runs one build. A rejection is an error of the machinery around the build, not a failed build. */
export type BuildFn = (job: BuildJob) => Promise<BuildResult>;

export interface BuildRunner {
  /** Asks for a build of `commit`. Resolves with the result of the build that runs it. */
  request(commit: string): Promise<BuildResult>;
  /**
   * Builds `commit` as a candidate (2.10m): it takes the build slot after the builds already queued, and runs
   * `buildCandidate`. A request made after it queues behind it and is not merged into it.
   */
  candidate(commit: string): Promise<BuildResult>;
}

export interface BuildRunnerOptions {
  readonly build: BuildFn;
  /** The function a candidate runs. Default: `build`. The lifecycle passes its raw builder, without the request bookkeeping. */
  readonly buildCandidate?: BuildFn;
  /** The id of each new bundle. Default: a random UUID. */
  readonly newBundleId?: () => string;
}

// A build waiting in the queue: the commit to build, the function that runs it, and the promise of every caller that waits
// for it. A request merges only into the last waiting build, and only when that one is a request, never a candidate.
interface Waiting {
  commit: string;
  readonly kind: 'request' | 'candidate';
  readonly run: BuildFn;
  readonly done: PromiseWithResolvers<BuildResult>;
}

export function createBuildRunner({
  build,
  buildCandidate = build,
  newBundleId = randomUUID,
}: BuildRunnerOptions): BuildRunner {
  // True while a drain runs. `queue` holds the builds that wait behind the running one, in the order they were asked for.
  let busy = false;
  const queue: Waiting[] = [];

  // Runs the queued builds in order, until none is left. A failed build rejects only its own callers.
  async function drain(): Promise<void> {
    let next = queue.shift();
    while (next !== undefined) {
      const current = next;
      try {
        const bundleId = newBundleId();
        current.done.resolve(
          await current.run({ commit: current.commit, bundleId }),
        );
      } catch (error: unknown) {
        current.done.reject(error);
      }
      next = queue.shift();
    }
    busy = false;
  }

  // Queues `waiting` behind the builds already queued, and starts the drain when none runs.
  function enqueue(waiting: Waiting): Promise<BuildResult> {
    queue.push(waiting);
    if (!busy) {
      busy = true;
      void drain();
    }
    return waiting.done.promise;
  }

  return {
    request(commit) {
      const last = queue.at(-1);
      if (last?.kind === 'request') {
        last.commit = commit;
        return last.done.promise;
      }
      return enqueue({
        commit,
        kind: 'request',
        run: build,
        done: Promise.withResolvers<BuildResult>(),
      });
    },
    candidate(commit) {
      return enqueue({
        commit,
        kind: 'candidate',
        run: buildCandidate,
        done: Promise.withResolvers<BuildResult>(),
      });
    },
  };
}
