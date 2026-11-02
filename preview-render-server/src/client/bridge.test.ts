// @vitest-environment happy-dom

import {
  type PageMessage,
  PROTOCOL_VERSION,
  type RenderResponse,
} from 'preview-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathWithoutPreviewToken, startBridge } from './bridge.ts';

const ORIGIN = 'http://localhost:4400';
const EDITOR = 'https://editor.example';
const PAGE =
  '<main><div data-preview-region="blocks"><p>saved</p></div></main>';

/**
 * A page inside an iframe: real DOM (happy-dom), fake parent, fetch and location.
 * `config` is the answer to `GET /__preview/config`: the origins it lists, or a
 * response or an error to give instead. Resolves once the bridge has started.
 */
async function setup(
  html = PAGE,
  config: string[] | Response | Error | Promise<Response> = [],
  location = { pathname: '/blog/blog-1', search: '' },
) {
  document.head.innerHTML = '<title>Saved</title>';
  document.body.innerHTML = html;
  const parent = { postMessage: vi.fn() };
  const fetch = vi.fn<typeof globalThis.fetch>();
  if (config instanceof Error) fetch.mockRejectedValueOnce(config);
  else if (config instanceof Promise) fetch.mockReturnValueOnce(config);
  else
    fetch.mockResolvedValueOnce(
      Array.isArray(config) ? Response.json({ editorOrigins: config }) : config,
    );
  const win = Object.assign(new EventTarget(), {
    parent,
    document,
    DOMParser: window.DOMParser,
    location: { origin: ORIGIN, ...location },
  }) as unknown as Window & typeof globalThis;
  const stop = await startBridge(win, fetch);

  const sent = () =>
    parent.postMessage.mock.calls.map(([message]) => message as PageMessage);
  const targets = () =>
    parent.postMessage.mock.calls.map(([, target]) => target as string);
  const post = (
    data: unknown,
    { source = parent as unknown, origin = ORIGIN } = {},
  ) => {
    win.dispatchEvent(
      Object.assign(new Event('message'), { data, source, origin }),
    );
  };
  // The render requests, without the one that read the origins.
  const renders = () =>
    fetch.mock.calls.filter(([url]) => url !== '/__preview/config');
  return { win, parent, fetch, stop, sent, targets, post, renders };
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
const draft = (
  documents: Record<string, unknown> = {},
  media: Record<string, unknown> = {},
) => ({ type: 'preview:draft', protocol: PROTOCOL_VERSION, documents, media });
const region = () => document.querySelector('[data-preview-region="blocks"]')!;
const blocks = (inner: string) =>
  `<main><div data-preview-region="blocks">${inner}</div></main>`;

let bridge: Awaited<ReturnType<typeof setup>>;
afterEach(() => bridge?.stop?.());

// The preview token is `preview_token` (PHASE-2-DESIGN 5.7). The name `token`
// was the phase 1 placeholder; a site's own `token` parameter is not ours.
describe('pathWithoutPreviewToken', () => {
  it.each([
    ['/blog/blog-1?preview_token=secret&locale=en', '/blog/blog-1?locale=en'],
    ['/blog/blog-1?locale=en&preview_token=secret', '/blog/blog-1?locale=en'],
    [
      '/blog/blog-1?locale=en&preview_token=secret&page=2',
      '/blog/blog-1?locale=en&page=2',
    ],
    ['/blog/blog-1?preview_token=secret', '/blog/blog-1'],
    ['/blog/blog-1?preview_token', '/blog/blog-1'],
    ['/blog/blog-1?preview_token=', '/blog/blog-1'],
    [
      '/blog/blog-1?preview_token=a&locale=en&preview_token=b',
      '/blog/blog-1?locale=en',
    ],
    ['/blog/blog-1?&preview_token=secret&locale=en', '/blog/blog-1?locale=en'],
    ['/blog/blog-1?preview_token=secret&', '/blog/blog-1'],
    ['/blog/blog-1?preview%5Ftoken=secret&locale=en', '/blog/blog-1?locale=en'],
    ['/blog/blog-1?locale=a%20b&preview_token=x', '/blog/blog-1?locale=a%20b'],
    ['/blog/blog-1?%zz=1&preview_token=secret', '/blog/blog-1?%zz=1'],
    [
      '/blog/blog-1?token=secret&preview_token=abc',
      '/blog/blog-1?token=secret',
    ],
  ])('drops the preview token from %s', (path, expected) => {
    expect(pathWithoutPreviewToken(path)).toBe(expected);
  });

  it.each([
    ['/blog/blog-1'],
    ['/blog/blog-1?'],
    ['/blog/blog-1?locale=en'],
    ['/blog/blog-1?token=secret'],
    ['/blog/blog-1?token'],
    ['/blog/blog-1?preview_tokens=1'],
    ['/blog/blog-1?mypreview_token=1'],
    ['/blog/blog-1?preview_token.id=1'],
    ['/blog/blog-1?Preview_token=1'],
    ['/blog/blog-1?preview-token=1'],
    ['/blog/blog-1?locale=en&&page=2'],
  ])('leaves %s as it is (near miss)', (path) => {
    expect(pathWithoutPreviewToken(path)).toBe(path);
  });
});

describe('protocol version', () => {
  it.each([
    [
      'a different protocol',
      { type: 'preview:draft', protocol: 1, documents: {}, media: {} },
      'sent 1',
    ],
    [
      'no protocol',
      { type: 'preview:draft', documents: {}, media: {} },
      'sent none',
    ],
  ])(
    'answers %s with an error and does not render',
    async (_, message, text) => {
      bridge = await setup();
      bridge.post(message);
      expect(bridge.renders()).toEqual([]);
      const error = bridge.sent().at(-1)!;
      expect(error).toMatchObject({
        type: 'preview:error',
        path: '/blog/blog-1',
        status: 0,
      });
      expect((error as { message: string }).message).toContain(
        'protocol mismatch',
      );
      expect((error as { message: string }).message).toContain(
        text.replace('sent', 'other sent'),
      );
    },
  );
});

describe('startBridge', () => {
  it('does nothing outside an iframe, and does not even read the origins', async () => {
    const win = Object.assign(new EventTarget(), {
      document,
      location: { origin: ORIGIN },
    });
    (win as { parent?: unknown }).parent = win;
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      await startBridge(win as unknown as Window & typeof globalThis, fetch),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the editor origins from /__preview/config before it announces anything', async () => {
    bridge = await setup(PAGE, [EDITOR]);
    expect(bridge.fetch).toHaveBeenCalledExactlyOnceWith('/__preview/config', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(bridge.targets()).toEqual([ORIGIN, EDITOR]);
  });

  it('owes a ready for a navigation that happens while the origins are read, and sends it once they are known', async () => {
    let answer!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const started = setup(PAGE, pending);
    // The first load's astro:page-load can fire before the origins arrive.
    document.dispatchEvent(new Event('astro:page-load'));
    answer(Response.json({ editorOrigins: [EDITOR] }));
    bridge = await started;
    const ready = {
      type: 'preview:ready',
      path: '/blog/blog-1',
      protocol: PROTOCOL_VERSION,
    };
    // Two readies, each sent to the page's origin and the editor's.
    expect(bridge.sent()).toEqual([ready, ready, ready, ready]);
    expect(bridge.targets()).toEqual([ORIGIN, EDITOR, ORIGIN, EDITOR]);
  });

  it.each([
    ['an unreachable route', new TypeError('Failed to fetch')],
    ['a status other than 200', new Response('nope', { status: 503 })],
    ['JSON that is not valid', new Response('{not json')],
    [
      'JSON without an origin list',
      Response.json({ editorOrigins: 'https://editor.example' }),
    ],
    ['a list with a non-string', Response.json({ editorOrigins: [1] })],
  ])(
    'fails closed on %s: logs once, sends nothing and answers nobody',
    async (_label, config) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        bridge = await setup(PAGE, config);
        expect(bridge.stop).toBeNull();
        expect(bridge.sent()).toEqual([]);
        bridge.post(draft());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(bridge.fetch).toHaveBeenCalledOnce();
        expect(bridge.parent.postMessage).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledOnce();
        expect(log.mock.calls[0]?.[0]).toBe(
          '[preview-bridge] no editor origins; the bridge stays off',
        );
      } finally {
        log.mockRestore();
      }
    },
  );

  it.each([
    ['an exact https origin', EDITOR, true],
    ['an exact http origin with a port', 'http://localhost:3000', true],
    ['an origin with a trailing slash', `${EDITOR}/`, false],
    ['an origin with a path', `${EDITOR}/editor`, false],
    ['an origin with a default port', `${EDITOR}:443`, false],
    ['an origin in capitals', 'https://Editor.example', false],
    ['a wildcard', '*', false],
    ['the literal null origin', 'null', false],
    ['another scheme', 'ftp://editor.example', false],
  ])(
    'keeps only exact http or https origins from the route: %s',
    async (_label, listed, kept) => {
      bridge = await setup(PAGE, [listed]);
      expect(bridge.targets()).toEqual(kept ? [ORIGIN, listed] : [ORIGIN]);
      expect(bridge.targets()).not.toContain('*');
    },
  );

  it('announces the page path to the editor, with an explicit target origin', async () => {
    bridge = await setup();
    expect(bridge.parent.postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: 'preview:ready',
        path: '/blog/blog-1',
        protocol: PROTOCOL_VERSION,
      },
      ORIGIN,
    );
  });

  it('omits the preview_token query parameter from the ready path, and keeps a site token', async () => {
    bridge = await setup(PAGE, [], {
      pathname: '/blog/blog-1',
      search: '?token=site&preview_token=secret&locale=en',
    });

    expect(bridge.sent()).toEqual([
      {
        type: 'preview:ready',
        path: '/blog/blog-1?token=site&locale=en',
        protocol: PROTOCOL_VERSION,
      },
    ]);
  });

  it('sends no preview token in the render request or in the answer', async () => {
    bridge = await setup(PAGE, [], {
      pathname: '/blog/blog-1',
      search: '?preview_token=secret&locale=en',
    });
    bridge.fetch.mockResolvedValue(rendered(blocks('<p>x</p>')));

    bridge.post(draft());

    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)?.type).toBe('preview:rendered'),
    );
    expect(bridge.fetch).toHaveBeenCalledWith(
      '/__preview/render?path=%2Fblog%2Fblog-1%3Flocale%3Den',
      expect.anything(),
    );
    expect(bridge.sent().at(-1)).toMatchObject({
      type: 'preview:rendered',
      path: '/blog/blog-1?locale=en',
    });
  });

  it('announces to every allowed editor origin, never "*"', async () => {
    bridge = await setup(PAGE, [EDITOR]);
    expect(bridge.targets().sort()).toEqual([EDITOR, ORIGIN].sort());
    expect(bridge.targets()).not.toContain('*');
  });

  it('announces the new path after a ClientRouter navigation', async () => {
    bridge = await setup();
    bridge.parent.postMessage.mockClear();
    (bridge.win.location as { pathname: string }).pathname = '/faq';
    document.dispatchEvent(new Event('astro:page-load'));
    expect(bridge.sent()).toEqual([
      { type: 'preview:ready', path: '/faq', protocol: PROTOCOL_VERSION },
    ]);
  });

  it('drops the answer to a draft sent before a navigation', async () => {
    bridge = await setup();
    let answer!: (response: Response) => void;
    bridge.fetch.mockReturnValueOnce(
      new Promise((resolve) => (answer = resolve)),
    );
    bridge.post(draft({ n: 1 }));
    (bridge.win.location as { pathname: string }).pathname = '/faq';
    document.dispatchEvent(new Event('astro:page-load'));
    bridge.parent.postMessage.mockClear();
    answer(rendered(blocks('<p>old page</p>')));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(region().innerHTML).toBe('<p>saved</p>');
    expect(bridge.sent()).toEqual([]);
  });

  it('keeps the answer to a draft sent before a repeat ready for the same path (D14)', async () => {
    bridge = await setup();
    let answer!: (response: Response) => void;
    bridge.fetch.mockReturnValueOnce(
      new Promise((resolve) => (answer = resolve)),
    );
    bridge.post(draft({ n: 1 }));
    document.dispatchEvent(new Event('astro:page-load'));
    answer(rendered(blocks('<p>draft</p>')));

    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>draft</p>'));
  });
});

