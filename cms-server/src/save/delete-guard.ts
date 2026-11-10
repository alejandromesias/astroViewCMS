// The delete guard of a save (WORKPLAN 2.6b, PHASE-2-DESIGN 4.3): a deletion that a document still points at answers 409
// `referenced-by`, unless the same changeset clears the reference. The reference index of the bundle is built from the
// working copy on the first save that deletes something (never for a save that deletes nothing). After the commit, the
// save's written values update it. A failed update marks it stale, and the next guarded delete rebuilds it. Keys come
// from content, so the guard uses only Maps and Sets for them.
import type { Bundle, DocumentEntry } from '../bundle/read.ts';
import { codecFor } from '../codecs/by-format.ts';
import { changesetOf } from '../documents/changeset.ts';
import { revisionOfDocument } from '../documents/revision.ts';
import {
  type CollectionSchemaOf,
  createReferenceIndex,
  type ReferenceIndex,
  targetsOf,
} from '../references/reference-index.ts';
import type {
  AfterCommitHook,
  DeleteGuard,
  GuardInput,
  RecheckInput,
  SaveStage,
  SaveStop,
} from './context.ts';
import { dataOf, isMarkdownDocument } from './markdown.ts';

/** The parts of the guard that a test replaces: the index factory (the reference index by default). */
export interface DeleteGuardDeps {
  readonly makeIndex?: (schemaOf: CollectionSchemaOf) => ReferenceIndex;
}

/** The guard's state for one bundle: its index (undefined until built) and whether a failed update left it stale. */
interface GuardState {
  readonly bundle: Bundle;
  index: ReferenceIndex | undefined;
  stale: boolean;
}

/** A new guard, with no index yet. `makeIndex` builds the index from a schema lookup (the reference index by default). */
export function createDeleteGuard({
  makeIndex = createReferenceIndex,
}: DeleteGuardDeps = {}): DeleteGuard {
  // The state of the bundle last seen. Saves and syncs run under the repo lock, so there is one state at a time.
  let state: GuardState | undefined;

  // The index of the bundle: built on the first call, and again when it is stale or the bundle is another one.
  async function indexOf(ctx: GuardInput): Promise<ReferenceIndex> {
    if (state === undefined || state.bundle !== ctx.bundle)
      state = { bundle: ctx.bundle, index: undefined, stale: false };
    const current = state;
    if (current.index !== undefined && !current.stale) return current.index;
    const index = makeIndex(schemaOfBundle(ctx.bundle));
    index.rebuild(await valuesOf(ctx));
    current.index = index;
    current.stale = false;
    return index;
  }

  // The recheck after a sync (2.10c). The deleted documents of the changeset are looked up in the index of the working copy
  // as it is now (after the re-apply). The documents it holds are the bundle's and the ones the changeset added, less the
  // deleted ones, whose files are gone. The first deleted key in sort order that a document still points at answers 409.
  async function recheck({
    bundle,
    repo,
    siteFolder,
    config,
    log,
  }: RecheckInput): Promise<SaveStop | undefined> {
    const changeset = await changesetOf({ bundle, repo, siteFolder });
    const deleted = changeset.documents
      .filter((document) => document.status === 'deleted')
      .map((document) => document.key)
      .sort();
    if (deleted.length === 0) return undefined;
    const documents = new Map<string, DocumentEntry>([
      ...bundle.documents,
      ...changeset.createdRecords.map(
        (record) => [record.key, record] as const,
      ),
    ]);
    for (const key of deleted) documents.delete(key);
    const index = await indexOf({
      bundle,
      siteFolder,
      reads: new Map(),
      documents,
      config,
      log,
    });
    for (const key of deleted) {
      const referrers = index.referrersOf(key);
      if (referrers.length > 0) return referencedBy(key, referrers, documents);
    }
    return undefined;
  }

  return {
    indexOf,
    recheck,
    invalidate() {
      // Nothing to mark before the first index: the first call builds it from the working copy anyway.
      if (state !== undefined) state.stale = true;
    },
    applySave(ctx) {
      // Nothing to update: no index yet (the next build reads the working copy), an index of another bundle, or a
      // stale one (the next build replaces it).
      if (state === undefined || state.bundle !== ctx.bundle) return;
      const current = state;
      const index = current.index;
      if (index === undefined || current.stale) return;
      try {
        for (const change of ctx.changes) {
          if (change.deleted) index.remove(change.document);
          else
            index.update(
              change.document,
              indexedValueOf(
                change.data,
                isMarkdownDocument(change.document, ctx),
              ),
            );
        }
      } catch (error) {
        current.stale = true;
        throw error;
      }
    },
  };
}

