import { describe, expect, it } from 'vitest';
import { fakeAppDeps, PREVIEW_ORIGIN } from '../../test/helpers/app-deps.ts';
import { createApp } from './app.ts';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  `frame-src ${PREVIEW_ORIGIN}`,
  "frame-ancestors 'none'",
].join('; ');

describe('editor routes', () => {
  it('serves the page at / with its type and security headers', async () => {
    const deps = fakeAppDeps();
    const response = await createApp(deps).request('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toBe(CSP);
    expect(await response.text()).toBe(deps.editor.page.html);
  });

  it.each([
    ['/editor.css', 'text/css; charset=utf-8', 'css'],
    ['/editor.js', 'text/javascript; charset=utf-8', 'script'],
  ] as const)(
    'serves %s with its type and the same headers',
    async (path, type, field) => {
      const deps = fakeAppDeps();
      const response = await createApp(deps).request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(type);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('content-security-policy')).toBe(CSP);
      expect(await response.text()).toBe(deps.editor.page[field]);
    },
  );
});