describe('on a draft', () => {
  beforeEach(async () => {
    bridge = await setup();
  });

  it('POSTs the overlay to the render route for the current path and patches the page', async () => {
    bridge.fetch.mockResolvedValue(
      rendered(blocks('<p>draft</p>'), { limits: ['code-language:cpp'] }),
    );
    const documents = { 'blog/blog-1': { data: { title: 'x' }, body: '' } };
    const media = {
      'a.png': {
        url: '/__preview-media/0123456789abcdef.png',
        width: 1,
        height: 1,
        format: 'png',
      },
    };
    bridge.post(draft(documents, media));

    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>draft</p>'));
    expect(bridge.renders()).toHaveLength(1);
    expect(bridge.fetch).toHaveBeenCalledWith(
      '/__preview/render?path=%2Fblog%2Fblog-1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents, media }),
        cache: 'no-store',
        credentials: 'same-origin',
      },
    );
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
    bridge = await setup(PAGE, [], { pathname: '/blog', search: '?page=2' });
    bridge.fetch.mockResolvedValue(rendered(blocks('<p>x</p>')));
    bridge.post(draft());
    await vi.waitFor(() => expect(bridge.renders()).not.toEqual([]));
    expect(bridge.renders()[0]![0]).toBe(
      '/__preview/render?path=%2Fblog%3Fpage%3D2',
    );
  });

  it('an empty overlay renders too: it primes a page that is older than the saved content', async () => {
    bridge.fetch.mockResolvedValue(rendered(blocks('<p>newer saved</p>')));
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(region().innerHTML).toBe('<p>newer saved</p>'),
    );
  });

  it('answers to the origin of the editor that sent the draft', async () => {
    bridge.stop?.();
    bridge = await setup(PAGE, [EDITOR]);
    bridge.fetch.mockResolvedValue(rendered(blocks('<p>x</p>')));
    bridge.post(draft(), { origin: EDITOR });
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)?.type).toBe('preview:rendered'),
    );
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
    expect(
      bridge.sent().filter((message) => message.type === 'preview:rendered'),
    ).toHaveLength(1);
  });

  it('reports a failed render and keeps the last good page', async () => {
    bridge.fetch.mockResolvedValue(
      new Response('Page render failed: boom', { status: 500 }),
    );
    bridge.post(draft());

    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({
        type: 'preview:error',
        path: '/blog/blog-1',
        status: 500,
        message: 'Page render failed: boom',
      }),
    );
    expect(region().innerHTML).toBe('<p>saved</p>');
  });

  it('a 422 hands the field errors to the editor', async () => {
    const errors = [
      { key: 'blog/blog-1', path: ['title'], message: 'Invalid input' },
    ];
    bridge.fetch.mockResolvedValue(Response.json({ errors }, { status: 422 }));
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({
        type: 'preview:error',
        path: '/blog/blog-1',
        status: 422,
        message: 'A draft does not fit its schema',
        errors: [{ ...errors[0], kind: 'invalid' }],
      }),
    );
    expect(region().innerHTML).toBe('<p>saved</p>');
  });

  it('a 422 from a bundle without kind reads every field as invalid, and keeps a kind it was sent', async () => {
    const legacy = [
      { key: 'blog/blog-1', path: ['title'], message: 'Required' },
      {
        key: 'blog/blog-1',
        path: [],
        message: 'boom',
        kind: 'refinement-threw',
      },
    ];
    bridge.fetch.mockResolvedValue(
      Response.json({ errors: legacy }, { status: 422 }),
    );
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({
        type: 'preview:error',
        path: '/blog/blog-1',
        status: 422,
        message: 'A draft does not fit its schema',
        errors: [
          {
            key: 'blog/blog-1',
            path: ['title'],
            message: 'Required',
            kind: 'invalid',
          },
          {
            key: 'blog/blog-1',
            path: [],
            message: 'boom',
            kind: 'refinement-threw',
          },
        ],
      }),
    );
  });

  it('a 404 (no page for this path in the draft) is reported', async () => {
    bridge.fetch.mockResolvedValue(
      new Response('No page matches "/blog/blog-1"', { status: 404 }),
    );
    bridge.post(draft({ 'blog/blog-1': null }));
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toMatchObject({
        type: 'preview:error',
        status: 404,
      }),
    );
  });

  it('reports a network error', async () => {
    bridge.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({
        type: 'preview:error',
        path: '/blog/blog-1',
        status: 0,
        message: 'TypeError: Failed to fetch',
      }),
    );
  });

  it('reports a 200 that is not the render answer', async () => {
    bridge.fetch.mockResolvedValue(
      new Response('<html>not json</html>', { status: 200 }),
    );
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toMatchObject({
        type: 'preview:error',
        status: 0,
      }),
    );
    expect(region().innerHTML).toBe('<p>saved</p>');
  });
});

