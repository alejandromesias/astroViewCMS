// The revision check of a save (WORKPLAN 2.5c items 2 and 3, PHASE-2-DESIGN 5.3): the documents the save can see, and
// the check of each change's base revision against the working copy. A change of a document that is not there yet
// (`baseRevision` null) is a create, and planning decides it.
import type { Bundle, DocumentEntry } from '../bundle/read.ts';
import { changesetOf } from '../documents/changeset.ts';
import { revisionOfDocument } from '../documents/revision.ts';
import type { SaveContext, SaveStop } from './context.ts';

/** One document of a 409 answer: its revision in the working copy now, and its value when it can be read. */
interface Conflict {
  readonly key: string;
  readonly revision: string | null;
  readonly value?: unknown;
}

/** The documents a save can see: the bundle's, and the ones that earlier saves created (the changeset's createdRecords). */
export function visibleDocuments(
  bundle: Pick<Bundle, 'documents'>,
  created: readonly DocumentEntry[],
): Map<string, DocumentEntry> {
  const documents = new Map(bundle.documents);
  for (const record of created) {
    if (!documents.has(record.key)) documents.set(record.key, record);
  }
  return documents;
}

/**
 * Sets `ctx.documents` and `ctx.stored`, then checks every change's base revision. Any mismatch answers 409 with each
 * mismatched document (`error: 'conflict'`). A missing document has revision null, so an update of one conflicts.
 */
export async function checkRevisions(
  ctx: SaveContext,
): Promise<SaveStop | undefined> {
  const changeset = await changesetOf({
    bundle: ctx.bundle,
    repo: ctx.repo,
    siteFolder: ctx.siteFolder,
  });
  ctx.documents = visibleDocuments(ctx.bundle, changeset.createdRecords);
  const conflicts: Conflict[] = [];
  for (const change of ctx.changes) {
    const known = ctx.documents.get(change.document);
    if (known === undefined && change.baseRevision === null) continue;
    const facts =
      known === undefined
        ? null
        : await revisionOfDocument(
            ctx.siteFolder,
            known,
            ctx.reads,
            known.editable !== false,
          );
    if (facts?.value !== undefined)
      ctx.stored.set(change.document, facts.value);
    const revision = facts?.revision ?? null;
    if (revision === change.baseRevision) continue;
    conflicts.push({
      key: change.document,
      revision,
      ...(facts?.value === undefined ? {} : { value: facts.value }),
    });
  }
  return conflicts.length === 0
    ? undefined
    : { status: 409, body: { error: 'conflict', documents: conflicts } };
}
