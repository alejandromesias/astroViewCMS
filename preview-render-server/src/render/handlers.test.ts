import { describe, expect, it, vi } from 'vitest';
import { currentOverlay } from '../overlay/context.ts';
import { DraftError } from '../overlay/errors.ts';
import { handleRender, handleValidate } from './handlers.ts';
import type { HandlerDeps } from './handlers.ts';
import { NotFoundError } from './render-page.ts';

const page = { html: '<html><head><title>T</title><meta name="a" content="b"></head><body>hi</body></html>', route: '/', pathsMs: 1, renderMs: 2 };

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    renderPage: vi.fn(async () => page),
    validate: vi.fn(async () => []),
    builtDocuments: () => [{ key: 'blog/a', format: 'md', buildTime: false }],
    ...overrides,
  };
}

const post = (body: unknown, { path = '/', type = 'application/json', headers = {} as Record<string, string> } = {}) =>
  new Request(`http://x/__preview/render?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'content-type': type, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('handleRender', () => {
  it('answers html, head, documents, limits and timings', async () => {
    const deps = makeDeps({
      renderPage: vi.fn(async () => {
        const context = currentOverlay()!;
        context.reads.add('blog');
        context.limits.add('code-language:cpp');
        context.limits.add('mdx-body');
        return page;
      }),
    });
    const response = await handleRender(post({ documents: { 'blog/new': { data: {} } } }, { path: '/blog?x=1' }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('server-timing')).toBe('paths;dur=1.0, render;dur=2.0');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      html: page.html,
      head: { title: 'T', meta: [{ name: 'a', content: 'b' }] },
      documents: ['blog/a', 'blog/new'],
      limits: ['code-language:cpp', 'mdx-body'],
    });
    expect(typeof body.renderMs).toBe('number');
    expect(deps.renderPage).toHaveBeenCalledWith(new URL('http://x/blog?x=1'));
  });

  it('the page sees the overlay of its own request', async () => {
    const seen: unknown[] = [];
    const deps = makeDeps({
      renderPage: async () => {
        await Promise.resolve();
        seen.push(currentOverlay()?.documents);
        return page;
      },
    });
    await Promise.all([handleRender(post({ documents: { a: 1 } }), deps), handleRender(post({ documents: { b: 2 } }), deps)]);
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('refuses what is not JSON, the wrong content type and cross-site calls', async () => {
    const deps = makeDeps();
    expect((await handleRender(post({ documents: {} }, { type: 'text/plain' }), deps)).status).toBe(404);
    expect((await handleRender(post({ documents: {} }, { headers: { 'sec-fetch-site': 'cross-site' } }), deps)).status).toBe(403);
    expect((await handleRender(post('{not json'), deps)).status).toBe(400);
    expect(deps.renderPage).not.toHaveBeenCalled();
  });

  it('400 names the part of the envelope that failed', async () => {
    const deps = makeDeps();
    for (const [body, text] of [
      ['"text"', /JSON object/],
      [{}, /"documents" must be an object/],
      [{ documents: [] }, /"documents" must be an object/],
      [{ documents: {}, media: { 'x.png': { url: 1, width: 1, height: 1, format: 'png' } } }, /"url" must be a string/],
      [{ documents: {}, media: { 'x.png': { url: 'u', width: 0, height: 1, format: 'png' } } }, /"width"/],
      [{ documents: {}, media: { 'x.png': { url: 'u', width: 1.5, height: 1, format: 'png' } } }, /"width"/],
      [{ documents: {}, media: { 'x.png': { url: 'u', width: 1, height: 1, format: 'bmp' } } }, /"format"/],
    ] as const) {
      const response = await handleRender(post(body), deps);
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(text);
    }
  });

  it('400 when the path is missing or not a path', async () => {
    const deps = makeDeps();
    expect((await handleRender(post({ documents: {} }, { path: 'blog' }), deps)).status).toBe(400);
    expect((await handleRender(post({ documents: {} }, { path: '//evil.example/x' }), deps)).status).toBe(400);
    expect((await handleRender(new Request('http://x/__preview/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"documents":{}}' }), deps)).status).toBe(400);
  });

  it('404 when no page matches', async () => {
    const deps = makeDeps({ renderPage: async () => Promise.reject(new NotFoundError('/nope')) });
    const response = await handleRender(post({ documents: {} }, { path: '/nope' }), deps);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('/nope');
  });

  it('422 lists every failing field when a draft does not fit its schema, also when Astro wraps the error', async () => {
    const draft = new DraftError('blog/a', [{ path: ['title'], message: 'required' }]);
    const wrapped = Object.assign(new Error('render failed'), { cause: draft });
    const all = [
      { key: 'blog/a', path: ['title'], message: 'required' },
      { key: 'authors/b', path: ['name'], message: 'bad' },
    ];
    const deps = makeDeps({ renderPage: async () => Promise.reject(wrapped), validate: vi.fn(async () => all) });
    const response = await handleRender(post({ documents: {} }), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ errors: all });
  });

  it('422 falls back to the error the render hit when validation finds nothing', async () => {
    const draft = new DraftError('blog/a', [{ path: ['title'], message: 'required' }]);
    const deps = makeDeps({ renderPage: async () => Promise.reject(draft) });
    const response = await handleRender(post({ documents: {} }), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ errors: [{ key: 'blog/a', path: ['title'], message: 'required' }] });
  });

  it('500 with the message for any other error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ renderPage: async () => Promise.reject(new Error('component broke')) });
    const response = await handleRender(post({ documents: {} }), deps);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('component broke');
  });
});

describe('handleValidate', () => {
  const validateRequest = (body: unknown) =>
    new Request('http://x/__preview/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('200 valid when every document fits, and renders nothing', async () => {
    const deps = makeDeps();
    const response = await handleValidate(validateRequest({ documents: { 'blog/a': {} } }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true });
    expect(deps.renderPage).not.toHaveBeenCalled();
    expect(deps.validate).toHaveBeenCalledOnce();
  });

  it('422 with the errors', async () => {
    const errors = [{ key: 'blog/a', path: ['title'], message: 'required' }];
    const deps = makeDeps({ validate: async () => errors });
    const response = await handleValidate(validateRequest({ documents: { 'blog/a': {} } }), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ errors });
  });

  it('shares the guard and the envelope checks with render', async () => {
    const deps = makeDeps();
    expect((await handleValidate(validateRequest({}), deps)).status).toBe(400);
    expect((await handleValidate(validateRequest([]), deps)).status).toBe(400);
  });
});
