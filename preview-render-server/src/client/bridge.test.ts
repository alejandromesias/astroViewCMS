// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageMessage } from '../protocol.ts';
import { startBridge } from './bridge.ts';

const ORIGIN = 'http://localhost:4400';

/** A page inside an iframe: real DOM (happy-dom), fake parent and fetch. */
function setup(html = '<main><div data-preview-region="blocks"><p>saved</p></div></main>') {
  document.body.innerHTML = html;
  const parent = { postMessage: vi.fn() };
  const fetch = vi.fn<typeof globalThis.fetch>();
  const win = Object.assign(new EventTarget(), {
    parent,
    document,
    location: { origin: ORIGIN },
  }) as unknown as Window;
  const stop = startBridge(win, fetch);

  const sent = () => parent.postMessage.mock.calls.map(([message]) => message as PageMessage);
  const post = (data: unknown, { source = parent as unknown, origin = ORIGIN } = {}) => {
    const event = Object.assign(new Event('message'), { data, source, origin });
    win.dispatchEvent(event);
  };
  return { win, parent, fetch, stop, sent, post };
}

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const draft = (props: unknown = { blocks: [] }, region = 'blocks') => ({ type: 'preview:draft', region, props });
const region = () => document.querySelector('[data-preview-region="blocks"]')!;

let bridge: ReturnType<typeof setup>;
afterEach(() => bridge?.stop?.());

describe('startBridge', () => {
  it('does nothing outside an iframe', () => {
    const win = Object.assign(new EventTarget(), { document, location: { origin: ORIGIN } });
    (win as { parent?: unknown }).parent = win;
    expect(startBridge(win as unknown as Window, vi.fn())).toBeNull();
  });

  it('announces the regions on the page to the editor, with an explicit target origin', () => {
    bridge = setup('<div data-preview-region="nav"></div><div data-preview-region="blocks"></div>');
    expect(bridge.parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'preview:ready', regions: ['nav', 'blocks'] }, ORIGIN);
  });
});

describe('on a draft', () => {
  beforeEach(() => {
    bridge = setup();
  });

  it('POSTs the props to the render route and swaps the HTML in', async () => {
    bridge.fetch.mockResolvedValue(html('<p>draft</p>', 200, { 'server-timing': 'render;dur=0.4' }));
    bridge.post(draft({ blocks: [{ type: 'hero' }] }));

    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>draft</p>'));
    expect(bridge.fetch).toHaveBeenCalledExactlyOnceWith('/__preview/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks: [{ type: 'hero' }] }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(bridge.sent().at(-1)).toEqual({ type: 'preview:rendered', region: 'blocks', renderMs: 0.4 });
  });

  it('keeps the wrapper element itself', async () => {
    const wrapper = region();
    bridge.fetch.mockResolvedValue(html('<p>draft</p>'));
    bridge.post(draft());
    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>draft</p>'));
    expect(region()).toBe(wrapper);
  });

  it('lets only the newest draft land when answers arrive out of order', async () => {
    let answerFirst!: (response: Response) => void;
    bridge.fetch
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce(html('<p>second</p>'));

    bridge.post(draft({ n: 1 }));
    bridge.post(draft({ n: 2 }));
    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>second</p>'));
    answerFirst(html('<p>first</p>'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(region().innerHTML).toBe('<p>second</p>');
    expect(bridge.sent().filter((message) => message.type === 'preview:rendered')).toHaveLength(1);
  });

  it('reports a failed render and keeps the last good HTML', async () => {
    bridge.fetch.mockResolvedValue(new Response('Region render failed: boom', { status: 500 }));
    bridge.post(draft());

    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({ type: 'preview:error', region: 'blocks', status: 500, message: 'Region render failed: boom' }),
    );
    expect(region().innerHTML).toBe('<p>saved</p>');
  });

  it('refuses a 200 that is not HTML', async () => {
    bridge.fetch.mockResolvedValue(Response.json({ not: 'html' }));
    bridge.post(draft());
    await vi.waitFor(() => expect(bridge.sent().at(-1)).toMatchObject({ type: 'preview:error', status: 200 }));
    expect(region().innerHTML).toBe('<p>saved</p>');
  });

  it('reports a network error', async () => {
    bridge.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({ type: 'preview:error', region: 'blocks', status: 0, message: 'TypeError: Failed to fetch' }),
    );
  });

  it('reports a region that is not on the page', async () => {
    bridge.post(draft({}, 'footer'));
    expect(bridge.sent().at(-1)).toEqual({ type: 'preview:error', region: 'footer', status: 0, message: 'No such region on this page' });
    expect(bridge.fetch).not.toHaveBeenCalled();
  });
});

describe('ignores messages', () => {
  beforeEach(() => {
    bridge = setup();
  });

  it.each([
    ['from another window', { source: {} }],
    ['from another origin', { origin: 'https://evil.example' }],
  ])('%s', (_, from) => {
    bridge.post(draft(), from);
    expect(bridge.fetch).not.toHaveBeenCalled();
  });

  it('that are not drafts', () => {
    bridge.post({ type: 'preview:ready', regions: [] });
    bridge.post('hello');
    expect(bridge.fetch).not.toHaveBeenCalled();
  });

  it('after it is stopped', () => {
    bridge.stop?.();
    bridge.post(draft());
    expect(bridge.fetch).not.toHaveBeenCalled();
  });
});
