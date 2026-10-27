// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageMessage, RenderResponse } from '../protocol.ts';
import { startBridge } from './bridge.ts';
import type { BridgeOptions } from './bridge.ts';

const ORIGIN = 'http://localhost:4400';
const EDITOR = 'https://editor.example';
const PAGE = '<main><div data-preview-region="blocks"><p>saved</p></div></main>';

/** A page inside an iframe: real DOM (happy-dom), fake parent, fetch and location. */
function setup(html = PAGE, options?: BridgeOptions, location = { pathname: '/blog/blog-1', search: '' }) {
  document.head.innerHTML = '<title>Saved</title>';
  document.body.innerHTML = html;
  const parent = { postMessage: vi.fn() };
  const fetch = vi.fn<typeof globalThis.fetch>();
  const win = Object.assign(new EventTarget(), {
    parent,
    document,
    DOMParser: window.DOMParser,
    location: { origin: ORIGIN, ...location },
  }) as unknown as Window & typeof globalThis;
  const stop = startBridge(win, fetch, options);

  const sent = () => parent.postMessage.mock.calls.map(([message]) => message as PageMessage);
  const targets = () => parent.postMessage.mock.calls.map(([, target]) => target as string);
  const post = (data: unknown, { source = parent as unknown, origin = ORIGIN } = {}) => {
    win.dispatchEvent(Object.assign(new Event('message'), { data, source, origin }));
  };
  return { win, parent, fetch, stop, sent, targets, post };
}

const rendered = (body: string, extra: Partial<RenderResponse> = {}) =>
  Response.json({
    html: `<!DOCTYPE html><html><head><title>Saved</title></head><body>${body}</body></html>`,
    head: { meta: [] },
    documents: ['blog/blog-1'],
    limits: [],
    renderMs: 4.2,
    ...extra,
  } satisfies RenderResponse);
const draft = (documents: Record<string, unknown> = {}, media: Record<string, unknown> = {}) => ({ type: 'preview:draft', documents, media });
const region = () => document.querySelector('[data-preview-region="blocks"]')!;
const blocks = (inner: string) => `<main><div data-preview-region="blocks">${inner}</div></main>`;

let bridge: ReturnType<typeof setup>;
afterEach(() => bridge?.stop?.());

describe('startBridge', () => {
  it('does nothing outside an iframe', () => {
    const win = Object.assign(new EventTarget(), { document, location: { origin: ORIGIN } });
    (win as { parent?: unknown }).parent = win;
    expect(startBridge(win as unknown as Window & typeof globalThis, vi.fn())).toBeNull();
  });

  it('announces the page path to the editor, with an explicit target origin', () => {
    bridge = setup();
    expect(bridge.parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'preview:ready', path: '/blog/blog-1' }, ORIGIN);
  });

  it('announces to every allowed editor origin, never "*"', () => {
    bridge = setup(PAGE, { editorOrigins: [EDITOR] });
    expect(bridge.targets().sort()).toEqual([EDITOR, ORIGIN].sort());
    expect(bridge.targets()).not.toContain('*');
  });

  it('announces the new path after a ClientRouter navigation', () => {
    bridge = setup();
    bridge.parent.postMessage.mockClear();
    (bridge.win.location as { pathname: string }).pathname = '/faq';
    document.dispatchEvent(new Event('astro:page-load'));
    expect(bridge.sent()).toEqual([{ type: 'preview:ready', path: '/faq' }]);
  });

  it('drops the answer to a draft sent before a navigation', async () => {
    bridge = setup();
    let answer!: (response: Response) => void;
    bridge.fetch.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    bridge.post(draft({ n: 1 }));
    document.dispatchEvent(new Event('astro:page-load'));
    bridge.parent.postMessage.mockClear();
    answer(rendered(blocks('<p>old page</p>')));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(region().innerHTML).toBe('<p>saved</p>');
    expect(bridge.sent()).toEqual([]);
  });
});

