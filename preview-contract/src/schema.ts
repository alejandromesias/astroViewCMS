// The shape of schema.json, as preview-render-server/src/schema/json-schema.ts
// writes it (step 2.0a): one entry per collection, with the loader it was read
// with and the JSON Schema exported from its Zod schema, or the error that
// stopped the export. `strictObject` makes a drift between the writer and this
// reader show up as a parse failure instead of a silently dropped field.
import { z } from 'zod';
import { objectOf } from './json.ts';

/** Where a collection's entries come from, as the stub `glob()` and `file()`
 *  loaders record them (`LoaderInfo` in schema/stubs-flavor1.ts). */
export const loaderInfoSchema = z.object({
  kind: z.enum(['glob', 'file']),
  pattern: z.string(),
  base: z.string().optional(),
  /** Set only for a glob with its own `generateId`: its ids are not file names (WORKPLAN 2.0j). */
  customId: z.literal(true).optional(),
});

/** One collection in schema.json. `schema` is absent when the collection has
 *  none or Zod can't export it (then `error` says why). `readOnly` is set only
 *  for a collection the site config lists in `readOnlyCollections` (2.0j). */
export const collectionSchemaJson = z.strictObject({
  loader: loaderInfoSchema.optional(),
  schema: objectOf('"schema" must be an object').optional(),
  error: z.string().optional(),
  readOnly: z.boolean().optional(),
});

/** One collection of schema.json, as the parsed value gives it. */
export type CollectionSchemaJson = z.infer<typeof collectionSchemaJson>;

/** The whole of schema.json: collection name to its entry. Each entry is
 *  checked here and the result is built with `Object.fromEntries`, not with
 *  `z.record`, which would drop a collection named `__proto__`. */
export const schemaJsonSchema = objectOf(
  '"schema.json" must be an object',
).transform((value, ctx) => {
  const collections: Array<[string, CollectionSchemaJson]> = [];
  for (const [name, entry] of Object.entries(value)) {
    const parsed = collectionSchemaJson.safeParse(entry);
    if (!parsed.success) {
      const reason = parsed.error.issues[0]?.message ?? 'is invalid';
      ctx.addIssue({
        code: 'custom',
        message: `collection "${name}": ${reason}`,
      });
      return z.NEVER;
    }
    collections.push([name, parsed.data]);
  }
  return Object.fromEntries(collections);
});