describe('ignores messages', () => {
  beforeEach(async () => {
    bridge = await setup(PAGE, [EDITOR]);
  });

  it.each([
    ['from another window', { source: {} }],
    ['from an origin that is not allowed', { origin: 'https://evil.example' }],
  ])('%s', (_, from) => {
    bridge.post(draft(), from);
    expect(bridge.renders()).toEqual([]);
  });

  it('that are not drafts', async () => {
    bridge.post({ type: 'preview:ready', path: '/' });
    bridge.post({ type: 'preview:draft', region: 'blocks', props: {} }); // protocol v1
    bridge.post({ type: 'preview:draft', documents: [], media: {} });
    bridge.post('hello');
    expect(bridge.renders()).toEqual([]);
  });

  it('after it is stopped', async () => {
    bridge.stop?.();
    bridge.post(draft());
    expect(bridge.renders()).toEqual([]);
  });
});

describe('stale answers', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    bridge = await setup();
  });

  it('drops the answer of a draft when a message with another protocol came after it', async () => {
    let answerFirst!: (response: Response) => void;
    bridge.fetch
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockReturnValueOnce(new Promise(() => {}));
    bridge.post(draft({ n: 1 }));
    bridge.post({
      type: 'preview:draft',
      protocol: 1,
      documents: {},
      media: {},
    });
    bridge.post(draft({ n: 2 })); // in flight, never answered
    bridge.parent.postMessage.mockClear();
    answerFirst(rendered(blocks('<p>first</p>')));
    await tick();
    expect(region().innerHTML).toBe('<p>saved</p>');
    expect(bridge.sent()).toEqual([]);
  });

  it('drops the answer of a draft sent before a navigation, also when a newer draft is in flight', async () => {
    let answerFirst!: (response: Response) => void;
    bridge.fetch
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockReturnValueOnce(new Promise(() => {}));
    bridge.post(draft({ n: 1 }));
    document.dispatchEvent(new Event('astro:page-load'));
    bridge.post(draft({ n: 2 })); // in flight, never answered
    bridge.parent.postMessage.mockClear();
    answerFirst(rendered(blocks('<p>first</p>')));
    await tick();
    expect(region().innerHTML).toBe('<p>saved</p>');
    expect(bridge.sent()).toEqual([]);
  });

  it('does not report the failure of a draft that a newer one replaced', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    let failFirst!: (error: Error) => void;
    bridge.fetch
      .mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject)))
      .mockResolvedValueOnce(rendered(blocks('<p>second</p>')));
    bridge.post(draft({ n: 1 }));
    bridge.post(draft({ n: 2 }));
    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>second</p>'));
    bridge.parent.postMessage.mockClear();
    failFirst(new TypeError('Failed to fetch'));
    await tick();
    expect(bridge.sent()).toEqual([]);
    expect(quiet).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('does not report a bad answer to a draft that a newer one replaced', async () => {
    let answerFirst!: (response: Response) => void;
    bridge.fetch
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce(rendered(blocks('<p>second</p>')));
    bridge.post(draft({ n: 1 }));
    bridge.post(draft({ n: 2 }));
    await vi.waitFor(() => expect(region().innerHTML).toBe('<p>second</p>'));
    bridge.parent.postMessage.mockClear();
    answerFirst(new Response('not json', { status: 200 }));
    await tick();
    expect(bridge.sent()).toEqual([]);
  });
});

