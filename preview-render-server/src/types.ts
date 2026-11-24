// Site configuration: what the preview render server needs to know about one
// site (see sites/*.config.ts).

interface RegionConfig {
  /** The component that renders the region, relative to the site root. */
  component: string;
}

/** The widgets a form field can ask for (WORKPLAN 2.14c). Closed: a hint names one of these. */
export type UiWidget = 'text' | 'textarea' | 'markdown' | 'public-image';

/** A UI hint for one field of a collection. Every part is optional; the hint is copied as `ui` onto the field's schema node. */
export interface UiHint {
  label?: string;
  widget?: UiWidget;
  hidden?: boolean;
}

export interface SiteConfig {
  /** Site folder, relative to the config file. */
  root: string;
  regions: Record<string, RegionConfig>;
  /** UI hints for the CMS forms, keyed `'<collection>.<path>'`. A path is dot-separated and `[]` marks array items
   *  (`landing.blocks[].title`); a path through a union applies to every branch that has the field. A hint whose
   *  path matches no field fails the build. */
  uiHints?: Record<string, UiHint>;
  /** Fields that build code reads (SYSTEM-DESIGN.md D1): document key to field
   *  paths, `['*']` for the whole file. Adds to what the import scan finds and
   *  covers files read with `fs` or dynamic imports, which it can't see. */
  buildTimeFields?: Record<string, string[]>;
  /** Content collections the CMS must not edit, such as a test-only fixture
   *  collection: their documents get `editable: false` in documents.json. */
  readOnlyCollections?: string[];
  /** Code languages Markdown drafts may highlight beyond those the built
   *  content already uses (D2), for a site that expects authors to add one. */
  extraLanguages?: string[];
  port: number;
}

/** A SiteConfig with every path made absolute. */
export interface ResolvedSiteConfig extends SiteConfig {
  outDir: string;
  regionsDir: string;
  /** Where the build manifests go (documents.json, routes.json, schema.json). */
  manifestDir: string;
}
