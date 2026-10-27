// Generated at build time by src/integration.ts.
declare module 'virtual:preview-islands' {
  import type { ImageMetadata } from 'astro';
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

  export interface PreviewIsland {
    component: AstroComponentFactory;
    /** See IslandConfig.contentDir: goes away with the island route. */
    contentDir: string;
  }

  export const islands: Record<string, PreviewIsland>;
  /** Every image under the site's src/, keyed by its project-relative path. */
  export const images: Record<string, ImageMetadata>;
  /** Absolute folder for uploaded draft images. */
  export const mediaDir: string;
}
