import type { SiteConfig } from '../src/types.ts';

// What the preview render server needs to know about one site.
export default {
  // Site folder, relative to this file.
  root: '../../sampleAstroProject',

  // Region name -> the component the bridge marks on the page.
  regions: {
    blocks: { component: 'src/components/BlockList.astro' },
  },

  port: 4400,
} satisfies SiteConfig;
