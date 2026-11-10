// The sync routine of cms-server (WORKPLAN 2.10c, PHASE-2-DESIGN 4.2 and 4.4). `syncLocked` runs one sync under a lock that
// the caller holds: it fetches origin; when origin moved, it re-applies the saved changes on upstream and invalidates the
// delete guard's index; when the upstream change is code, it asks for a `sync-code` build; and it records the result in the
// status. `syncNow` takes the lock and runs `syncLocked`, so the poll loop (2.10g) calls `syncNow`, while publish (2.10d)
// already holds the lock and calls `syncLocked` (the lock is not re-entrant). A lock that stays busy skips the tick: a
// publish holding it is normal, so it is no error and no back-off.
import type { BundleStore } from '../bundle/store.ts';
import type { RenamedDocument } from '../documents/reapply.ts';
import { redact } from '../git/exec.ts';
import { LockTimeoutError } from '../git/mutex.ts';
import type { Repo, RepoTx } from '../git/ops.ts';
import { WORK_REF } from '../git/repo.ts';
import type { SyncChange } from '../git/sync.ts';
import type { Status } from '../preview/status.ts';
import type { DeleteGuard } from '../save/context.ts';

/** The calls a sync makes under the lock: the fetch, the re-apply, and the head of `cms/work`. */
export type SyncTx = Pick<RepoTx, 'fetch' | 'reapply' | 'revParse'>;

/**
 * What a sync did. `synced`: `cms/work` is upstream plus the saved changes, `tip` is its head, and `renamed` lists the
 * documents upstream renamed in this sync's re-apply (none when there was no re-apply). `failed`: nothing moved, and
 * `message` (redacted) is the status's `syncError`.
 */
type SyncOutcome =
  | {
      readonly kind: 'synced';
      readonly change: SyncChange;
      readonly tip: string;
      readonly renamed: readonly RenamedDocument[];
    }
  | { readonly kind: 'failed'; readonly message: string };

/** What `syncNow` answers: a sync's outcome, or `skipped` when the lock stayed busy for the whole wait (2.10g, 2.10c item 5). */
export type SyncNowOutcome = SyncOutcome | { readonly kind: 'skipped' };

/** The parts of a sync: the repo lock, the bundles, the guard, the status setters, the trigger and the clock. */
interface SyncDeps {
  readonly repo: Pick<Repo, 'locked'>;
  readonly bundles: BundleStore;
  readonly guard: Pick<DeleteGuard, 'invalidate'>;
  readonly status: Pick<Status, 'setLastSync' | 'setSyncError' | 'setRenamed'>;
  /**
   * Asks for a build of `cms/work` for `reason`. It is called without waiting: the build takes the repo lock itself, so it
   * runs once the sync (or the publish that holds the lock) is done.
   */
  readonly trigger: (reason: 'sync-code') => void;
  /** The clock of `lastSync`. The default is the real one. */
  readonly now?: () => Date;
}

/** The sync routine: one sync under a lock the caller holds, and one that takes the lock itself. */
interface Sync {
  /** Runs a sync. The caller holds the repo lock, and `tx` is its transaction. Never throws: a failure is a `failed` outcome. */
  syncLocked(tx: SyncTx): Promise<SyncOutcome>;
  /** Takes the repo lock and runs `syncLocked`. A lock timeout is `skipped`; any other error is rethrown. */
  syncNow(): Promise<SyncNowOutcome>;
}

/** Makes the sync routine over `deps`. Nothing runs until one of its calls is made. */
export function createSync({
  repo,
  bundles,
  guard,
  status,
  trigger,
  now = () => new Date(),
}: SyncDeps): Sync {
  // A failed sync: the status shows its message, and the outcome carries the same one.
  function failed(message: string): SyncOutcome {
    status.setSyncError(message);
    return { kind: 'failed', message };
  }

  async function syncLocked(tx: SyncTx): Promise<SyncOutcome> {
    const fetched = await tx.fetch(bundles);
    if (!fetched.ok) return failed(fetched.syncError.message);
    let tip: string;
    let renamed: readonly RenamedDocument[] = [];
    try {
      if (fetched.reapply) {
        const result = await tx.reapply(fetched.upstream, bundles);
        tip = result.tip;
        renamed = result.renamed;
        // The working copy changed, so the index built from it is stale (the next delete rebuilds it).
        guard.invalidate();
        status.setRenamed(renamed);
      } else {
        tip = await tx.revParse(WORK_REF);
      }
    } catch (error: unknown) {
      return failed(redact(messageOf(error)));
    }
    if (fetched.change === 'code') trigger('sync-code');
    status.setLastSync(now().toISOString());
    status.setSyncError(null);
    return { kind: 'synced', change: fetched.change, tip, renamed };
  }

  async function syncNow(): Promise<SyncNowOutcome> {
    try {
      return await repo.locked('sync', (tx) => syncLocked(tx));
    } catch (error: unknown) {
      if (error instanceof LockTimeoutError) return { kind: 'skipped' };
      throw error;
    }
  }

  return { syncLocked, syncNow };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