describe('on a draft', () => {
  beforeEach(() => {
    bridge = setup();
  });

  it('POSTs the overlay to the render route for the current path and patches the page', async () => {
    bridge.fetch.mockResolvedValue(rendered(blocks('<p>draft</p>'), { limits: ['code-language:cpp'] }));
    const documents = { 'blog/blog-1': { data: { title: 'x' }, body: '' } };
    const media = { 'a.png': { url: '/__preview-media/0123456789abcdef.png', width: 1, height: 1, format: 'png' } };
    bridge.post(draft(documents, media));

    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>draft</p>'));
    expect(bridge.fetch).toHaveBeenCalledExactlyOnceWith('/__preview/render?path=%2Fblog%2Fblog-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents, media }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(bridge.sent().at(-1)).toEqual({
      type: 'preview:rendered',
      path: '/blog/blog-1',
      documents: ['blog/blog-1'],
      limits: ['code-language:cpp'],
      renderMs: 4.2,
    });
  });

  it('keeps the query string in the path it asks for', async () => {
    bridge.stop?.();
    bridge = setup(PAGE, undefined, { pathname: '/blog', search: '?page=2' });
    bridge.fetch.mockResolvedValue(rendered(blocks('<p>x</p>')));
    bridge.post(draft());
    await vi.waitFor(() => expect(bridge.fetch).toHaveBeenCalled());
    expect(bridge.fetch.mock.calls[0][0]).toBe('/__preview/render?path=%2Fblog%3Fpage%3D2');
  });

  it('an empty overlay renders too: it primes a page that is older than the saved content', async () => {
    bridge.fetch.mockResolvedValue(rendered(blocks('<p>newer saved</p>')));
    bridge.post(draft());
    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>newer saved</p>'));
  });

  it('answers to the origin of the editor that sent the draft', async () => {
    bridge.stop?.();
    bridge = setup(PAGE, { editorOrigins: [EDITOR] });
    bridge.fetch.mockResolvedValue(rendered(blocks('<p>x</p>')));
    bridge.post(draft(), { origin: EDITOR });
    await vi.waitFor(() => expect(bridge.sent().at(-1)?.type).toBe('preview:rendered'));
    expect(bridge.targets().at(-1)).toBe(EDITOR);
  });

  it('lets only the newest draft land when answers arrive out of order', async () => {
    let answerFirst!: (response: Response) => void;
    bridge.fetch
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce(rendered(blocks('<p>second</p>')));

    bridge.post(draft({ n: 1 }));
    bridge.post(draft({ n: 2 }));
    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>second</p>'));
    answerFirst(rendered(blocks('<p>first</p>')));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(region().innerHTML).toBe('<p>second</p>');
    expect(bridge.sent().filter((message) => message.type === 'preview:rendered')).toHaveLength(1);
  });

  it('reports a failed render and keeps the last good page', async () => {
    bridge.fetch.mockResolvedValue(new Response('Page render failed: boom', { status: 500 }));
    bridge.post(draft());

    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({ type: 'preview:error', path: '/blog/blog-1', status: 500, message: 'Page render failed: boom' }),
    );
    expect(region().innerHTML).toBe('<p>saved</p>');
  });

  it('a 422 hands the field errors to the editor', async () => {
    const errors = [{ key: 'blog/blog-1', path: ['title'], message: 'Invalid input' }];
    bridge.fetch.mockResolvedValue(Response.json({ errors }, { status: 422 }));
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({ type: 'preview:error', path: '/blog/blog-1', status: 422, message: 'A draft does not fit its schema', errors }),
    );
    expect(region().innerHTML).toBe('<p>saved</p>');
  });

  it('a 404 (no page for this path in the draft) is reported', async () => {
    bridge.fetch.mockResolvedValue(new Response('No page matches "/blog/blog-1"', { status: 404 }));
    bridge.post(draft({ 'blog/blog-1': null }));
    await vi.waitFor(() => expect(bridge.sent().at(-1)).toMatchObject({ type: 'preview:error', status: 404 }));
  });

  it('reports a network error', async () => {
    bridge.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({ type: 'preview:error', path: '/blog/blog-1', status: 0, message: 'TypeError: Failed to fetch' }),
    );
  });

  it('reports a 200 that is not the render answer', async () => {
    bridge.fetch.mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
    bridge.post(draft());
    await vi.waitFor(() => expect(bridge.sent().at(-1)).toMatchObject({ type: 'preview:error', status: 0 }));
    expect(region().innerHTML).toBe('<p>saved</p>');
  });
});

describe('ignores messages', () => {
  beforeEach(() => {
    bridge = setup(PAGE, { editorOrigins: [EDITOR] });
  });

  it.each([
    ['from another window', { source: {} }],
    ['from an origin that is not allowed', { origin: 'https://evil.example' }],
  ])('%s', (_, from) => {
    bridge.post(draft(), from);
    expect(bridge.fetch).not.toHaveBeenCalled();
  });

  it('that are not drafts', () => {
    bridge.post({ type: 'preview:ready', path: '/' });
    bridge.post({ type: 'preview:draft', region: 'blocks', props: {} }); // protocol v1
    bridge.post({ type: 'preview:draft', documents: [], media: {} });
    bridge.post('hello');
    expect(bridge.fetch).not.toHaveBeenCalled();
  });

  it('after it is stopped', () => {
    bridge.stop?.();
    bridge.post(draft());
    expect(bridge.fetch).not.toHaveBeenCalled();
  });
});
