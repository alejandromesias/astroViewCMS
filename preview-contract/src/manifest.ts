// Shapes of the build manifests (WORKPLAN task 1.3, step 2.0a), written to
// <outDir>/manifest/ inside the bundle. The interfaces moved here from
// preview-render-server/src/manifest/types.ts, which re-exports them; the Zod
// schemas let cms-server parse the files instead of casting them.
import { z } from 'zod';

/** One document: the unit that the CMS edits and the overlay replaces. */
export interface DocumentRecord {
  /** `collection/id` (the id may contain slashes: split at the first one, D10)
   *  for content entries, `data:<project-relative path>` for JSON data modules. */
  key: string;
  /** The file that holds the document, relative to the site root (D5). Absent
   *  for entries from loaders that don't read files. */
  file?: string;
  format: 'json' | 'md' | 'mdx' | 'yaml' | 'toml' | 'other';
  /** Present, as `false`, for formats the CMS does not write (D13): TOML and
   *  anything else. The preview shows such documents as built. */
  editable?: false;
  /** For `file()` loaders, where the document sits inside the file. */
  entryKey?: string;
  /** Build code reads this document (D1): saving it needs a rebuild. */
  buildTime: boolean;
  /** Which fields are read at build time; `['*']` means the whole file. */
  buildTimeFields?: string[];
  /** The document's revision (revisionOf in revision.ts, 2.0c): the hash of
   *  the file's bytes, or of the entry's canonical data for a `file()` entry. */
  revision: string;
}

/** One image under the site's src/, with the hash of its bytes (images.json,
 *  D12): lets cms-server see which saved images the bundle lacks. */
export interface ImageRecord {
  /** Relative to the site root, with forward slashes. */
  path: string;
  hash: string;
}

/** One route of the site, as Astro's routing table lists it. */
export interface RouteRecord {
  /** Astro's route pattern, e.g. `/blog/[...single]`. */
  pattern: string;
  /** The page or endpoint file, relative to the site root. */
  component: string;
  type: 'page' | 'endpoint' | 'redirect' | 'fallback';
  dynamic: boolean;
  /** Names of all parameters, in order. */
  params: string[];
  /** The rest parameters (`[...x]`) among them (D10). */
  restParams: string[];
  /** The page exports `getStaticPaths` (found by reading its source). */
  hasStaticPaths: boolean;
}

/** Build-time fields per document key (SiteConfig.buildTimeFields). */
export type BuildTimeFields = Record<string, string[]>;

/** Schema of one DocumentRecord. `editable`, when present, must be `false`.
 *  Not checked with `satisfies DocumentRecord`: Zod's optional keys carry
 *  `| undefined`, which `exactOptionalPropertyTypes` refuses. The test file
 *  checks the shape instead. */
export const documentRecordSchema = z.object({
  key: z.string(),
  file: z.string().optional(),
  format: z.enum(['json', 'md', 'mdx', 'yaml', 'toml', 'other']),
  editable: z.literal(false).optional(),
  entryKey: z.string().optional(),
  buildTime: z.boolean(),
  buildTimeFields: z.array(z.string()).optional(),
  revision: z.string(),
});

/** Schema of one ImageRecord. */
export const imageRecordSchema = z.object({
  path: z.string(),
  hash: z.string(),
});

/** Schema of one RouteRecord. */
export const routeRecordSchema = z.object({
  pattern: z.string(),
  component: z.string(),
  type: z.enum(['page', 'endpoint', 'redirect', 'fallback']),
  dynamic: z.boolean(),
  params: z.array(z.string()),
  restParams: z.array(z.string()),
  hasStaticPaths: z.boolean(),
}) satisfies z.ZodType<RouteRecord>;
