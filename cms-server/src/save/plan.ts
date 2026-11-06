// The planning stage of a save (WORKPLAN 2.5c items 4 and 5, PHASE-2-DESIGN 5.3): the changes become planWrite's
// changes, and planWrite's file operations go to the context. Nothing is written here.
import type { DocumentEntry } from '../bundle/read.ts';
import type { SaveChange } from './body.ts';
import {
  type WriteChange,
  type WritePlanCode,
  planWrite,
  WritePlanError,
} from '../documents/plan-write.ts';
import { collectionOf, formatOfPath } from '../documents/paths.ts';
import { readFileOnce } from '../documents/read.ts';
import type { SaveContext, SaveStop } from './context.ts';

/** The status of each refusal of planWrite (WORKPLAN 2.5c item 5). */
const PLAN_ERROR_STATUS: Record<WritePlanCode, 400 | 409 | 422> = {
  'duplicate-key': 400,
  'outside-site': 400,
  'pattern-mismatch': 400,
  exists: 409,
  'file-missing': 409,
  'read-only': 422,
  unwritable: 422,
  unreadable: 422,
};

/** Plans the writes of the save. A refusal of planWrite answers with its code, the key and the position. */
export async function planChanges(
  ctx: SaveContext,
): Promise<SaveStop | undefined> {
  const writes: WriteChange[] = [];
  for (const change of ctx.changes) {
    const write = writeOf(change, ctx.documents);
    if (write === undefined)
      return {
        status: 400,
        body: {
          error: 'invalid-body',
          message: `A new document needs a key of the form collection/id: "${change.document}"`,
        },
      };
    writes.push(write);
  }
  try {
    ctx.plan = await planWrite(writes, {
      readText: async (path) => {
        const read = await readFileOnce(
          ctx.siteFolder,
          path,
          formatOfPath(path),
          ctx.reads,
        );
        return read === null
          ? null
          : new TextDecoder('utf-8', { ignoreBOM: true }).decode(read.bytes);
      },
      documents: ctx.documents,
      collections: ctx.bundle.collections,
      config: ctx.config,
    });
  } catch (error) {
    if (!(error instanceof WritePlanError)) throw error;
    return {
      status: PLAN_ERROR_STATUS[error.code],
      body: {
        error: error.code,
        key: error.key,
        message: error.message,
        file: error.file,
        line: error.line,
        column: error.column,
      },
    };
  }
  return undefined;
}

/**
 * The planWrite change of one save change. A delete is a delete. A change of a document nobody has yet, with no base
 * revision, is a create of `collection/id`. Any other change is an update. Undefined for a create whose key has no
 * collection.
 */
function writeOf(
  change: SaveChange,
  documents: ReadonlyMap<string, DocumentEntry>,
): WriteChange | undefined {
  if (change.deleted) return { op: 'delete', key: change.document };
  if (change.baseRevision === null && !documents.has(change.document)) {
    const collection = collectionOf(change.document);
    if (collection === undefined) return undefined;
    return {
      op: 'create',
      collection,
      id: change.document.slice(collection.length + 1),
      value: change.data,
    };
  }
  return { op: 'update', key: change.document, value: change.data };
}
