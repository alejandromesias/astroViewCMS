import type { Hono } from 'hono';
import { type AppDeps, createApp } from '../../src/http/app.ts';

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
    cmsOrigin: 'http://cms.localhost:4400',
  };
}

/** The app of createApp, where a request with no Host header gets `Host: localhost`. Hono's `app.request` sends none,
 *  and the guard refuses one without (http/guard.ts); a browser or curl always sends one. A test that sets its own
 *  `host` header keeps it. Takes a path or URL string, not a Request, and wraps `app.request` only: `app.fetch` gets
 *  no default Host, so a test that calls it must set one. */
export function createTestApp(deps: AppDeps): Hono {
  const app = createApp(deps);
  const request = app.request;
  app.request = (input, requestInit, env, executionCtx) => {
    const headers = new Headers(requestInit?.headers);
    if (!headers.has('host')) headers.set('host', 'localhost');
    return request(input, { ...requestInit, headers }, env, executionCtx);
  };
  return app;
}
