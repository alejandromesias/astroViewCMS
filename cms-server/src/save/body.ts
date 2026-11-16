// The body of PUT /api/changes (WORKPLAN 2.5c item 1, PHASE-2-DESIGN 5.3): `{ changes: [{ document, baseRevision,
// data?, deleted? }] }`. `baseRevision` is null for a new document. `data` is the whole value of an update or a create,
// and only a delete may leave it out. The shape is checked here, before the lock; the stages check the values.
import { saveRequestSchema } from 'cms-contract';

/** One change of a save, as the body gives it. */
export interface SaveChange {
  /** The document's key (`collection/id`). */
  readonly document: string;
  /** The revision the client saw, or null for a new document. */
  readonly baseRevision: string | null;
  readonly deleted: boolean;
  /** The new value of an update or a create. Undefined for a delete. */
  readonly data?: unknown;
}

/** The result of reading a body: its changes, or the message that names what is wrong with it. */
export type BodyResult =
  | { readonly ok: true; readonly changes: readonly SaveChange[] }
  | { readonly ok: false; readonly message: string };

/** Reads the text of a save body. A body that is not JSON, or does not have the shape of cms-contract's saveRequestSchema, is refused with a message. */
export function parseSaveBody(text: string): BodyResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: 'The body is not valid JSON' };
  }
  const parsed = saveRequestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue === undefined) return { ok: false, message: 'Invalid body' };
    const where = issue.path.length === 0 ? '' : `${issue.path.join('.')}: `;
    return { ok: false, message: `${where}${issue.message}` };
  }
  return {
    ok: true,
    changes: parsed.data.changes.map(
      (change): SaveChange => ({
        document: change.document,
        baseRevision: change.baseRevision,
        deleted: change.deleted === true,
        data: change.data,
      }),
    ),
  };
}
