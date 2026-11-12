// Publish (WORKPLAN 2.10d, PHASE-2-DESIGN 4.2): the saved changeset becomes one commit on the remote. The order is fixed
// by the build: (1) under the repo lock, sync with the remote; a changeset with nothing in it ends here. (2) With the lock
// released, wait for the preview to finish any rebuild, since the node must match the new code before it checks the
// values (the lock is released because that rebuild needs it). (3) Under the lock again: recheck the delete guard,
// validate every document, squash `cms/work` into one commit on the commit it sits on, and push it, never forced. A push
// that is refused because the remote moved syncs and tries again, up to three more times; the saves are never touched
// until the push has succeeded.
import type { FieldError, MediaInfo } from 'preview-protocol';
import { type Bundle, BundleError } from '../bundle/read.ts';
import type { BundleStore } from '../bundle/store.ts';
import type { CmsConfig } from '../config/schema.ts';
import { type Changeset, changesetOf } from '../documents/changeset.ts';
import type { RenamedDocument } from '../documents/reapply.ts';
import { redact } from '../git/exec.ts';
import type { Repo, RepoTx } from '../git/ops.ts';
import { MAX_BODY_BYTES } from '../http/changes-routes.ts';
import type { Logger } from '../log.ts';
import type { Status } from '../preview/status.ts';
import { busyStop } from '../save/busy.ts';
import type {
  DeleteGuard,
  MediaFiles,
  PreviewClient,
  SaveStop,
} from '../save/context.ts';
import {
  invalidStop,
  mediaMapOf,
  previewUnavailableStop,
} from '../save/validate.ts';
import type { SyncOutcome, SyncTx } from './sync.ts';

/** How long a publish waits for a running rebuild before it answers 503 `build-in-progress`. */
const BUILD_WAIT_MS = 120_000;

/** How many times a refused push is tried again after a sync. The first push is not a retry, so a publish pushes at most 4 times. */
const MAX_RETRIES = 3;

/** The text of a 503 `build-in-progress`: the wait ran out, or a save started another rebuild while the publish was waiting. */
const BUILD_IN_PROGRESS =
  'The preview is still being rebuilt, so the changes cannot be checked yet. Nothing was published. Try again once the build is done.';

/** A document the publish overwrote: the upstream commit whose version the CMS value replaced. */
interface Overwritten {
  readonly key: string;
  readonly commit: string;
}

/** The 200 answer. `commit` is null when there was nothing to publish. */
interface PublishBody {
  readonly commit: string | null;
  readonly overwritten: readonly Overwritten[];
  readonly renamed: readonly RenamedDocument[];
}

/** A failure that sets the publish status to `failed`: 502 for the remote (sync, push), 500 for anything unexpected. */
interface Failure {
  readonly status: 500 | 502;
  readonly body: { readonly error: string; readonly message: string };
}

/** What a publish answers: 200, a stop of the save pipeline's shape (409, 422, 503), or a failure. */
export type PublishAnswer =
  | { readonly status: 200; readonly body: PublishBody }
  | SaveStop
  | Failure;

/** The preview's builds, as a publish sees them: whether one runs, and a wait for the end of the running ones. */
export interface Builds {
  busy(): boolean;
  waitForIdle(timeoutMs: number): Promise<boolean>;
}

/** The parts of a publish. The wait and the batch size have real defaults. */
export interface PublishDeps {
  readonly repo: Pick<Repo, 'locked' | 'changesetReader' | 'mergeBase'>;
  readonly bundles: BundleStore;
  readonly siteFolder: string;
  readonly config: Pick<CmsConfig, 'collections' | 'media'>;
  readonly preview: PreviewClient;
  readonly media: MediaFiles;
  readonly guard: Pick<DeleteGuard, 'recheck' | 'invalidate'>;
  /** The sync under a lock the caller holds (`createSync(...).syncLocked`, 2.10c). */
  readonly syncLocked: (tx: SyncTx) => Promise<SyncOutcome>;
  readonly status: Pick<Status, 'setPublish' | 'setRenamed' | 'getRenamed'>;
  readonly builds: Builds;
  /** Asks for the rebuild of the published commit (2.9c). Not awaited: the build takes the repo lock itself. */
  readonly trigger: (reason: 'publish') => void;
  readonly log: Logger;
  readonly buildWaitMs?: number;
  /** The most one validate call may carry, in bytes. The default is the body cap of the node (`MAX_BODY_BYTES`, D16). */
  readonly maxBatchBytes?: number;
  /** Reads the changeset of the working copy. The default is the real one (`changesetOf`); a test replaces it. */
  readonly readChangeset?: typeof changesetOf;
}

