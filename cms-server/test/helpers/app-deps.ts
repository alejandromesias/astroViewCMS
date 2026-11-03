import type { AppDeps } from '../../src/http/app.ts';

export const PREVIEW_ORIGIN = 'http://preview.localhost:4401';

/** App deps with a stand-in editor page. The real page is bundled at start (src/editor/page.ts). */
export function fakeAppDeps(): AppDeps {
  return {
    editor: {
      page: {
        html: '<!doctype html><title>Test editor</title>',
        css: 'body {}',
        script: 'export {};',
      },
      previewOrigin: PREVIEW_ORIGIN,
    },
    // Placeholder folders: no test in the app-level suite uploads through this.
    media: {
      stagingDir: 'unused-staging',
      mediaFile: 'unused-media.json',
      cmsOrigin: 'http://cms.localhost:4400',
    },
  };
}
