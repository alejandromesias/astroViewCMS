// Stubs for the CMS schema pass, flavor 1 (SYSTEM-DESIGN.md D3): the site's
// content.config.ts is bundled with these in place of `astro:content` and
// `astro/loaders`, only to produce schema.json. Fields that Astro would
// resolve (images, references) become marked strings.
import { z } from 'astro/zod';

export interface LoaderInfo {
  kind: 'glob' | 'file';
  /** `glob`: the pattern; `file`: the path of the file. */
  pattern: string;
  /** `glob`: the base folder, as written in the config. */
  base?: string;
}

export interface CollectionInfo {
  loader: LoaderInfo | undefined;
  schema: z.ZodType | undefined;
}

export const image = () => z.string().meta({ cms: 'image' });
export const reference = (collection: string) => z.string().meta({ cms: 'reference', collection });

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