/** A publish that failed, with the answer it gives. Thrown inside the lock, so the lock is released by the throw. */
class PublishFailure extends Error {
  readonly status: 500 | 502;
  readonly code: string;

  constructor(status: 500 | 502, code: string, message: string) {
    super(redact(message));
    this.status = status;
    this.code = code;
  }
}

/** What the steps under the lock hand on: the bundle and the changeset as the working copy has them now. */
interface Prepared {
  readonly bundle: Bundle;
  readonly changeset: Changeset;
}

/** Makes `publish`, which runs one publish and answers. It never rejects. */
export function createPublish({
  repo,
  bundles,
  siteFolder,
  config,
  preview,
  media,
  guard,
  syncLocked,
  status,
  builds,
  trigger,
  log,
  buildWaitMs = BUILD_WAIT_MS,
  maxBatchBytes = MAX_BODY_BYTES,
  readChangeset = changesetOf,
}: PublishDeps): () => Promise<PublishAnswer> {
  const buildInProgress: SaveStop = {
    status: 503,
    body: { error: 'build-in-progress', message: BUILD_IN_PROGRESS },
  };
  const nothingToPublish: PublishAnswer = {
    status: 200,
    body: { commit: null, overwritten: [], renamed: [] },
  };

  // A sync under the lock. A sync that failed (the remote cannot be read, a saved document cannot be re-applied) stops the publish.
  async function synced(
    tx: SyncTx,
  ): Promise<Extract<SyncOutcome, { kind: 'synced' }>> {
    const outcome = await syncLocked(tx);
    if (outcome.kind === 'failed')
      throw new PublishFailure(
        502,
        'sync-failed',
        `The site could not be brought up to date with the remote, so nothing was published: ${outcome.message}`,
      );
    return outcome;
  }

  // `cms/work` has nothing the commit it sits on lacks: it moves to that commit, and no rebuild follows.
  async function finishEmpty(
    tx: Pick<RepoTx, 'resetWork'>,
    base: string,
  ): Promise<PublishAnswer> {
    await tx.resetWork(base);
    status.setRenamed([]);
    return nothingToPublish;
  }

  // The bundle and the changeset under the lock, after the guard's recheck. A 409 comes back as a stop.
  async function prepare(): Promise<Prepared | SaveStop> {
    let bundle: Bundle | null;
    try {
      bundle = await bundles.current();
    } catch (error: unknown) {
      if (!(error instanceof BundleError)) throw error;
      throw new PublishFailure(500, 'bundle-invalid', error.message);
    }
    if (bundle === null) return { status: 503, body: { error: 'no-bundle' } };
    // One origin tip for every read of this attempt (2.10c).
    const reader = await repo.changesetReader();
    const referenced = await guard.recheck({
      bundle,
      repo: reader,
      siteFolder,
      config,
      log,
    });
    if (referenced !== undefined) return referenced;
    return {
      bundle,
      changeset: await readChangeset({ bundle, repo: reader, siteFolder }),
    };
  }

  // Step 3 of the order: runs under the lock, after the wait.
  async function publishLocked(tx: RepoTx): Promise<PublishAnswer> {
    // A save made while the lock was free can have started another rebuild: wait for none, answer instead (one wait only).
    if (builds.busy()) return buildInProgress;
    const first = await prepare();
    if ('status' in first) return first;
    // 2.10f: when the build of the new upstream code failed, the node still serves the last good bundle, and this
    // validation must run against it and report `upstreamBuildFailed`. That path is not built here.
    const invalid = await validate(first.changeset);
    if (invalid !== undefined) return invalid;
    let prepared: Prepared = first;
    for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
      if (retry > 0) {
        // The remote moved: fetch it, re-apply the saves on it, and look at the changeset again (the sync may have
        // recorded new overwrites, or a referrer of a deleted document). It is not validated again.
        await synced(tx);
        const again = await prepare();
        if ('status' in again) return again;
        prepared = again;
      }
      const { message, overwritten } = publishMessage(prepared.changeset);
      const commit = await tx.squash(message);
      if (commit === null) return finishEmpty(tx, await repo.mergeBase());
      const pushed = await tx.push(commit);
      if (pushed.ok) {
        const renamed = status.getRenamed();
        await tx.resetWork(commit);
        guard.invalidate();
        trigger('publish');
        status.setRenamed([]);
        log.info('published', {
          commit,
          documents: prepared.changeset.documents.length,
        });
        return { status: 200, body: { commit, overwritten, renamed } };
      }
      if (!pushed.race)
        throw new PublishFailure(
          502,
          'push-failed',
          `The remote refused the push, so nothing was published: ${pushed.message}`,
        );
      log.warn(
        'the remote moved during a publish, so it syncs and pushes again',
        {
          retry: retry + 1,
          commit,
        },
      );
    }
    throw new PublishFailure(
      502,
      'push-rejected',
      `The remote branch moved on each of ${MAX_RETRIES + 1} pushes, so nothing was published. The saved changes are kept. Try again in a moment.`,
    );
  }

  // The values of the changeset go to the node in batches under the body cap; the errors of all batches are merged (2.10d item 6).
  async function validate(changeset: Changeset): Promise<SaveStop | undefined> {
    const documents = changeset.documents.flatMap(
      (document): [string, unknown][] =>
        document.value === undefined ? [] : [[document.key, document.value]],
    );
    const mediaMap = await mediaMapOf(media, config.media.folder, log);
    let errors: readonly FieldError[];
    try {
      errors = await validateInBatches(
        preview,
        documents,
        mediaMap,
        maxBatchBytes,
      );
    } catch (error: unknown) {
      return previewUnavailableStop(error, log);
    }
    return invalidStop(errors);
  }

  // Steps 1 and 2 of the order, then step 3.
  async function run(): Promise<PublishAnswer> {
    const emptied = await repo.locked('publish', async (tx) => {
      const { upstream } = await synced(tx);
      if (await tx.hasSavedChanges()) return undefined;
      return finishEmpty(tx, upstream);
    });
    if (emptied !== undefined) return emptied;
    // With the lock released: the rebuild that the sync asked for needs it.
    if (!(await builds.waitForIdle(buildWaitMs))) return buildInProgress;
    return repo.locked('publish', publishLocked);
  }

  return async function publish(): Promise<PublishAnswer> {
    status.setPublish('publishing');
    try {
      const answer = await run();
      status.setPublish('idle');
      return answer;
    } catch (error: unknown) {
      const busy = busyStop(error);
      if (busy !== undefined) {
        status.setPublish('idle');
        return busy;
      }
      const failure =
        error instanceof PublishFailure
          ? error
          : new PublishFailure(
              500,
              'publish-failed',
              `Publishing failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
            );
      if (!(error instanceof PublishFailure))
        log.error('a publish failed unexpectedly', { error: failure.message });
      status.setPublish('failed', failure.message);
      return {
        status: failure.status,
        body: { error: failure.code, message: failure.message },
      };
    }
  };
}

/**
 * The commit message and the overwritten list of a changeset: `cms: publish N documents`, and when the CMS value replaced
 * an upstream change, `(overwrote <key> from <sha>, …)` in key order.
 */
function publishMessage(changeset: Changeset): {
  message: string;
  overwritten: Overwritten[];
} {
  const overwritten = changeset.documents
    .flatMap((document) =>
      document.overwritten === undefined
        ? []
        : [{ key: document.key, commit: document.overwritten }],
    )
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const tail =
    overwritten.length === 0
      ? ''
      : ` (overwrote ${overwritten.map(({ key, commit }) => `${key} from ${commit}`).join(', ')})`;
  return {
    message: `cms: publish ${changeset.documents.length} documents${tail}`,
    overwritten,
  };
}

/**
 * Validates `documents` with `preview` in as many calls as it takes to keep each call's JSON body under `maxBytes`, and
 * merges the errors in call order. Validation is per document, so a split loses nothing (references are the guard's job).
 * The media map goes with every call. A document that alone is over the cap still gets a call of its own: the node refuses it.
 */
export async function validateInBatches(
  preview: PreviewClient,
  documents: readonly (readonly [string, unknown])[],
  media: Readonly<Record<string, MediaInfo>>,
  maxBytes: number,
): Promise<FieldError[]> {
  const sizeOf = (value: unknown): number =>
    Buffer.byteLength(JSON.stringify(value));
  // The body is `{"documents":{<entries>},"media":<media>}`; an entry costs its key, a colon, its value and a comma.
  const envelope = sizeOf({ documents: {}, media });
  const batches: (readonly [string, unknown])[][] = [];
  let batch: (readonly [string, unknown])[] = [];
  let size = envelope;
  for (const entry of documents) {
    const [key, value] = entry;
    const cost = sizeOf(key) + 1 + sizeOf(value) + 1;
    if (batch.length > 0 && size + cost > maxBytes) {
      batches.push(batch);
      batch = [];
      size = envelope;
    }
    batch.push(entry);
    size += cost;
  }
  if (batch.length > 0) batches.push(batch);
  const errors: FieldError[] = [];
  for (const entries of batches) {
    errors.push(
      ...(await preview.validate(Object.fromEntries(entries), media)),
    );
  }
  return errors;
}
