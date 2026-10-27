// Generated at build time by src/integration.ts.
declare module 'virtual:preview-site' {
  import type { ImageMetadata } from 'astro';
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

  export interface PreviewRegion {
    component: AstroComponentFactory;
    /** See RegionConfig.contentDir: goes away with the region route. */
    contentDir: string;
  }

  export const regions: Record<string, PreviewRegion>;
  /** Every image under the site's src/, keyed by its project-relative path. */
  export const images: Record<string, ImageMetadata>;
  /** Absolute folder for uploaded draft images. */
  export const mediaDir: string;
  /** Absolute folder of the build manifests (documents.json, routes.json,
   *  schema.json). The build writes the first two after the bundle exists, so
   *  routes read them at run time. */
  export const manifestDir: string;
  /** The site's collections compiled with the flavor 2 stubs (D3), for the
   *  shim to parse drafts with. Undefined when the site has no content config. */
  export const cmsCollections: Record<string, import('./schema/stubs-flavor2.ts').CollectionInfo> | undefined;
}
