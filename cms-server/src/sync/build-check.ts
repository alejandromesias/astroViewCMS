// The build check of a publish (WORKPLAN 2.10k, PHASE-2-DESIGN 4.2): whether the candidate commit must be built before it is
// pushed. Under `auto` the preview cannot vouch for a changeset in four cases, and each one is a reason to build; a changeset
// the check cannot tell about builds too. Pure: the caller reads the changeset, the validate answer, the values at the merge
// base and what sync reported. Nothing here takes a lock, uses a worktree, runs git or does I/O.
import type { BuildTimeFields } from 'preview-contract';
import type { FieldError } from 'preview-protocol';
import type { DocumentEntry } from '../bundle/read.ts';
import type { CmsConfig } from '../config/schema.ts';
import type { Changeset } from '../documents/changeset.ts';
import type { SaveChange } from '../save/body.ts';
import { touches } from '../save/rebuild.ts';
import { refinementKeysOf } from '../save/validate.ts';
import type { SyncOutcome } from './sync.ts';

/** `publish.buildCheck`: `always` builds, `never` does not, and `auto` decides from the changeset. */
type BuildCheckMode = CmsConfig['publish']['buildCheck'];

/** Why a publish builds. `unknown` is the reason when the check cannot tell and no other reason applies. */
type BuildReason =
  | 'mdx-body'
  | 'build-time-field'
  | 'refinement-threw'
  | 'upstream-code'
  | 'unknown';

/** Why a check that would build is skipped (2.10f, U1): the upstream code does not build, so the candidate would not either. */
export type BuildSkip = 'upstream-broken';

/**
 * The decision. Under `auto` a build has its reason. `always` builds without one, since it does not read the changeset. A
 * check skipped for upstream (`skipped`) builds nothing, and says so.
 */
export type BuildDecision =
  | { readonly build: false; readonly skipped?: BuildSkip }
  | { readonly build: true; readonly reason?: BuildReason };

/** The inputs of the decision. Plain data: the caller reads all of it. */
export interface BuildCheckInput {
  readonly mode: BuildCheckMode;
  /** Whether the upstream code is known not to build (`upstreamBuildFailed` is set). Under `auto` or `always` the check is skipped then. */
  readonly upstreamBroken: boolean;
  /** The changed documents the publish would push, and the records of those the bundle does not hold. */
  readonly changeset: Changeset;
  /** The bundle's document records, by key: their format and build-time fields. */
  readonly bundled: ReadonlyMap<string, DocumentEntry>;
  /** The value of each changed document at the merge base, by key. A key that is absent was not there. */
  readonly before: ReadonlyMap<string, unknown>;
  /** The node's answer to the validation of the changeset. Its refinement keys are the triggers (`refinementKeysOf`). */
  readonly validate: readonly FieldError[];
  /** What the sync before the publish reported. */
  readonly sync: SyncOutcome;
  /** The site's configured build-time fields by key (the bundle's build-time.json). They apply to a created document, whose record has none. */
  readonly configured?: BuildTimeFields | undefined;
}

/**
 * Decides whether a publish builds. `always` and `never` answer at once, without reading the rest. Under `auto` the first
 * of these that applies gives the reason: an MDX body changed, a build-time field changed, a refinement threw, or code
 * changed upstream. When none applies, a changeset the check cannot tell about (a sync that failed, a broken file, a
 * document that cannot be read or has no record) builds as `unknown`. Otherwise nothing is built.
 */
export function decideBuild(input: BuildCheckInput): BuildDecision {
  if (input.mode === 'never') return { build: false };
  // U1 (2.10f): the upstream code does not build, so a build would fail whatever the changeset holds: the check is skipped.
  if (input.upstreamBroken) return { build: false, skipped: 'upstream-broken' };
  if (input.mode === 'always') return { build: true };
  const reason = autoReason(input);
  return reason === undefined ? { build: false } : { build: true, reason };
}

// A created document's record has no build-time fields: the site's configured list for its key applies to it.
function withConfigured(
  record: DocumentEntry,
  configured: BuildTimeFields | undefined,
): DocumentEntry {
  const fields =
    configured !== undefined && Object.hasOwn(configured, record.key)
      ? configured[record.key]
      : undefined;
  return fields === undefined
    ? record
    : { ...record, buildTime: true, buildTimeFields: fields };
}

// The reason of an `auto` build, or undefined when the changeset needs none.
function autoReason({
  changeset,
  bundled,
  before,
  validate,
  sync,
  configured,
}: BuildCheckInput): BuildReason | undefined {
  const entries = new Map(bundled);
  for (const record of changeset.createdRecords)
    entries.set(record.key, withConfigured(record, configured));
  // Without build-time.json (a bundle from before it) the fields of a created document are not known: the check cannot tell.
  let unknown =
    sync.kind === 'failed' ||
    changeset.fileErrors.length > 0 ||
    (configured === undefined && changeset.createdRecords.length > 0);
  const changes: {
    readonly change: Pick<SaveChange, 'document' | 'deleted' | 'data'>;
    readonly entry: DocumentEntry;
  }[] = [];
  for (const document of changeset.documents) {
    const entry = entries.get(document.key);
    // A document with an error has no value to check, and one with no record has no format or fields to read.
    if (document.error !== undefined || entry === undefined) {
      unknown = true;
      continue;
    }
    changes.push({
      entry,
      change: {
        document: document.key,
        deleted: document.status === 'deleted',
        data: document.value,
      },
    });
  }
  if (
    changes.some(({ entry, change }) =>
      touches(change, entry.format === 'mdx' ? ['body'] : undefined, before),
    )
  )
    return 'mdx-body';
  if (
    changes.some(({ entry, change }) =>
      touches(change, entry.buildTimeFields, before),
    )
  )
    return 'build-time-field';
  if (refinementKeysOf(validate).length > 0) return 'refinement-threw';
  if (sync.kind === 'synced' && sync.change === 'code') return 'upstream-code';
  return unknown ? 'unknown' : undefined;
}
