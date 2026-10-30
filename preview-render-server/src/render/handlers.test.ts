import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentOverlay } from '../overlay/context.ts';
import { DraftError } from '../overlay/errors.ts';
import type { HandlerDeps } from './handlers.ts';
import { handleRender, handleValidate, MAX_BODY_BYTES } from './handlers.ts';
import { NotFoundError } from './render-page.ts';

const page = {
  html: '<html><head><title>T</title><meta name="a" content="b"></head><body>hi</body></html>',
  route: '/',
  pathsMs: 1,
  renderMs: 2,
};

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    renderPage: vi.fn(async () => page),
    validate: vi.fn(async () => []),
    builtDocuments: () => [{ key: 'blog/a', format: 'md', buildTime: false }],
    ...overrides,
  };
}

const post = (
  body: unknown,
  {
    path = '/',
    type = 'application/json',
    headers = {} as Record<string, string>,
  } = {},
) =>
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
    const response = await handleRender(
      post({ documents: { 'blog/new': { data: {} } } }, { path: '/blog?x=1' }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('server-timing')).toBe(
      'paths;dur=1.0, render;dur=2.0',
    );
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
    await Promise.all([
      handleRender(post({ documents: { a: 1 } }), deps),
      handleRender(post({ documents: { b: 2 } }), deps),
    ]);
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('refuses what is not JSON, the wrong content type and cross-site calls', async () => {
    const deps = makeDeps();
    expect(
      (
        await handleRender(
          post({ documents: {} }, { type: 'text/plain' }),
          deps,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleRender(
          post(
            { documents: {} },
            { headers: { 'sec-fetch-site': 'cross-site' } },
          ),
          deps,
        )
      ).status,
    ).toBe(403);
    expect((await handleRender(post('{not json'), deps)).status).toBe(400);
    expect(deps.renderPage).not.toHaveBeenCalled();
  });

  it('400 names the part of the envelope that failed', async () => {
    const deps = makeDeps();
    for (const [body, text] of [
      ['"text"', /JSON object/],
      [{}, /"documents" must be an object/],
      [{ documents: [] }, /"documents" must be an object/],
      [
        {
          documents: {},
          media: { 'x.png': { url: 1, width: 1, height: 1, format: 'png' } },
        },
        /"url" must be a string/,
      ],
      [
        {
          documents: {},
          media: { 'x.png': { url: 'u', width: 0, height: 1, format: 'png' } },
        },
        /"width"/,
      ],
      [
        {
          documents: {},
          media: {
            'x.png': { url: 'u', width: 1.5, height: 1, format: 'png' },
          },
        },
        /"width"/,
      ],
      [
        {
          documents: {},
          media: { 'x.png': { url: 'u', width: 1, height: 1, format: 'bmp' } },
        },
        /"format"/,
      ],
    ] as const) {
      const response = await handleRender(post(body), deps);
      expect(response.status).toBe(400);
      expect(await response.text()).toMatch(text);
    }
  });

  it('400 when the path is missing or not a path', async () => {
    const deps = makeDeps();
    expect(
      (await handleRender(post({ documents: {} }, { path: 'blog' }), deps))
        .status,
    ).toBe(400);
    expect(
      (
        await handleRender(
          post({ documents: {} }, { path: '//evil.example/x' }),
          deps,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleRender(
          new Request('http://x/__preview/render', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"documents":{}}',
          }),
          deps,
        )
      ).status,
    ).toBe(400);
  });

  it('404 when no page matches', async () => {
    const deps = makeDeps({
      renderPage: async () => Promise.reject(new NotFoundError('/nope')),
    });
    const response = await handleRender(
      post({ documents: {} }, { path: '/nope' }),
      deps,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('/nope');
  });

  it('422 lists every failing field when a draft does not fit its schema, also when Astro wraps the error', async () => {
    const draft = new DraftError('blog/a', [
      { path: ['title'], message: 'required' },
    ]);
    const wrapped = Object.assign(new Error('render failed'), { cause: draft });
    const all = [
      { key: 'blog/a', path: ['title'], message: 'required' },
      { key: 'authors/b', path: ['name'], message: 'bad' },
    ];
    const deps = makeDeps({
      renderPage: async () => Promise.reject(wrapped),
      validate: vi.fn(async () => all),
    });
    const response = await handleRender(post({ documents: {} }), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ errors: all });
  });

  it('422 falls back to the error the render hit when validation finds nothing', async () => {
    const draft = new DraftError('blog/a', [
      { path: ['title'], message: 'required' },
    ]);
    const deps = makeDeps({ renderPage: async () => Promise.reject(draft) });
    const response = await handleRender(post({ documents: {} }), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      errors: [{ key: 'blog/a', path: ['title'], message: 'required' }],
    });
  });

  it('500 with the message for any other error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({
      renderPage: async () => Promise.reject(new Error('component broke')),
    });
    const response = await handleRender(post({ documents: {} }), deps);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('component broke');
  });
});

