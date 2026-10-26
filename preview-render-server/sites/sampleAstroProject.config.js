// What the preview render server needs to know about one site.
export default {
  // Site folder, relative to this file.
  root: '../../sampleAstroProject',

  // Island name -> the component that renders it and where its content lives.
  // POST /__preview/<name> with a JSON body: the body is passed as the
  // component's props.
  islands: {
    blocks: {
      component: 'src/components/BlockList.astro',
      // Folder of the JSON file the props come from. `image()` fields store
      // paths relative to it, e.g. "../assets/images/x.png".
      contentDir: 'src/content/pages',
    },
  },

  port: 4400,
};
