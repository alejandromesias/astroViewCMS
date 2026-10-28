// Stubs for the CMS schema pass, flavor 2 (SYSTEM-DESIGN.md D3): this module
// stands in for `astro:content` and `astro/loaders` while the site's
// content.config.ts is compiled into the preview bundle. The shim (task 1.4)
// parses drafts with the resulting schemas. Astro-specific fields resolve
// through hooks that the shim fills in for each render:
// - `image()` turns the path into ImageMetadata (D5, D12);
// - `reference()` checks that the target exists in the bundle or the overlay.
import { z } from 'astro/zod';

export interface ImageMetadata {
  src: string;
  width: number;
  height: number;
  format: string;
}

export interface SchemaHooks {
  /** Resolves a draft image path to its metadata, or undefined if not found. */
  resolveImage: (path: string) => ImageMetadata | undefined;
  /** True if the document exists (overlay `null` counts as missing). */
  referenceExists: (collection: string, id: string) => boolean;
}

/** Replaced by the shim at the start of each render. */
export const hooks: SchemaHooks = {
  resolveImage: () => undefined,
  referenceExists: () => true,
};

export interface LoaderInfo {
  kind: 'glob' | 'file';
  pattern: string;
  base?: string;
}

export interface CollectionInfo {
  loader: LoaderInfo | undefined;
  schema: z.ZodType | undefined;
}

export const image = () =>
  z
    .string()
    .transform((value, ctx) => {
      const metadata = hooks.resolveImage(value);
      if (!metadata) {
        ctx.addIssue({ code: 'custom', message: `image not found: ${value}` });
        return z.NEVER;
      }
      return metadata;
    })
    .meta({ cms: 'image' });

export const reference = (collection: string) =>
  z
    .union([z.string(), z.object({ id: z.string() })])
    .transform((value, ctx) => {
      const id = typeof value === 'string' ? value : value.id;
      if (!hooks.referenceExists(collection, id)) {
        ctx.addIssue({ code: 'custom', message: `${collection}/${id} does not exist` });
        return z.NEVER;
      }
      return { collection, id };
    })
    .meta({ cms: 'reference', collection });

export const glob = (options: { pattern: string | string[]; base?: string }): LoaderInfo => ({
  kind: 'glob',
  pattern: [options.pattern].flat().join(','),
  ...(options.base === undefined ? {} : { base: options.base }),
});
export const file = (fileName: string): LoaderInfo => ({ kind: 'file', pattern: fileName });

type SchemaInput = z.ZodType | ((context: { image: typeof image }) => z.ZodType);

export const defineCollection = (config: { loader?: LoaderInfo; schema?: SchemaInput }): CollectionInfo => ({
  loader: config.loader,
  schema: typeof config.schema === 'function' ? config.schema({ image }) : config.schema,
});
