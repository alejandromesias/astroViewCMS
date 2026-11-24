import { z } from 'astro/zod';
import { errorMessage } from '../error-message.ts';
import type { CollectionInfo, LoaderInfo } from './stubs-flavor1.ts';

/** One collection in schema.json. `schema` is absent when the collection has
 *  none or Zod can't export it (then `error` says why). */
export interface CollectionSchema {
  loader?: LoaderInfo;
  schema?: object;
  error?: string;
  /** Set only for a collection named in `readOnlyCollections` (WORKPLAN 2.0j). */
  readOnly?: boolean;
}

/** Shapes schema.json: a JSON Schema per collection, `image()` and
 *  `reference()` fields marked with `cms` (D3). `io: 'input'` exports what an
 *  author writes, before transforms and defaults. A collection named in
 *  `readOnlyCollections` gets `readOnly: true`, so a create into it is refused.
 *  Dates and discriminated unions get their markers from `addCmsMarkers`. */
export function shapeSchemas(
  collections: Record<string, CollectionInfo>,
  readOnlyCollections?: readonly string[],
): Record<string, CollectionSchema> {
  const readOnly = new Set(readOnlyCollections);
  return Object.fromEntries(
    Object.entries(collections).map(([name, { loader, schema }]) => {
      const out: CollectionSchema = loader ? { loader } : {};
      if (readOnly.has(name)) out.readOnly = true;
      if (schema) {
        try {
          out.schema = z.toJSONSchema(schema, {
            io: 'input',
            unrepresentable: 'any',
            override: addCmsMarkers,
          });
        } catch (error) {
          out.error = errorMessage(error);
        }
      }
      return [name, out];
    }),
  );
}

/** Adds the markers Zod's export leaves out (WORKPLAN 2.14c). A date, from `z.date()` or `z.coerce.date()`, exports as
 *  `{ type: 'string', cms: 'date' }` with no `format`. A `z.discriminatedUnion` names its key in `cmsDiscriminator`; a
 *  plain `z.union` gets no such key, so `cms` stays a string everywhere. */
const addCmsMarkers: NonNullable<z.core.ToJSONSchemaParams['override']> = ({
  zodSchema,
  jsonSchema,
}) => {
  const def = zodSchema._zod.def;
  if (def.type === 'date') {
    jsonSchema.type = 'string';
    jsonSchema.cms = 'date';
  }
  // Only a discriminated union has the key; a plain union has none (Zod omits it), so the `in` test alone decides.
  if (def.type === 'union' && 'discriminator' in def) {
    jsonSchema.cmsDiscriminator = def.discriminator;
  }
};
