// The one place where a repo lock that stayed busy becomes an answer (WORKPLAN 2.10d item 5). The save route and publish
// both call it; a sync that gives up on the lock skips its tick instead (`syncNow`, 2.10c item 5).
import { LockTimeoutError } from '../git/mutex.ts';
import type { SaveStop } from './context.ts';

/**
 * `503 busy` for a `LockTimeoutError`, naming the operation that held the lock; undefined for any other error. The lock
 * waiters give up after 30 s, so this is an answer to try again, not a fault.
 */
export function busyStop(error: unknown): SaveStop | undefined {
  if (!(error instanceof LockTimeoutError)) return undefined;
  return {
    status: 503,
    body: {
      error: 'busy',
      message: `The site is busy with another operation (${error.holder}). Try again in a moment.`,
    },
  };
}
