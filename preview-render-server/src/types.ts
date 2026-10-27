// Site configuration: what the preview render server needs to know about one
// site (see sites/*.config.ts).

export interface RegionConfig {
  /** The component that renders the region, relative to the site root. */
  component: string;
}

export interface SiteConfig {
  /** Site folder, relative to the config file. */
  root: string;
  regions: Record<string, RegionConfig>;
  /** Fields that build code reads (SYSTEM-DESIGN.md D1): document key to field
   *  paths, `['*']` for the whole file. Adds to what the import scan finds and
   *  covers files read with `fs` or dynamic imports, which it can't see. */
  buildTimeFields?: Record<string, string[]>;
  /** Code languages Markdown drafts may highlight beyond those the built
   *  content already uses (D2), for a site that expects authors to add one. */
  extraLanguages?: string[];
  /** Origins besides the site's own that may drive the preview from an iframe
   *  parent (the editor's). The bridge accepts messages from these only. */
  editorOrigins?: string[];
  port: number;
}

/** A SiteConfig with every path made absolute. */
export interface ResolvedSiteConfig extends SiteConfig {
  outDir: string;
  regionsDir: string;
  mediaDir: string;
  /** Where the build manifests go (documents.json, routes.json, schema.json). */
  manifestDir: string;
}