describe('handleValidate', () => {
  const validateRequest = (body: unknown) =>
    new Request('http://x/__preview/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('200 valid when every document fits, and renders nothing', async () => {
    const deps = makeDeps();
    const response = await handleValidate(
      validateRequest({ documents: { 'blog/a': {} } }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true });
    expect(deps.renderPage).not.toHaveBeenCalled();
    expect(deps.validate).toHaveBeenCalledOnce();
  });

  it('422 with the errors', async () => {
    const errors = [{ key: 'blog/a', path: ['title'], message: 'required' }];
    const deps = makeDeps({ validate: async () => errors });
    const response = await handleValidate(
      validateRequest({ documents: { 'blog/a': {} } }),
      deps,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ errors });
  });

  it('shares the guard and the envelope checks with render', async () => {
    const deps = makeDeps();
    expect((await handleValidate(validateRequest({}), deps)).status).toBe(400);
    expect((await handleValidate(validateRequest([]), deps)).status).toBe(400);
  });
});

// -- Failure paths and details -------------------------------------------------

const draftError = () =>
  new DraftError('blog/a', [{ path: ['title'], message: 'required' }]);
/** An error whose `cause` chain holds `inner` after `depth` wrappers. */
const wrapped = (inner: unknown, depth: number) => {
  let error = inner;
  for (let i = 0; i < depth; i++)
    error = Object.assign(new Error(`wrapper ${i}`), { cause: error });
  return error;
};
const failingRender = (error: unknown) =>
  makeDeps({ renderPage: async () => Promise.reject(error) });

describe('handleRender: how far down a cause chain a DraftError is found', () => {
  it.each([0, 1, 2, 3, 4])('finds it under %i wrappers', async (depth) => {
    const response = await handleRender(
      post({ documents: {} }),
      failingRender(wrapped(draftError(), depth)),
    );
    expect(response.status).toBe(422);
  });

  it('gives up after five errors in the chain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handleRender(
      post({ documents: {} }),
      failingRender(wrapped(draftError(), 5)),
    );
    expect(response.status).toBe(500);
  });

  it('stops at an error without a cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handleRender(
      post({ documents: {} }),
      failingRender(wrapped(new Error('plain'), 2)),
    );
    expect(response.status).toBe(500);
  });
});

