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
}

export interface BuildRunnerOptions {
  readonly build: BuildFn;
  /** The id of each new bundle. Default: a random UUID. */
  readonly newBundleId?: () => string;
}

// A build waiting in the queue: the newest commit asked for, and the promise of every trigger that merged into it.
interface Waiting {
  commit: string;
  readonly done: PromiseWithResolvers<BuildResult>;
}

export function createBuildRunner({
  build,
  newBundleId = randomUUID,
}: BuildRunnerOptions): BuildRunner {
  // True while a drain runs. `queued` is the one build that waits behind the running one.
  let busy = false;
  let queued: Waiting | undefined;

  // Runs `first`, then each queued build, until nothing is queued. A failed build rejects only its own callers.
  async function drain(first: Waiting): Promise<void> {
    let next: Waiting | undefined = first;
    while (next !== undefined) {
      const current = next;
      try {
        const bundleId = newBundleId();
        current.done.resolve(await build({ commit: current.commit, bundleId }));
      } catch (error: unknown) {
        current.done.reject(error);
      }
      next = queued;
      queued = undefined;
    }
    busy = false;
  }

  return {
    request(commit) {
      if (queued !== undefined) {
        queued.commit = commit;
        return queued.done.promise;
      }
      const waiting: Waiting = {
        commit,
        done: Promise.withResolvers<BuildResult>(),
      };
      if (busy) {
        queued = waiting;
      } else {
        busy = true;
        void drain(waiting);
      }
      return waiting.done.promise;
    },
  };
}
