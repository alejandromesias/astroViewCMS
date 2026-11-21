import { Hono } from 'hono';
import { mintPreviewToken } from 'preview-contract';
import { describe, expect, it, vi } from 'vitest';
import { registerPreviewUrlRoutes } from './preview-url-routes.ts';

const ORIGIN = 'http://preview.localhost:4401';
const CMS_ORIGIN = 'http://cms.localhost:4400';
// The Host header of a page on origins.cms: only such a page may open the preview.
const CMS_HOST = 'cms.localhost:4400';
const SITE = 'demo';
const SECRET = 'a-test-secret';
// The clock of the route in milliseconds: 1000 seconds, so the token's `now` is 1000.
const NOW_MS = 1_000_000;
const TOKEN = mintPreviewToken({
  secret: SECRET,
  site: SITE,
  ttlSeconds: 60,
  now: 1000,
});

const fakeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** An app with GET /api/preview-url, the node's warm-up as given, and a clock that stands still at NOW_MS. */
function appWith(warm: () => Promise<void>, log = fakeLog()): Hono {
  const app = new Hono();
  registerPreviewUrlRoutes(app, {
    cmsOrigin: CMS_ORIGIN,
    origin: ORIGIN,
    site: SITE,
    tokenSecret: SECRET,
    warm,
    log,
    now: () => NOW_MS,
  });
  return app;
}

describe('GET /api/preview-url', () => {
  it('answers the URL of the path with a fresh token for the site, and the preview origin', async () => {
    const response = await appWith(async () => {}).request(
      `/api/preview-url?path=${encodeURIComponent('/a/b?x=1#y')}`,
      { headers: { host: CMS_HOST } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      url: `${ORIGIN}/a/b?x=1&preview_token=${TOKEN}#y`,
      origin: ORIGIN,
    });
  });

  it('answers 400 invalid-path, and does not warm the node, when the path is missing', async () => {
    const warm = vi.fn(async () => {});
    const response = await appWith(warm).request('/api/preview-url', {
      headers: { host: CMS_HOST },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: 'invalid-path',
      message:
        'The path must start with a single "/" and hold no scheme, host, backslash or control character.',
    });
    expect(warm).not.toHaveBeenCalled();
  });

  it('answers 400 invalid-path, and does not warm the node, for a path with a host', async () => {
    const warm = vi.fn(async () => {});
    const response = await appWith(warm).request(
      `/api/preview-url?path=${encodeURIComponent('//host')}`,
      { headers: { host: CMS_HOST } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: 'invalid-path',
      message:
        'The path must start with a single "/" and hold no scheme, host, backslash or control character.',
    });
    expect(warm).not.toHaveBeenCalled();
  });

  it('warms the node on the first call of a session, and not on the next one', async () => {
    const warm = vi.fn(async () => {});
    const app = appWith(warm);
    const path = `/api/preview-url?path=${encodeURIComponent('/')}`;
    await app.request(path, { headers: { host: CMS_HOST } });
    await app.request(path, { headers: { host: CMS_HOST } });
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('answers the URL when the warm-up fails, and logs the reason', async () => {
    const log = fakeLog();
    const app = appWith(async () => {
      throw new Error('the node is down');
    }, log);
    const response = await app.request(
      `/api/preview-url?path=${encodeURIComponent('/')}`,
      { headers: { host: CMS_HOST } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      url: `${ORIGIN}/?preview_token=${TOKEN}`,
      origin: ORIGIN,
    });
    expect(log.warn).toHaveBeenCalledWith('the preview warm-up failed', {
      reason: 'the node is down',
    });
  });

  it.each([
    ['the preview origin', 'preview.localhost:4401'],
    ['the CMS host without its port', 'cms.localhost'],
    ['127.0.0.1 on the CMS port', '127.0.0.1:4400'],
  ])(
    'refuses a page on %s with 403 cross-origin that names origins.cms, and does not warm the node',
    async (_name, host) => {
      const warm = vi.fn(async () => {});
      const response = await appWith(warm).request(
        `/api/preview-url?path=${encodeURIComponent('/')}`,
        { headers: { host } },
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toStrictEqual({
        error: 'cross-origin',
        message:
          'This page is not origins.cms. Open the editor at http://cms.localhost:4400/ instead: the preview shows only on that origin, and saves are refused here.',
      });
      expect(warm).not.toHaveBeenCalled();
    },
  );
});
