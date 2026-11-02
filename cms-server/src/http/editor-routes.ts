import { Hono } from 'hono';
import type { EditorPage } from '../editor/page.ts';

export interface EditorRouteDeps {
  readonly page: EditorPage;
  /** The only origin the editor may frame (the preview site). */
  readonly previewOrigin: string;
}

// The test editor at `/`, its stylesheet and its script (PHASE-2-DESIGN 5.8).
// The page may frame the preview origin and nothing else, and nothing may frame it.
export function editorRoutes(deps: EditorRouteDeps): Hono {
  const routes = new Hono();
  const headers = securityHeaders(deps.previewOrigin);
  for (const path of ['/', '/editor.css', '/editor.js'])
    routes.use(path, async (c, next) => {
      await next();
      for (const [name, value] of Object.entries(headers)) {
        c.res.headers.set(name, value);
      }
    });
  routes.get('/', (c) =>
    c.body(deps.page.html, 200, { 'Content-Type': 'text/html; charset=utf-8' }),
  );
  routes.get('/editor.css', (c) =>
    c.body(deps.page.css, 200, { 'Content-Type': 'text/css; charset=utf-8' }),
  );
  routes.get('/editor.js', (c) =>
    c.body(deps.page.script, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
    }),
  );
  return routes;
}

function securityHeaders(previewOrigin: string): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "img-src 'self'",
      `frame-src ${previewOrigin}`,
      "frame-ancestors 'none'",
    ].join('; '),
  };
}
