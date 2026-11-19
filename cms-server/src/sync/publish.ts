// Publish (WORKPLAN 2.10d, PHASE-2-DESIGN 4.2): the saved changeset becomes one commit on the remote. The order is fixed
// by the build: (1) under the repo lock, sync with the remote; a changeset with nothing in it ends here. (2) With the lock
// released, wait for the preview to finish any rebuild, since the node must match the new code before it checks the
// values (the lock is released because that rebuild needs it). (3) Under the lock again: recheck the delete guard,
// validate every document, squash `cms/work` into one commit on the commit it sits on, and push it, never forced. A push
// that is refused because the remote moved syncs and tries again, up to three more times; the saves are never touched
// until the push has succeeded. From the click to the answer the publish gate (`publish-gate.ts`, 2.10l) refuses saves and
// skips poll ticks, and it asserts that `cms/work` stays at the snapshot of each attempt around the push.
import { apiError, type PublishAnswer, type PublishBody } from 'cms-contract';
import type { FieldError, MediaInfo } from 'preview-protocol';
import { type Bundle, BundleError } from '../bundle/read.ts';
import type { BundleStore } from '../bundle/store.ts';
import type { CmsConfig } from '../config/schema.ts';
import { type Changeset, changesetOf } from '../documents/changeset.ts';
import { redact } from '../git/exec.ts';
import type { Repo, RepoTx } from '../git/ops.ts';
import { WORK_REF } from '../git/repo.ts';
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
import type { PublishGate } from './publish-gate.ts';
import type { SyncOutcome, SyncTx } from './sync.ts';

/** How long a publish waits for a running rebuild before it answers 503 `build-in-progress`. */
const BUILD_WAIT_MS = 120_000;

/** How many times a refused push is tried again after a sync. The first push is not a retry, so a publish pushes at most 4 times. */
const MAX_RETRIES = 3;

/** The text of a 503 `build-in-progress`: the wait ran out, or a save started another rebuild while the publish was waiting. */
const BUILD_IN_PROGRESS =
  'The preview is still being rebuilt, so the changes cannot be checked yet. Nothing was published. Try again once the build is done.';

/** The text of a 503 `upstream-changed`, the answer when no builder runs (`--bundle`): the retry's sync found new code, and no build will follow it. */
const CODE_CHANGED =
  'The upstream code changed while the publish ran, so nothing was published. Try again.';

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
  /** The publish gate (2.10l): closed from the click to the answer, so saves and poll ticks are refused meanwhile. */
  readonly gate: PublishGate;
  /** Whether a builder runs. With `--bundle` it does not, and a code change found by a retry has no build to wait for. */
  readonly builderOn: boolean;
  /** Asks for the rebuild of the published commit (2.9c). Not awaited: the build takes the repo lock itself. */
  readonly trigger: (reason: 'publish') => void;
  readonly log: Logger;
  readonly buildWaitMs?: number;
  /** The most one validate call may carry, in bytes. The default is the body cap of the node (`MAX_BODY_BYTES`, D16). */
  readonly maxBatchBytes?: number;
  /** Reads the changeset of the working copy. The default is the real one (`changesetOf`); a test replaces it. */
  readonly readChangeset?: typeof changesetOf;
}

/** The codes a failed publish answers with (502 for the remote, 500 otherwise: the contract's table gives the status). */
type PublishFailureCode =
  | 'sync-failed'
  | 'push-failed'
  | 'push-rejected'
  | 'bundle-invalid'
  | 'publish-failed';

/** A publish that failed, with the code it answers. Thrown inside the lock, so the lock is released by the throw. */
class PublishFailure extends Error {
  readonly code: PublishFailureCode;

  constructor(code: PublishFailureCode, message: string) {
    super(redact(message));
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
  gate,
  builderOn,
  trigger,
  log,
  buildWaitMs = BUILD_WAIT_MS,
  maxBatchBytes = MAX_BODY_BYTES,
  readChangeset = changesetOf,
}: PublishDeps): () => Promise<PublishAnswer> {
  const buildInProgress: SaveStop = apiError('build-in-progress', {
    message: BUILD_IN_PROGRESS,
  });
  const codeChanged: SaveStop = apiError('upstream-changed', {
    message: CODE_CHANGED,
  });
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
      throw new PublishFailure('bundle-invalid', error.message);
    }
    if (bundle === null) return apiError('no-bundle', {});
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
        // recorded new overwrites, or a referrer of a deleted document). Content cannot change the schema, so it is not
        // validated again; new code can, and the sync has just asked for its rebuild, so the values would be checked
        // against the old node. Nothing is pushed: the saves stay on `cms/work`, and a publish later waits for that build.
        const { change } = await synced(tx);
        if (change === 'code') return builderOn ? buildInProgress : codeChanged;
        const again = await prepare();
        if ('status' in again) return again;
        prepared = again;
      }
      const { message, overwritten } = publishMessage(prepared.changeset);
      // The snapshot `S` of this attempt: the gate keeps saves out, so `cms/work` stays at `base` until the push (2.10l).
      const base = await tx.revParse(WORK_REF);
      const commit = await tx.squash(message);
      if (commit === null) return finishEmpty(tx, await repo.mergeBase());
      await gate.beforePush(tx, base);
      const pushed = await tx.push(commit);
      if (pushed.ok) {
        await gate.afterPush(tx, base);
        const renamed = status.getRenamed();
        // The push is accepted, so the publish has landed: a reset that fails after it is logged, and the answer stays 200.
        // The next sync re-applies the saves on the new upstream, so nothing is published twice (2.10l).
        try {
          await tx.resetWork(commit);
        } catch (error: unknown) {
          log.error(
            'the publish landed, but cms/work could not be reset to it',
            {
              commit,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
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
    // The click closes the gate before anything waits, so a save or a poll tick that comes from now on is refused (2.10l).
    // A second click while one runs gets the 409 from `begin`, and touches neither the gate nor the status.
    const refused = gate.begin();
    if (refused !== undefined) return refused;
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
              'publish-failed',
              `Publishing failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
            );
      if (!(error instanceof PublishFailure))
        log.error('a publish failed unexpectedly', { error: failure.message });
      status.setPublish('failed', failure.message);
      return apiError(failure.code, { message: failure.message });
    } finally {
      // Reopened once the answer is decided, on every path, so the gate reopens after every answer (2.10l).
      gate.end();
    }
  };
}

/**
 * The commit message and the overwritten list of a changeset: `cms: publish N documents`, and when the CMS value replaced
 * an upstream change, `(overwrote <key> from <sha>, …)` in key order.
 */
function publishMessage(changeset: Changeset): {
  message: string;
  overwritten: PublishBody['overwritten'];
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
