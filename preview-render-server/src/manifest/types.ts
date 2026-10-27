// Shapes of the build manifests (WORKPLAN task 1.3), written to
// .build/<site>-manifest/ next to the bundle.

/** One document: the unit that the CMS edits and the overlay replaces. */
export interface DocumentRecord {
  /** `collection/id` (the id may contain slashes: split at the first one, D10)
   *  for content entries, `data:<project-relative path>` for JSON data modules. */
  key: string;
  /** The file that holds the document, relative to the site root (D5). Absent
   *  for entries from loaders that don't read files. */
  file?: string;
  format: 'json' | 'md' | 'mdx' | 'yaml' | 'toml' | 'other';
  /** For `file()` loaders, where the document sits inside the file. */
  entryKey?: string;
  /** Build code reads this document (D1): saving it needs a rebuild. */
  buildTime: boolean;
  /** Which fields are read at build time; `['*']` means the whole file. */
  buildTimeFields?: string[];
}

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