describe('what the bridge does around a draft', () => {
  it('ignores messages that are not drafts completely: nothing is sent and the editor origin does not change', async () => {
    bridge = await setup(PAGE, [EDITOR]);
    bridge.parent.postMessage.mockClear();
    bridge.post({ type: 'preview:ready', path: '/' }, { origin: EDITOR });
    bridge.post('hello', { origin: EDITOR });
    expect(bridge.sent()).toEqual([]);
    bridge.post(
      { type: 'preview:draft', documents: {}, media: {} },
      { origin: ORIGIN },
    ); // mismatch: answered to the page origin
    expect(bridge.targets()).toEqual([ORIGIN]);
  });

  it('forgets the inline scripts it ran when the page is replaced, so the new page gets them', async () => {
    bridge = await setup();
    const inline = '<script>window.island = 1</script>';
    const scripts = () =>
      Array.from(
        document.querySelectorAll('script'),
        (script) => script.textContent,
      );
    bridge.fetch.mockImplementation(async () =>
      rendered(blocks('<p>x</p>') + inline),
    );
    bridge.post(draft({ n: 1 }));
    await vi.waitFor(() => expect(scripts()).toEqual(['window.island = 1']));

    document.body.innerHTML = PAGE; // a navigation replaced the document
    document.dispatchEvent(new Event('astro:page-load'));
    bridge.post(draft({ n: 2 }));
    await vi.waitFor(() => expect(scripts()).toEqual(['window.island = 1']));
  });

  it('logs what it patched and what failed', async () => {
    bridge = await setup();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    bridge.fetch.mockResolvedValueOnce(rendered(blocks('<p>x</p>')));
    bridge.post(draft({ 'blog/blog-1': {} }));
    await vi.waitFor(() => expect(info).toHaveBeenCalled());
    expect(info).toHaveBeenCalledWith(
      '[preview-bridge] patched',
      '/blog/blog-1',
      {
        changed: expect.any(Array),
        sent: ['blog/blog-1'],
        read: 1,
        limits: [],
        renderMs: 4.2,
      },
    );
    bridge.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[preview-bridge] draft failed',
        '/blog/blog-1',
        expect.any(TypeError),
      ),
    );
    info.mockRestore();
    error.mockRestore();
  });

  it('stops listening for navigations too', async () => {
    bridge = await setup();
    bridge.stop?.();
    bridge.parent.postMessage.mockClear();
    document.dispatchEvent(new Event('astro:page-load'));
    expect(bridge.sent()).toEqual([]);
  });
});

