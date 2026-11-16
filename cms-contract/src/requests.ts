// The request side of the CMS API (PHASE-2-DESIGN 5.9). A route parses what it reads with these schemas; nothing is cast.
import { z } from 'zod';

// A key with a control character (a line break, a tab) would break its line of the commit message (save/write.ts).
function hasControl(text: string): boolean {
  return [...text].some((char) => char < ' ' || char === '\u007f');
}

// The messages name only the rule: the path of an issue (`changes.0.data`) already names the field.
const changeSchema = z
  .object({
    document: z
      .string({ error: 'must be a string' })
      .min(1, { error: 'must not be empty' })
      .refine((key) => !hasControl(key), {
        error: 'must not contain control characters',
      }),
    baseRevision: z.string({ error: 'must be a string or null' }).nullable(),
    deleted: z.boolean({ error: 'must be true or false' }).optional(),
    data: z.unknown().optional(),
  })
  .refine((change) => change.deleted === true || change.data !== undefined, {
    error: 'is needed unless "deleted" is true',
    path: ['data'],
  });

/** The body of PUT /api/changes: `{ changes: [...] }`, at least one change. Values are checked by the save, not here. */
export const saveRequestSchema = z.object(
  {
    changes: z
      .array(changeSchema, { error: 'must be a list' })
      .min(1, { error: 'must not be empty' }),
  },
  { error: 'Body must be a JSON object with "changes"' },
);

/** The body of PUT /api/changes, as the schema parses it. */
export type SaveRequest = z.infer<typeof saveRequestSchema>;

/** The query of GET /api/documents: `key` (one document) wins over `collection` (a list). Which one is given is checked by the route. */
export const documentsQuerySchema = z.object({
  collection: z.string().optional(),
  key: z.string().optional(),
});

/** The query of GET /api/preview-url. `path` must be a site path; the route checks that. */
export const previewUrlQuerySchema = z.object({ path: z.string() });
