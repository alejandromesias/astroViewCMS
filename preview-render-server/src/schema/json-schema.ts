import { z } from 'astro/zod';
import type { CollectionInfo, LoaderInfo } from './stubs-flavor1.ts';

/** One collection in schema.json. `schema` is absent when the collection has
 *  none or Zod can't export it (then `error` says why). */
export interface CollectionSchema {
  loader?: LoaderInfo;
  schema?: object;
  error?: string;
}

/** Shapes schema.json: a JSON Schema per collection, `image()` and
 *  `reference()` fields marked with `cms` (D3). `io: 'input'` exports what an
 *  author writes, before transforms and defaults. */
export function shapeSchemas(collections: Record<string, CollectionInfo>): Record<string, CollectionSchema> {
  return Object.fromEntries(
    Object.entries(collections).map(([name, { loader, schema }]) => {
      const out: CollectionSchema = loader ? { loader } : {};
      if (schema) {
        try {
          out.schema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
        } catch (error) {
          out.error = (error as Error).message;
        }
      }
      return [name, out];
    }),
  );
}