describe('handleRender: the failure answers', () => {
  it('uses the issues of the error when validating again fails', async () => {
    const deps = makeDeps({
      renderPage: async () => Promise.reject(draftError()),
      validate: async () => Promise.reject(new Error('validate broke')),
    });
    const response = await handleRender(post({ documents: {} }), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      errors: [{ key: 'blog/a', path: ['title'], message: 'required' }],
    });
  });

  it('validates again inside the overlay of the request', async () => {
    let seen: unknown;
    const deps = makeDeps({
      renderPage: async () => Promise.reject(draftError()),
      validate: async () => {
        seen = currentOverlay()?.documents;
        return [];
      },
    });
    await handleRender(post({ documents: { x: 1 } }), deps);
    expect(seen).toEqual({ x: 1 });
  });

  it('answers 422 as JSON that is not cached', async () => {
    const response = await handleRender(
      post({ documents: {} }),
      failingRender(draftError()),
    );
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 500 with the message, and logs the error with the path', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('component broke');
    const response = await handleRender(
      post({ documents: {} }, { path: '/blog/x' }),
      failingRender(error),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Page render failed: component broke');
    expect(log).toHaveBeenCalledWith(
      '[preview] render of "/blog/x" failed:',
      error,
    );
  });

  it.each([
    ['a string', 'boom', 'boom'],
    ['null', null, 'null'],
    ['a number', 42, '42'],
  ])('answers 500 when %s was thrown', async (_name, thrown, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handleRender(
      post({ documents: {} }),
      failingRender(thrown),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(`Page render failed: ${message}`);
  });

  it('answers 404 with the message of the error, as plain text', async () => {
    const response = await handleRender(
      post({ documents: {} }),
      failingRender(new NotFoundError('/nope')),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(new NotFoundError('/nope').message);
  });
});

describe('handleRender: request checks', () => {
  it('says what is wrong with the body and with the path', async () => {
    const deps = makeDeps();
    const notJson = await handleRender(post('{not json'), deps);
    expect(await notJson.text()).toBe('Body must be JSON');
    const badPath = await handleRender(
      post({ documents: {} }, { path: 'blog' }),
      deps,
    );
    expect(await badPath.text()).toBe(
      'Query "path" must be a URL path starting with "/"',
    );
  });

  it('accepts paths that start with one slash, also with //inside, and refuses an empty one', async () => {
    const deps = makeDeps();
    expect(
      (await handleRender(post({ documents: {} }, { path: '/a//b' }), deps))
        .status,
    ).toBe(200);
    expect(
      (await handleRender(post({ documents: {} }, { path: '/' }), deps)).status,
    ).toBe(200);
    expect(
      (await handleRender(post({ documents: {} }, { path: '' }), deps)).status,
    ).toBe(400);
    expect(
      (await handleRender(post({ documents: {} }, { path: '/\\evil' }), deps))
        .status,
    ).toBe(200);
  });

  it('accepts JSON with a charset', async () => {
    const response = await handleRender(
      post({ documents: {} }, { type: 'application/json; charset=utf-8' }),
      makeDeps(),
    );
    expect(response.status).toBe(200);
  });

  it('answers 403 "Forbidden" and 404 "Not Found" from the guard', async () => {
    const deps = makeDeps();
    const cross = await handleRender(
      post({ documents: {} }, { headers: { 'sec-fetch-site': 'cross-site' } }),
      deps,
    );
    expect(await cross.text()).toBe('Forbidden');
    const other = await handleRender(
      post({ documents: {} }, { type: 'text/plain' }),
      deps,
    );
    expect(await other.text()).toBe('Not Found');
  });

  it('gives the page the media map of the request', async () => {
    let media: unknown;
    const deps = makeDeps({
      renderPage: async () => {
        media = currentOverlay()?.media;
        return page;
      },
    });
    const entry = {
      url: '/__preview-media/a.png',
      width: 2,
      height: 3,
      format: 'png',
    };
    await handleRender(
      post({ documents: {}, media: { 'a.png': entry } }),
      deps,
    );
    expect(media).toEqual({ 'a.png': entry });
  });
});

describe('handleRender: the answer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rounds the render time to one decimal', async () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(100).mockReturnValueOnce(112.36);
    const body = await (
      await handleRender(post({ documents: {} }), makeDeps())
    ).json();
    expect(body.renderMs).toBe(12.4);
  });

  it('measures from before the render to after it', async () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(5).mockReturnValueOnce(7);
    const body = await (
      await handleRender(post({ documents: {} }), makeDeps())
    ).json();
    expect(body.renderMs).toBe(2);
  });

  it('gives the timings of the page with one decimal', async () => {
    const deps = makeDeps({
      renderPage: async () => ({ ...page, pathsMs: 1.26, renderMs: 20 }),
    });
    const response = await handleRender(post({ documents: {} }), deps);
    expect(response.headers.get('server-timing')).toBe(
      'paths;dur=1.3, render;dur=20.0',
    );
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('sorts the limits', async () => {
    const deps = makeDeps({
      renderPage: async () => {
        for (const limit of [
          'mdx-body',
          'code-language:ruby',
          'code-language:cpp',
        ])
          currentOverlay()!.limits.add(limit as never);
        return page;
      },
    });
    const body = await (
      await handleRender(post({ documents: {} }), deps)
    ).json();
    expect(body.limits).toEqual([
      'code-language:cpp',
      'code-language:ruby',
      'mdx-body',
    ]);
  });

  it('lists no documents when the page read none and there is no built list', async () => {
    const deps = makeDeps({ builtDocuments: () => undefined });
    const body = await (
      await handleRender(post({ documents: { 'blog/new': {} } }), deps)
    ).json();
    expect(body.documents).toEqual([]);
  });

  it('has an empty limits list when the page hit none', async () => {
    const body = await (
      await handleRender(post({ documents: {} }), makeDeps())
    ).json();
    expect(body.limits).toEqual([]);
  });
});

