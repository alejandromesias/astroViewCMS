// The body of PUT /api/changes (WORKPLAN 2.5c item 1, PHASE-2-DESIGN 5.3): `{ changes: [{ document, baseRevision,
// data?, deleted? }] }`. `baseRevision` is null for a new document. `data` is the whole value of an update or a create,
// and only a delete may leave it out. The shape is checked here, before the lock; the stages check the values.
import { z } from 'zod';

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

// The messages name only the rule: the path of an issue (`changes.0.data`) already names the field.
const changeSchema = z
  .object({
    document: z
      .string({ error: 'must be a string' })
      .min(1, { error: 'must not be empty' }),
    baseRevision: z.string({ error: 'must be a string or null' }).nullable(),
    deleted: z.boolean({ error: 'must be true or false' }).optional(),
    data: z.unknown().optional(),
  })
  .refine((change) => change.deleted === true || change.data !== undefined, {
    error: 'is needed unless "deleted" is true',
    path: ['data'],
  });

const bodySchema = z.object(
  {
    changes: z
      .array(changeSchema, { error: 'must be a list' })
      .min(1, { error: 'must not be empty' }),
  },
  { error: 'Body must be a JSON object with "changes"' },
);

/** Reads the text of a save body. A body that is not JSON, or does not have the shape above, is refused with a message. */
export function parseSaveBody(text: string): BodyResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: 'The body is not valid JSON' };
  }
  const parsed = bodySchema.safeParse(json);
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
