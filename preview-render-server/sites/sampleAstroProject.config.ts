import type { SiteConfig } from '../src/types.ts';

// What the preview render server needs to know about one site.
export default {
  // Site folder, relative to this file.
  root: '../../sampleAstroProject',

  // Island name -> the component that renders it and where its content lives.
  // POST /__preview/<name> with a JSON body: the body is passed as the
  // component's props. GET /__preview/<name> returns the saved props.
  islands: {
    blocks: {
      component: 'src/components/BlockList.astro',
      content: { file: 'src/content/pages/home.json', props: ['blocks'] },
      contentDir: 'src/content/pages',
    },
  },

  port: 4400,
} satisfies SiteConfig;
