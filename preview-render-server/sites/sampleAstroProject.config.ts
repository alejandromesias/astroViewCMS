import type { SiteConfig } from '../src/types.ts';

// What the preview render server needs to know about one site.
export default {
  // Site folder, relative to this file.
  root: '../../sampleAstroProject',

  // Island name -> the component that renders it. POST /__preview/<name> with
  // a JSON body: the body is passed as the component's props. contentDir is
  // where the props' relative image paths resolve (temporary, see types.ts).
  islands: {
    blocks: {
      component: 'src/components/BlockList.astro',
      contentDir: 'src/content/pages',
    },
  },

  port: 4400,
} satisfies SiteConfig;
