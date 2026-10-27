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
}
