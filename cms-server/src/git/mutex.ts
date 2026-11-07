// The in-process lock of the CMS clone (WORKPLAN 2.3c). Every operation that changes the clone's index, refs or
// worktrees runs inside `run`, one at a time, in arrival order. A waiter that waits too long gives up with an error
// that names the holder. The holder itself is never interrupted.

/** The timer functions the lock uses. The real ones are the default; tests pass a fake. */
export interface Clock {
  /** Calls `callback` after `ms` milliseconds. The returned handle is what `clearTimeout` takes. */
  setTimeout(callback: () => void, ms: number): unknown;
  /** Cancels a timer made by `setTimeout`. */
  clearTimeout(handle: unknown): void;
}

/** The real timers. */
const systemClock: Clock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** How long a waiter may wait, in ms. Sized for saves and syncs. */
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

/** A waiter gave up. `holder` is the operation that held the lock when the wait ended. */
export class LockTimeoutError extends Error {
  readonly holder: string;

  /** Names the holder and the timeout in the message. */
  constructor(holder: string, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs} ms waiting for the repo lock, which ${holder} holds.`,
    );
    this.name = 'LockTimeoutError';
    this.holder = holder;
  }
}

/** A FIFO lock over async work. */
export interface Mutex {
  /** Runs `task` after every earlier call has settled. The lock is released when `task` settles, even on a throw. */
  run<T>(holder: string, task: () => Promise<T>): Promise<T>;
}

export interface MutexOptions {
  /** How long a waiter may wait before it gives up, in ms. */
  timeoutMs?: number;
  /** The timers that the waiters' timeouts use. */
  clock?: Clock;
}

// A waiter in line: who it is, and how to hand it the lock.
interface Waiter {
  readonly holder: string;
  grant(): void;
}

/** Makes a lock with its own line of waiters. Each call to `run` takes its own lock, so two mutexes never block each other. */
export function createMutex({
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  clock = systemClock,
}: MutexOptions = {}): Mutex {
  const line: Waiter[] = [];
  let busy = false;
  let holder = '';

  // Takes the lock now when it is free. Otherwise waits in line; a waiter that times out leaves the line and rejects.
  function acquire(name: string): Promise<void> {
    if (!busy) {
      busy = true;
      holder = name;
      return Promise.resolve();
    }
    return new Promise<void>((grant, reject) => {
      const timer = clock.setTimeout(() => {
        line.splice(line.indexOf(waiter), 1);
        reject(new LockTimeoutError(holder, timeoutMs));
      }, timeoutMs);
      const waiter: Waiter = {
        holder: name,
        grant: () => {
          clock.clearTimeout(timer);
          grant();
        },
      };
      line.push(waiter);
    });
  }

  // Hands the lock to the next waiter in line, or frees it when nobody waits.
  function release(): void {
    const next = line.shift();
    if (next === undefined) {
      busy = false;
      holder = '';
      return;
    }
    holder = next.holder;
    next.grant();
  }

  return {
    async run<T>(name: string, task: () => Promise<T>): Promise<T> {
      await acquire(name);
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