describe('error answers', () => {
  beforeEach(async () => {
    bridge = await setup();
  });

  it('only a 422 is read as field errors', async () => {
    bridge.fetch.mockResolvedValue(
      Response.json(
        { errors: [{ key: 'a', path: [], message: 'm' }] },
        { status: 500 },
      ),
    );
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toMatchObject({
        type: 'preview:error',
        status: 500,
      }),
    );
    const message = bridge.sent().at(-1) as {
      message: string;
      errors?: unknown;
    };
    expect(message.message).toBe(
      '{"errors":[{"key":"a","path":[],"message":"m"}]}',
    );
    expect('errors' in message).toBe(false);
  });

  it('a 422 that is not JSON is reported with its text', async () => {
    bridge.fetch.mockResolvedValue(
      new Response('Unprocessable', { status: 422 }),
    );
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toEqual({
        type: 'preview:error',
        path: '/blog/blog-1',
        status: 422,
        message: 'Unprocessable',
      }),
    );
  });

  it('cuts a long message at 500 characters', async () => {
    bridge.fetch.mockResolvedValue(
      new Response(`${'x'.repeat(501)}tail`, { status: 500 }),
    );
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toMatchObject({ status: 500 }),
    );
    expect((bridge.sent().at(-1) as { message: string }).message).toBe(
      'x'.repeat(500),
    );
  });

  it('keeps a message of exactly 500 characters whole', async () => {
    bridge.fetch.mockResolvedValue(
      new Response('y'.repeat(500), { status: 500 }),
    );
    bridge.post(draft());
    await vi.waitFor(() =>
      expect(bridge.sent().at(-1)).toMatchObject({ status: 500 }),
    );
    expect((bridge.sent().at(-1) as { message: string }).message).toHaveLength(
      500,
    );
  });
});