/**
 * The guard stage (PHASE-2-DESIGN 4.3), between the revision check and the planning. A save that deletes nothing passes
 * without an index. Otherwise it answers 409 `referenced-by` for the first deleted key in sort order that a document
 * still points at after the save: a referrer the save does not change, or a changed document whose new value points at
 * it. `needsDeveloper` is set when one referrer is read-only.
 */
export const checkDeleteGuard: SaveStage = async (ctx) => {
  const deleted = new Set(
    ctx.changes
      .filter((change) => change.deleted)
      .map((change) => change.document),
  );
  if (deleted.size === 0) return undefined;
  let index: ReferenceIndex;
  try {
    index = await ctx.guard.indexOf(ctx);
  } catch (error) {
    return referenceIndexFailed(error);
  }
  const changed = new Set(ctx.changes.map((change) => change.document));
  // A deleted key, to the documents that still point at it after the save.
  const blockers = new Map<string, Set<string>>();
  for (const key of deleted) {
    for (const referrer of index.referrersOf(key)) {
      // A changed referrer is judged by its new value below, and a deleted one no longer points at anything.
      if (!changed.has(referrer)) addTo(blockers, key, referrer);
    }
  }
  const schemaOf = schemaOfBundle(ctx.bundle);
  for (const change of ctx.changes) {
    if (change.deleted) continue;
    const value = indexedValueOf(
      change.data,
      isMarkdownDocument(change.document, ctx),
    );
    for (const target of targetsOf(change.document, value, schemaOf)) {
      if (deleted.has(target)) addTo(blockers, target, change.document);
    }
  }
  for (const document of [...deleted].sort()) {
    const found = blockers.get(document);
    if (found === undefined) continue;
    return referencedBy(document, [...found].sort(), ctx.documents);
  }
  return undefined;
};

/**
 * The 409 answer for a deleted document that still has referrers (sorted). `needsDeveloper` is set when one referrer is
 * read-only. The save stage and the recheck after a sync (2.10c) both answer with it.
 */
function referencedBy(
  document: string,
  referrers: readonly string[],
  documents: ReadonlyMap<string, DocumentEntry>,
): SaveStop {
  const needsDeveloper = referrers.some(
    (referrer) => documents.get(referrer)?.editable === false,
  );
  return {
    status: 409,
    body: {
      error: 'referenced-by',
      document,
      referrers,
      ...(needsDeveloper ? { needsDeveloper: true } : {}),
    },
  };
}

/**
 * The after-commit hook of the guard: the save's written values go into the index. A throw is logged by the write
 * stage, and the index is then stale (see `applySave`).
 */
export const updateIndexAfterCommit: AfterCommitHook = async (ctx) => {
  ctx.guard.applySave(ctx);
};

/**
 * The values the index is built from: each document the save can see, read from the working copy. A document with no
 * codec (TOML, other) is left out without a log, as the guard cannot read it. A document that cannot be read or parsed
 * is left out and logged. A read-only document is read too: it can point at a deleted one.
 */
async function valuesOf(
  ctx: GuardInput,
): Promise<{ readonly key: string; readonly value: unknown }[]> {
  const values: { readonly key: string; readonly value: unknown }[] = [];
  for (const document of ctx.documents.values()) {
    if (codecFor(document.format) === null) continue;
    const facts = await revisionOfDocument(
      ctx.siteFolder,
      document,
      ctx.reads,
      true,
    );
    if (facts?.value === undefined) {
      ctx.log.warn(
        'a document is left out of the reference index: it cannot be read',
        { document: document.key },
      );
      continue;
    }
    values.push({
      key: document.key,
      value: indexedValueOf(facts.value, isMarkdownDocument(document.key, ctx)),
    });
  }
  return values;
}

/**
 * The value the index reads: the `data` of a Markdown value, or the value itself. A Markdown value with no `data` reads
 * as undefined, which names no reference. A file() entry is a raw value, whatever its file's format (see `isMarkdownDocument`).
 */
function indexedValueOf(value: unknown, markdown: boolean): unknown {
  return markdown ? dataOf(value) : value;
}

/** The schema lookup of a bundle's collections, as the reference index takes it. */
function schemaOfBundle(bundle: Bundle): CollectionSchemaOf {
  return (collection) => bundle.collections.get(collection)?.schema;
}

/** Adds `referrer` to the set under `key` in `table`, which is created when there is none yet. */
function addTo(
  table: Map<string, Set<string>>,
  key: string,
  referrer: string,
): void {
  const set = table.get(key) ?? new Set<string>();
  set.add(referrer);
  table.set(key, set);
}

/** The answer of a stage whose reference index could not be built: a JSON 500, and no write. */
function referenceIndexFailed(error: unknown): SaveStop {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    status: 500,
    body: {
      error: 'reference-index-failed',
      message: `The reference index could not be built: ${reason}`,
    },
  };
}