describe('handleValidate: failures and answers', () => {
  const validateRequest = (body: unknown) =>
    new Request('http://x/__preview/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('answers 500 with the message and logs the error when validating throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('schema broke');
    const deps = makeDeps({ validate: async () => Promise.reject(error) });
    const response = await handleValidate(
      validateRequest({ documents: {} }),
      deps,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Validation failed: schema broke');
    expect(log).toHaveBeenCalledWith('[preview] validation failed:', error);
  });

  it('answers 500 also when something that is not an Error was thrown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ validate: async () => Promise.reject('nope') });
    const response = await handleValidate(
      validateRequest({ documents: {} }),
      deps,
    );
    expect(await response.text()).toBe('Validation failed: nope');
  });

  it('validates the documents of the request, inside its overlay', async () => {
    let seen: unknown;
    const deps = makeDeps({
      validate: async (context) => {
        seen = [currentOverlay()?.documents, context.documents];
        return [];
      },
    });
    await handleValidate(validateRequest({ documents: { a: 1 } }), deps);
    expect(seen).toEqual([{ a: 1 }, { a: 1 }]);
  });

  it('answers JSON that is not cached', async () => {
    const ok = await handleValidate(
      validateRequest({ documents: {} }),
      makeDeps(),
    );
    expect(ok.headers.get('content-type')).toBe('application/json');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const bad = await handleValidate(
      validateRequest({ documents: {} }),
      makeDeps({
        validate: async () => [{ key: 'a', path: [], message: 'm' }],
      }),
    );
    expect(bad.headers.get('content-type')).toBe('application/json');
  });

  it('says "Body must be JSON" for a body that is not JSON', async () => {
    const request = new Request('http://x/__preview/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    const response = await handleValidate(request, makeDeps());
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Body must be JSON');
  });
});

// -- Body cap (D16) ------------------------------------------------------------

const CAP_ROUTES = [
  ['render', handleRender],
  ['validate', handleValidate],
] as const;

/** A JSON envelope of exactly `bytes` bytes (ASCII, so characters are bytes). */
function jsonOfSize(bytes: number): string {
  const head = '{"documents":{},"pad":"';
  const tail = '"}';
  return head + 'x'.repeat(bytes - head.length - tail.length) + tail;
}

/** The same text as a stream of 1 MiB chunks, so no Content-Length is implied. */
function streamed(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const chunk = 1024 * 1024;
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes.length; at += chunk)
        controller.enqueue(bytes.slice(at, at + chunk));
      controller.close();
    },
  });
}

const capRequest = (
  route: string,
  body: BodyInit,
  headers: Record<string, string> = {},
) =>
  new Request(`http://x/__preview/${route}?path=%2F`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit);

describe.each(CAP_ROUTES)('%s: body cap (D16)', (route, handle) => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts a body of exactly MAX_BODY_BYTES', async () => {
    const deps = makeDeps();
    const response = await handle(
      capRequest(route, jsonOfSize(MAX_BODY_BYTES)),
      deps,
    );
    expect(response.status).toBe(200);
  });

  it('answers 413 to one byte more, without parsing the body', async () => {
    const deps = makeDeps();
    const parse = vi.spyOn(JSON, 'parse');
    const response = await handle(
      capRequest(route, jsonOfSize(MAX_BODY_BYTES + 1)),
      deps,
    );
    expect(response.status).toBe(413);
    expect(await response.text()).toBe(
      `Body must be at most ${MAX_BODY_BYTES} bytes`,
    );
    expect(parse).not.toHaveBeenCalled();
    expect(deps.renderPage).not.toHaveBeenCalled();
    expect(deps.validate).not.toHaveBeenCalled();
  });

  it('answers 413 from a Content-Length over the cap, before reading the body', async () => {
    const deps = makeDeps();
    const parse = vi.spyOn(JSON, 'parse');
    const response = await handle(
      capRequest(route, '{"documents":{}}', {
        'content-length': String(MAX_BODY_BYTES + 1),
      }),
      deps,
    );
    expect(response.status).toBe(413);
    expect(parse).not.toHaveBeenCalled();
  });

  it('counts the stream when Content-Length is false and answers 413', async () => {
    const deps = makeDeps();
    const response = await handle(
      capRequest(route, streamed(jsonOfSize(MAX_BODY_BYTES + 1)), {
        'content-length': '2',
      }),
      deps,
    );
    expect(response.status).toBe(413);
    expect(deps.renderPage).not.toHaveBeenCalled();
    expect(deps.validate).not.toHaveBeenCalled();
  });

  it('counts the stream when Content-Length is missing and answers 413', async () => {
    const deps = makeDeps();
    const response = await handle(
      capRequest(route, streamed(jsonOfSize(MAX_BODY_BYTES + 1))),
      deps,
    );
    expect(response.status).toBe(413);
    expect(deps.renderPage).not.toHaveBeenCalled();
    expect(deps.validate).not.toHaveBeenCalled();
  });

  it('accepts a streamed body of exactly MAX_BODY_BYTES (near miss)', async () => {
    const response = await handle(
      capRequest(route, streamed(jsonOfSize(MAX_BODY_BYTES))),
      makeDeps(),
    );
    expect(response.status).toBe(200);
  });

  it('says "Body must be JSON" when the body stream fails', async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error('client went away'));
      },
    });
    const response = await handle(capRequest(route, broken), makeDeps());
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Body must be JSON');
  });
});
