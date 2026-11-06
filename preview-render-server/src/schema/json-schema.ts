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
 *  `readOnlyCollections` gets `readOnly: true`, so a create into it is refused. */
export function shapeSchemas(
  collections: Record<string, CollectionInfo>,
  readOnlyCollections: string[] = [],
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
          });
        } catch (error) {
          out.error = errorMessage(error);
        }
      }
      return [name, out];
    }),
  );
}
