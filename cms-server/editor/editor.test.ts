// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION } from 'preview-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildTimeNote,
  limitNote,
  RENDER_DELAY_MS,
  startEditor,
} from './editor.ts';

// The real markup from index.html, so the test follows it. (A path, not a
// URL: under happy-dom, URL is the DOM's, which node:fs doesn't accept.)
const BODY = fs
  .readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
    'utf8',
  )
  .match(/<body>([\s\S]*)<\/body>/)![1]!
  // A plain element stands in for the iframe: happy-dom would try to load it.
  // The editor only uses its src and contentWindow.
  .replace(/<iframe\b([^>]*)><\/iframe>/, '<div$1></div>');

/** The preview origin that GET /api/preview-url names (PHASE-2-DESIGN 5.10). */
const PREVIEW_ORIGIN = 'http://preview.localhost:4401';

/** What GET /api/documents?key= answers for each key (PHASE-2-DESIGN 5.9). */
const DOCUMENTS: Record<string, unknown> = {
  'authors/ana': {
    key: 'authors/ana',
    file: 'src/content/authors/ana.json',
    format: 'json',
    editable: true,
    buildTime: false,
    revision: 'r-ana',
    value: { name: 'Ana', links: [] },
  },
  'blog/blog-1': {
    key: 'blog/blog-1',
    file: 'src/content/blog/blog-1.md',
    format: 'md',
    editable: true,
    buildTime: false,
    revision: 'r-blog',
    value: { data: { title: 'One', draft: false }, body: 'Hello *world*' },
  },
  'data:src/config/config.json': {
    key: 'data:src/config/config.json',
    file: 'src/config/config.json',
    format: 'json',
    editable: true,
    buildTime: true,
    buildTimeFields: ['site.base_url', 'site.title'],
    revision: 'r-config',
    value: { site: {} },
  },
  'data:src/config/theme.json': {
    key: 'data:src/config/theme.json',
    file: 'src/config/theme.json',
    format: 'json',
    editable: true,
    buildTime: true,
    buildTimeFields: ['*'],
    revision: 'r-theme',
    value: {},
  },
  'broken/no-value': {
    key: 'broken/no-value',
    file: 'src/content/broken.json',
    format: 'json',
    editable: true,
    buildTime: false,
    revision: 'r-broken',
  },
  'broken/null-markdown': {
    key: 'broken/null-markdown',
    file: 'src/content/broken.md',
    format: 'md',
    editable: true,
    buildTime: false,
    revision: 'r-null',
    value: null,
  },
  'rules/one': {
    key: 'rules/one',
    file: 'src/content/rules.toml',
    format: 'toml',
    editable: false,
    buildTime: false,
    revision: 'r-rules',
  },
  'blog/post': {
    key: 'blog/post',
    file: 'src/content/blog/post.mdx',
    format: 'mdx',
    editable: true,
    buildTime: false,
    revision: 'r-post',
    value: { data: { title: 'Post' }, body: '# Post' },
  },
  'blog/no-body': {
    key: 'blog/no-body',
    file: 'src/content/blog/no-body.md',
    format: 'md',
    editable: true,
    buildTime: false,
    revision: 'r-nobody',
    value: { data: { title: 'Bare' } },
  },
  'data:src/config/menu.json': {
    key: 'data:src/config/menu.json',
    file: 'src/config/menu.json',
    format: 'json',
    editable: true,
    buildTime: true,
    revision: 'r-menu',
    value: { items: [] },
  },
  'data:src/config/rules.toml': {
    key: 'data:src/config/rules.toml',
    file: 'src/config/rules.toml',
    format: 'toml',
    editable: false,
    buildTime: true,
    buildTimeFields: ['rules.limit'],
    revision: 'r-rulestoml',
  },
};

interface SetupOptions {
  search?: string;
  /** The answer of `GET /api/preview-url`, in place of the working one; an Error makes the request fail. */
  preview?: Response | Error;
  /** The answer of `GET /api/overlay`, in place of an empty overlay. */
  overlay?: Response;
}

/** Starts the editor on a fake CMS API; resolves once its startup has run. */
async function setup({ search = '', preview, overlay }: SetupOptions = {}) {
  window.history.replaceState(null, '', `/${search}`);
  document.body.innerHTML = BODY;
  const iframe = document.getElementById(
    'preview',
  ) as unknown as HTMLIFrameElement;
  const child = { postMessage: vi.fn(), location: { reload: vi.fn() } };
  Object.defineProperty(iframe, 'contentWindow', {
    value: child,
    configurable: true,
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url === '/api/overlay')
      return overlay ?? Response.json({ documents: {}, media: {} });
    if (url.startsWith('/api/preview-url?path=')) {
      if (preview instanceof Error) throw preview;
      if (preview) return preview;
      const path = decodeURIComponent(
        url.slice('/api/preview-url?path='.length),
      );
      return Response.json({
        url: `${PREVIEW_ORIGIN}${path}?token=t`,
        origin: PREVIEW_ORIGIN,
      });
    }
    if (url.startsWith('/api/documents?key=')) {
      const key = decodeURIComponent(url.slice('/api/documents?key='.length));
      return key in DOCUMENTS
        ? Response.json(DOCUMENTS[key])
        : Response.json(
            { error: 'not-found', message: `Unknown document "${key}"` },
            { status: 404 },
          );
    }
    return new Response(null, { status: 404 });
  });
  await startEditor(window, fetch);

  // Messages come from the preview origin by default, as the bridge sends them.
  const fromPage = (
    data: unknown,
    source: unknown = child,
    origin = PREVIEW_ORIGIN,
  ) =>
    window.dispatchEvent(
      Object.assign(new Event('message'), { data, source, origin }),
    );
  const ready = (pagePath = '/blog') =>
    fromPage({
      type: 'preview:ready',
      path: pagePath,
      protocol: PROTOCOL_VERSION,
    });
  const rendered = (
    documents: string[],
    limits: string[] = [],
    pagePath = '/blog',
  ) =>
    fromPage({
      type: 'preview:rendered',
      path: pagePath,
      documents,
      limits,
      renderMs: 0.3,
    });
  const section = (key: string) =>
    document.querySelector<HTMLElement>(`[data-key="${key}"]`)!;
  const value = (key: string) =>
    section(key).querySelector<HTMLTextAreaElement>('[data-field="value"]')!;
  const body = (key: string) =>
    section(key).querySelector<HTMLTextAreaElement>('[data-field="body"]')!;
  const error = (key: string) =>
    section(key).querySelector<HTMLElement>('[data-slot="error"]')!;
  const status = () => document.getElementById('status')!;
  const drafts = () => child.postMessage.mock.calls.map(([message]) => message);
  const lastDraft = () => drafts().at(-1);
  /** Page read these documents: waits until their forms exist. */
  const open = async (...keys: string[]) => {
    rendered(keys);
    await vi.waitFor(() => {
      for (const key of keys) expect(section(key)).not.toBeNull();
    });
  };
  return {
    iframe,
    child,
    fetch,
    fromPage,
    ready,
    rendered,
    section,
    value,
    body,
    error,
    status,
    drafts,
    lastDraft,
    open,
  };
}

const type = (textarea: HTMLTextAreaElement, text: string) => {
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
};
const click = (root: Element, action: string) =>
  root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
/** Types, then lets the pause pass. */
const edit = (textarea: HTMLTextAreaElement, text: string) => {
  vi.useFakeTimers();
  try {
    type(textarea, text);
    vi.advanceTimersByTime(RENDER_DELAY_MS);
  } finally {
    vi.useRealTimers();
  }
};

let editor: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  editor = await setup();
});

describe('loading the page', () => {
  it('opens the preview for "/" and loads the URL it answers', () => {
    expect(editor.fetch).toHaveBeenCalledWith('/api/preview-url?path=%2F');
    expect(editor.iframe.src).toBe(`${PREVIEW_ORIGIN}/?token=t`);
  });

  it('opens the preview for ?page= when given', async () => {
    const other = await setup({ search: '?page=/servicios' });
    expect(other.fetch).toHaveBeenCalledWith(
      '/api/preview-url?path=%2Fservicios',
    );
    expect(other.iframe.src).toBe(`${PREVIEW_ORIGIN}/servicios?token=t`);
  });

  it.each([
    [400, 'invalid-path', 'path must start with /'],
    [503, 'preview-unavailable', 'the renderer is not running'],
  ])(
    'shows a refused preview (%i) with its message, and does not load the iframe',
    async (status, error, message) => {
      const refused = await setup({
        preview: Response.json({ error, message }, { status }),
      });
      expect(refused.status().textContent).toBe(message);
      expect(refused.status().dataset.state).toBe('error');
      expect(refused.iframe.src).toBeUndefined();
    },
  );

  it.each([
    ['a non-string url', { url: 1, origin: PREVIEW_ORIGIN }],
    ['a non-string origin', { url: `${PREVIEW_ORIGIN}/`, origin: null }],
    ['no origin', { url: `${PREVIEW_ORIGIN}/` }],
    ['an array', []],
    ['nothing', null],
  ])(
    'does not open the preview when its answer has %s, and says so',
    async (_, answer) => {
      const broken = await setup({ preview: Response.json(answer) });
      expect(broken.status().textContent).toBe(
        'Could not open the preview: the answer has the wrong shape',
      );
      expect(broken.status().dataset.state).toBe('error');
      expect(broken.iframe.src).toBeUndefined();
    },
  );

  it('says why the preview could not be asked for, when the request fails', async () => {
    const down = await setup({ preview: new TypeError('Failed to fetch') });
    expect(down.status().textContent).toBe(
      'Could not open the preview: Failed to fetch',
    );
    expect(down.status().dataset.state).toBe('error');
    expect(down.iframe.src).toBeUndefined();
  });
});

describe('protocol mismatch', () => {
  it.each([
    [
      'a different protocol',
      { type: 'preview:ready', path: '/blog', protocol: 1 },
    ],
    ['no protocol', { type: 'preview:ready', path: '/blog' }],
  ])('flags a ready with %s and sends no draft', async (_, message) => {
    const editor = await setup();
    editor.fromPage(message);
    expect(editor.status().dataset.state).toBe('error');
    expect(editor.status().textContent).toContain('protocol mismatch');
    expect(editor.drafts()).toHaveLength(0);
  });

  it('keeps sending nothing when you type after a mismatch, until a matching ready', async () => {
    await editor.open('authors/ana');
    editor.fromPage({ type: 'preview:ready', path: '/blog' });
    const before = editor.drafts().length;
    edit(editor.value('authors/ana'), '{"name":"Ana (draft)"}');
    click(editor.section('authors/ana'), 'delete');
    expect(editor.drafts()).toHaveLength(before);
    editor.ready();
    expect(editor.lastDraft().documents).toEqual({ 'authors/ana': null });
  });
});

describe('on preview:ready', () => {
  it('sends an empty overlay, which primes the page, and makes no call of its own', () => {
    editor.ready();
    expect(editor.status().textContent).toBe('Page ready: /blog');
    expect(editor.drafts()).toEqual([
      {
        type: 'preview:draft',
        protocol: PROTOCOL_VERSION,
        documents: {},
        media: {},
      },
    ]);
    expect(editor.child.postMessage).toHaveBeenCalledWith(
      expect.anything(),
      PREVIEW_ORIGIN,
    );
    // The server warms the renderer when it answers the preview URL, so the
    // browser calls nothing else.
    expect(editor.fetch.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/overlay',
      '/api/preview-url?path=%2F',
    ]);
  });

  it('ignores a ready from an origin other than the preview', () => {
    editor.fromPage(
      { type: 'preview:ready', path: '/blog', protocol: PROTOCOL_VERSION },
      editor.child,
      window.location.origin,
    );
    expect(editor.status().textContent).toBe('Waiting for the page…');
    expect(editor.drafts()).toHaveLength(0);
  });

  it.each([
    [
      'a refusal',
      () =>
        Response.json(
          { error: 'store-locked', message: 'the store is locked' },
          { status: 503 },
        ),
      'Could not load the overlay (503): the store is locked',
    ],
    [
      'a wrong shape',
      () => Response.json({ documents: 'none' }),
      'Could not load the overlay: the answer has the wrong shape',
    ],
    [
      'an array',
      () => Response.json([]),
      'Could not load the overlay: the answer has the wrong shape',
    ],
    [
      'a documents map that is not one',
      () => Response.json({ documents: 'none', media: {} }),
      'Could not load the overlay: the answer has the wrong shape',
    ],
    [
      'a media map that is not one',
      () => Response.json({ documents: {}, media: [] }),
      'Could not load the overlay: the answer has the wrong shape',
    ],
    [
      'no media map',
      () => Response.json({ documents: {} }),
      'Could not load the overlay: the answer has the wrong shape',
    ],
  ])(
    'shows %s of the overlay, and starts without it',
    async (_, answer, message) => {
      const without = await setup({ overlay: answer() });
      expect(without.status().textContent).toBe(message);
      expect(without.status().dataset.state).toBe('error');
      without.ready();
      expect(without.lastDraft().documents).toEqual({});
      // The refusal stays in the status line after the page's first ready.
      expect(without.status().textContent).toBe(
        `${message}. Page ready: /blog`,
      );
      expect(without.status().dataset.state).toBe('error');
      // The priming draft renders at once, so the refusal stays after a render too.
      without.rendered([]);
      expect(without.status().textContent).toBe(
        `${message}. Rendered /blog in 0.3 ms; documents: none`,
      );
      expect(without.status().dataset.state).toBe('error');
    },
  );

  it('after a navigation, re-primes with the same overlay', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana (draft)"}');
    editor.ready('/faq');
    expect(editor.lastDraft().documents).toEqual({
      'authors/ana': { name: 'Ana (draft)' },
    });
  });
});

describe('the starting overlay', () => {
  it('sends the overlay with the drafts on top of it: an edit wins, the rest stays', async () => {
    const withOverlay = await setup({
      overlay: Response.json({
        documents: {
          'authors/ana': { name: 'From the CMS' },
          'blog/blog-1': null,
        },
        media: {},
      }),
    });
    withOverlay.ready();
    expect(withOverlay.lastDraft().documents).toEqual({
      'authors/ana': { name: 'From the CMS' },
      'blog/blog-1': null,
    });
    await withOverlay.open('authors/ana');
    edit(withOverlay.value('authors/ana'), '{"name":"Ana (draft)"}');
    expect(withOverlay.lastDraft().documents).toEqual({
      'authors/ana': { name: 'Ana (draft)' },
      'blog/blog-1': null,
    });
  });
});

describe('loading documents', () => {
  it('fetches each document the page read, once', async () => {
    await editor.open('authors/ana', 'blog/blog-1');
    editor.rendered(['authors/ana', 'blog/blog-1']);
    const fetched = editor.fetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith('/api/documents'));
    expect(fetched).toEqual([
      '/api/documents?key=authors%2Fana',
      '/api/documents?key=blog%2Fblog-1',
    ]);
  });

  it('shows a JSON document in one textbox', async () => {
    await editor.open('authors/ana');
    expect(JSON.parse(editor.value('authors/ana').value)).toEqual({
      name: 'Ana',
      links: [],
    });
    expect(
      editor.section('authors/ana').querySelector('[data-slot="file"]')!
        .textContent,
    ).toBe('src/content/authors/ana.json (json)');
    expect(editor.body('authors/ana').closest('label')!.hidden).toBe(true);
  });

  it('shows a Markdown document as frontmatter JSON and a body', async () => {
    await editor.open('blog/blog-1');
    expect(JSON.parse(editor.value('blog/blog-1').value)).toEqual({
      title: 'One',
      draft: false,
    });
    expect(editor.body('blog/blog-1').value).toBe('Hello *world*');
    expect(editor.body('blog/blog-1').closest('label')!.hidden).toBe(false);
  });

  it('lists a read-only document as built, without a textbox, and never sends it', async () => {
    await editor.open('rules/one');
    expect(
      editor
        .section('rules/one')
        .querySelector('textarea')!
        .closest('[data-slot="fields"]'),
    ).toHaveProperty('hidden', true);
    expect(editor.section('rules/one').textContent).toContain('Shown as built');
    editor.ready();
    expect(editor.lastDraft().documents).toEqual({});
  });

  it('treats an editable document without a value as a failed load, not as {}', async () => {
    await editor.open('broken/no-value');
    expect(
      editor.section('broken/no-value').querySelector('[data-slot="note"]')!
        .textContent,
    ).toBe('Could not load: the answer has the wrong shape');
    expect(
      editor
        .section('broken/no-value')
        .querySelector('textarea')!
        .closest('[data-slot="fields"]'),
    ).toHaveProperty('hidden', true);
  });

  it('treats a Markdown document whose value is null as a failed load, not as a crash', async () => {
    await editor.open('broken/null-markdown');
    expect(
      editor
        .section('broken/null-markdown')
        .querySelector('[data-slot="note"]')!.textContent,
    ).toBe('Could not load: the answer has the wrong shape');
  });

  it('says why a document could not be loaded, and does not retry it', async () => {
    await editor.open('missing/one');
    expect(
      editor.section('missing/one').querySelector('[data-slot="note"]')!
        .textContent,
    ).toBe('Could not load (404): Unknown document "missing/one"');
    expect(
      editor
        .section('missing/one')
        .querySelector('textarea')!
        .closest('[data-slot="fields"]'),
    ).toHaveProperty('hidden', true);
    editor.rendered(['missing/one']);
    expect(
      editor.fetch.mock.calls.filter(([url]) =>
        String(url).includes('missing'),
      ),
    ).toHaveLength(1);
  });

  it('says so when the request itself fails', async () => {
    editor.fetch.mockRejectedValueOnce(new Error('offline'));
    await editor.open('authors/ana');
    expect(
      editor.section('authors/ana').querySelector('[data-slot="note"]')!
        .textContent,
    ).toBe('Could not load: offline');
  });

  it('shows the forms of the latest render only, and keeps edits of the others', async () => {
    await editor.open('authors/ana', 'blog/blog-1');
    edit(editor.value('authors/ana'), '{"name":"Ana (draft)"}');
    editor.rendered(['blog/blog-1'], [], '/blog');
    expect(editor.section('authors/ana').hidden).toBe(true);
    expect(editor.section('blog/blog-1').hidden).toBe(false);
    edit(editor.value('blog/blog-1'), '{"title":"Two"}');
    expect(editor.lastDraft().documents).toEqual({
      'authors/ana': { name: 'Ana (draft)' },
      'blog/blog-1': { data: { title: 'Two' }, body: 'Hello *world*' },
    });
    editor.rendered(['authors/ana']);
    expect(editor.section('authors/ana').hidden).toBe(false);
  });

  it('hides the form of a document that finishes loading after the page moved on', async () => {
    editor.rendered(['authors/ana', 'blog/blog-1']);
    editor.rendered(['blog/blog-1'], [], '/blog/page/2');
    await vi.waitFor(() =>
      expect(editor.section('blog/blog-1')).not.toBeNull(),
    );
    await vi.waitFor(() =>
      expect(editor.section('authors/ana')).not.toBeNull(),
    );
    expect(editor.section('authors/ana').hidden).toBe(true);
    expect(editor.section('blog/blog-1').hidden).toBe(false);
  });

  it('warns about build-time fields', async () => {
    expect(buildTimeNote({ buildTime: false })).toBe('');
    expect(buildTimeNote({ buildTime: true, buildTimeFields: ['*'] })).toBe(
      'Some fields apply after rebuild: the whole file',
    );
    await editor.open(
      'data:src/config/config.json',
      'data:src/config/theme.json',
      'authors/ana',
    );
    expect(editor.section('data:src/config/config.json').textContent).toContain(
      'Some fields apply after rebuild: site.base_url, site.title',
    );
    expect(editor.section('data:src/config/theme.json').textContent).toContain(
      'Some fields apply after rebuild: the whole file',
    );
    expect(editor.section('authors/ana').textContent).not.toContain('rebuild');
  });
});

describe('editing', () => {
  it(`sends the draft ${RENDER_DELAY_MS} ms after the last keystroke`, async () => {
    await editor.open('authors/ana');
    vi.useFakeTimers();
    try {
      type(editor.value('authors/ana'), '{"name":"A"}');
      type(editor.value('authors/ana'), '{"name":"B"}');
      vi.advanceTimersByTime(RENDER_DELAY_MS - 1);
      expect(editor.drafts()).toHaveLength(0);
      vi.advanceTimersByTime(1);
    } finally {
      vi.useRealTimers();
    }
    expect(editor.drafts()).toEqual([
      {
        type: 'preview:draft',
        protocol: PROTOCOL_VERSION,
        documents: { 'authors/ana': { name: 'B' } },
        media: {},
      },
    ]);
  });

  it('sends a document edited only in its body as { data, body }', async () => {
    await editor.open('blog/blog-1');
    edit(editor.body('blog/blog-1'), 'Changed');
    expect(editor.lastDraft().documents).toEqual({
      'blog/blog-1': { data: { title: 'One', draft: false }, body: 'Changed' },
    });
  });

  it('leaves untouched documents out of the overlay', async () => {
    await editor.open('authors/ana', 'blog/blog-1');
    edit(editor.value('authors/ana'), '{"name":"A"}');
    expect(Object.keys(editor.lastDraft().documents)).toEqual(['authors/ana']);
  });

  it('flags invalid JSON, leaves that document out and still sends the others', async () => {
    await editor.open('authors/ana', 'blog/blog-1');
    edit(editor.value('authors/ana'), '{"name":');
    expect(editor.value('authors/ana').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(editor.error('authors/ana').textContent).not.toBe('');
    expect(editor.lastDraft().documents).toEqual({});

    edit(editor.body('blog/blog-1'), 'Changed');
    expect(Object.keys(editor.lastDraft().documents)).toEqual(['blog/blog-1']);

    edit(editor.value('authors/ana'), '{"name":"Fixed"}');
    expect(editor.value('authors/ana').hasAttribute('aria-invalid')).toBe(
      false,
    );
    expect(editor.error('authors/ana').textContent).toBe('');
    expect(editor.lastDraft().documents['authors/ana']).toEqual({
      name: 'Fixed',
    });
  });

  it('keeps the last overlay sent in a read-only view', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"A"}');
    expect(
      JSON.parse(document.getElementById('envelope')!.textContent!),
    ).toEqual({ documents: { 'authors/ana': { name: 'A' } }, media: {} });
  });
});

describe('reset and delete', () => {
  it('"Reset" restores the saved text and takes the document out of the overlay, without sending null', async () => {
    await editor.open('blog/blog-1');
    edit(editor.value('blog/blog-1'), '{"title":"Two"}');
    edit(editor.body('blog/blog-1'), 'Changed');
    click(editor.section('blog/blog-1'), 'reset');
    expect(JSON.parse(editor.value('blog/blog-1').value)).toEqual({
      title: 'One',
      draft: false,
    });
    expect(editor.body('blog/blog-1').value).toBe('Hello *world*');
    expect(editor.lastDraft().documents).toEqual({});
    expect(editor.child.location.reload).not.toHaveBeenCalled();
  });

  it('"Reset" clears an invalid-JSON flag', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{');
    click(editor.section('authors/ana'), 'reset');
    expect(editor.value('authors/ana').hasAttribute('aria-invalid')).toBe(
      false,
    );
    expect(editor.error('authors/ana').textContent).toBe('');
  });

  it('"Delete in draft" sends null, and typing again brings the document back', async () => {
    await editor.open('authors/ana', 'blog/blog-1');
    click(editor.section('authors/ana'), 'delete');
    expect(editor.lastDraft().documents).toEqual({ 'authors/ana': null });
    edit(editor.value('authors/ana'), '{"name":"Back"}');
    expect(editor.lastDraft().documents).toEqual({
      'authors/ana': { name: 'Back' },
    });
    click(editor.section('authors/ana'), 'delete');
    click(editor.section('authors/ana'), 'reset');
    expect(editor.lastDraft().documents).toEqual({});
  });
});

describe('status messages from the page', () => {
  it('shows what a render read', () => {
    editor.rendered(['blog/a', 'authors/b'], ['code-language:cpp']);
    expect(editor.status().textContent).toBe(
      'Rendered /blog in 0.3 ms; documents: blog/a, authors/b',
    );
    editor.rendered([]);
    expect(editor.status().textContent).toBe(
      'Rendered /blog in 0.3 ms; documents: none',
    );
  });

  it('shows each limit as a note and clears them on the next render', () => {
    editor.rendered(
      [],
      [
        'mdx-body',
        'schema-refinement',
        'markdown-plugins',
        'code-language:cpp',
        'something-new',
      ],
    );
    const notes = () =>
      [...document.querySelectorAll('#limits li')].map((li) => li.textContent);
    expect(notes()).toEqual([
      'MDX body: preview after save',
      'a schema refinement could not run',
      'Markdown plugins failed, shown without them',
      '`cpp` highlighted after publish',
      'something-new',
    ]);
    expect(document.getElementById('limits')!.hidden).toBe(false);
    editor.rendered([]);
    expect(notes()).toEqual([]);
    expect(document.getElementById('limits')!.hidden).toBe(true);
    expect(limitNote('mdx-body')).toBe('MDX body: preview after save');
  });

  it('shows a failed render in the status line', () => {
    editor.fromPage({
      type: 'preview:error',
      path: '/blog',
      status: 500,
      message: 'boom',
    });
    expect(editor.status().textContent).toBe('/blog failed (500): boom');
    expect(editor.status().dataset.state).toBe('error');
  });

  it('shows a 422 next to the matching document, and the rest in the status line', async () => {
    await editor.open('authors/ana');
    editor.fromPage({
      type: 'preview:error',
      path: '/blog',
      status: 422,
      message: 'invalid',
      errors: [
        {
          key: 'authors/ana',
          path: ['links', 0, 'url'],
          message: 'Invalid url',
        },
        { key: 'authors/ana', path: ['name'], message: 'Required' },
        { key: 'blog/other', path: ['title'], message: 'Required' },
      ],
    });
    expect(editor.error('authors/ana').textContent).toBe(
      'links.0.url: Invalid url; name: Required',
    );
    expect(editor.status().textContent).toBe(
      '/blog failed (422): invalid (blog/other title: Required)',
    );
  });

  it('clears the field errors when the next draft goes out', async () => {
    await editor.open('authors/ana');
    editor.fromPage({
      type: 'preview:error',
      path: '/blog',
      status: 422,
      message: 'invalid',
      errors: [{ key: 'authors/ana', path: ['name'], message: 'Required' }],
    });
    edit(editor.value('authors/ana'), '{"name":"A"}');
    expect(editor.error('authors/ana').textContent).toBe('');
  });

  it('shows a network failure (status 0)', () => {
    editor.fromPage({
      type: 'preview:error',
      path: '/blog',
      status: 0,
      message: 'Failed to fetch',
    });
    expect(editor.status().textContent).toBe(
      '/blog failed (0): Failed to fetch',
    );
  });

  it('ignores messages from other windows and unknown messages', () => {
    const before = editor.status().textContent;
    editor.fromPage(
      {
        type: 'preview:rendered',
        path: '/',
        documents: [],
        limits: [],
        renderMs: 1,
      },
      {},
    );
    editor.fromPage({ type: 'pageNavigation', path: '/' });
    editor.fromPage({ type: 'preview:ready', regions: ['blocks'] }); // protocol v1
    expect(editor.status().textContent).toBe(before);
    expect(editor.drafts()).toHaveLength(0);
  });
});

describe('draft image upload', () => {
  /** What POST /api/media answers (PHASE-2-DESIGN 5.9). */
  const entry = {
    id: '0123456789abcdef',
    url: '/__preview-media/0123456789abcdef.png',
    width: 10,
    height: 20,
    format: 'png',
  };
  /** The media entry the editor keeps: the answer without its id. */
  const stored = { url: entry.url, width: 10, height: 20, format: 'png' };
  const choose = (file: File) => {
    const input = document.getElementById('upload') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
  };
  const upload = async (name = 'retrato.png') => {
    editor.fetch.mockResolvedValueOnce(Response.json(entry, { status: 201 }));
    const file = new File([new Uint8Array([1, 2, 3])], name, {
      type: 'image/png',
    });
    choose(file);
    await vi.waitFor(() =>
      expect(document.getElementById('upload-result')!.hidden).toBe(false),
    );
    return file;
  };

  it('uploads the file and shows the URL to put in the document', async () => {
    const file = await upload();
    expect(document.getElementById('upload-url')!.textContent).toBe(entry.url);
    expect(editor.fetch).toHaveBeenCalledWith('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: file,
    });
    expect(editor.status().textContent).toBe('Uploaded retrato.png');
  });

  it('adds the entry to the media map under its url and sends it with every draft', async () => {
    await editor.open('authors/ana');
    await upload();
    expect(editor.lastDraft().media).toEqual({ [entry.url]: stored });
    edit(editor.value('authors/ana'), '{"name":"A"}');
    expect(editor.lastDraft()).toEqual({
      type: 'preview:draft',
      protocol: PROTOCOL_VERSION,
      documents: { 'authors/ana': { name: 'A' } },
      media: { [entry.url]: stored },
    });
    editor.ready();
    expect(editor.lastDraft().media).toEqual({ [entry.url]: stored });
  });

  it("merges the media maps, the draft's entry winning", async () => {
    const kept = {
      url: 'src/assets/uploads/kept.png',
      width: 3,
      height: 4,
      format: 'png',
    };
    editor = await setup({
      overlay: Response.json({
        documents: {},
        media: {
          [kept.url]: kept,
          [entry.url]: { ...stored, width: 1 },
        },
      }),
    });
    await upload();
    expect(editor.lastDraft().media).toEqual({
      [kept.url]: kept,
      [entry.url]: stored,
    });
  });

  it.each([
    ['the request fails', () => new Error('offline'), 'Upload failed: offline'],
    [
      'the answer has the wrong shape',
      () => Response.json({ url: 5 }, { status: 201 }),
      'Upload failed: the answer has the wrong shape',
    ],
    [
      'the width is not a number',
      () => Response.json({ ...entry, width: '10' }, { status: 201 }),
      'Upload failed: the answer has the wrong shape',
    ],
    [
      'the height is missing',
      () =>
        Response.json(
          { id: entry.id, url: entry.url, width: 10, format: 'png' },
          { status: 201 },
        ),
      'Upload failed: the answer has the wrong shape',
    ],
    [
      'the format is not a string',
      () => Response.json({ ...entry, format: 1 }, { status: 201 }),
      'Upload failed: the answer has the wrong shape',
    ],
    [
      'the url is not a string',
      () => Response.json({ ...entry, url: 5 }, { status: 201 }),
      'Upload failed: the answer has the wrong shape',
    ],
    [
      'the answer is not an object',
      () => Response.json([], { status: 201 }),
      'Upload failed: the answer has the wrong shape',
    ],
  ])(
    'shows an upload where %s, and sends nothing',
    async (_, answer, message) => {
      const failure = answer();
      if (failure instanceof Error) editor.fetch.mockRejectedValueOnce(failure);
      else editor.fetch.mockResolvedValueOnce(failure);
      choose(
        new File([new Uint8Array([1])], 'retrato.png', { type: 'image/png' }),
      );
      await vi.waitFor(() => expect(editor.status().textContent).toBe(message));
      expect(editor.status().dataset.state).toBe('error');
      expect(document.getElementById('upload-result')!.hidden).toBe(true);
      expect(editor.drafts()).toHaveLength(0);
    },
  );

  it('shows a failed upload and sends nothing', async () => {
    editor.fetch.mockResolvedValueOnce(
      new Response('Supported types: image/png', { status: 415 }),
    );
    choose(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe(
        'Upload failed (415): Supported types: image/png',
      ),
    );
    expect(document.getElementById('upload-result')!.hidden).toBe(true);
    expect(editor.drafts()).toHaveLength(0);
  });

  it('does not send a draft before the preview is open', async () => {
    editor = await setup({
      preview: Response.json(
        {
          error: 'preview-unavailable',
          message: 'the renderer is not running',
        },
        { status: 503 },
      ),
    });
    editor.fetch.mockResolvedValueOnce(Response.json(entry, { status: 201 }));
    choose(
      new File([new Uint8Array([1])], 'retrato.png', { type: 'image/png' }),
    );
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe('Uploaded retrato.png'),
    );
    expect(editor.drafts()).toHaveLength(0);
  });

  it('uploads even when the preview window is not there yet', async () => {
    Object.defineProperty(editor.iframe, 'contentWindow', {
      value: null,
      configurable: true,
    });
    await upload();
    expect(editor.status().textContent).toBe('Uploaded retrato.png');
    expect(editor.status().dataset.state).toBe('ok');
  });

  it('does nothing when the file dialog gives no file', () => {
    editor.ready();
    const before = editor.status().textContent;
    const input = document.getElementById('upload') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(editor.fetch).not.toHaveBeenCalledWith(
      '/api/media',
      expect.anything(),
    );
    expect(editor.status().textContent).toBe(before);
  });

  it('shows a failed upload as an error, with the text of its answer trimmed', async () => {
    editor.fetch.mockResolvedValueOnce(
      new Response('  Too big\n', { status: 413 }),
    );
    choose(new File([new Uint8Array([1])], 'big.png', { type: 'image/png' }));
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe('Upload failed (413): Too big'),
    );
    expect(editor.status().dataset.state).toBe('error');
  });

  it('does nothing when the browser has no clipboard API', () => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    const onError = vi.fn();
    window.addEventListener('error', onError);
    try {
      document.getElementById('upload-copy')!.click();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  it('copies the URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    document.getElementById('upload-url')!.textContent =
      '/__preview-media/x.png';
    document.getElementById('upload-copy')!.click();
    expect(writeText).toHaveBeenCalledWith('/__preview-media/x.png');
  });
});

describe('the shape of a document answer', () => {
  /** A document the page can read, with one field changed in each case. */
  const valid = {
    key: 'bad/doc',
    file: 'src/content/bad.json',
    format: 'json',
    editable: true,
    buildTime: false,
    revision: 'r-bad',
    value: {},
  };
  const noteOf = (key: string) =>
    editor.section(key).querySelector<HTMLElement>('[data-slot="note"]')!
      .textContent;
  const refused = 'Could not load: the answer has the wrong shape';

  it.each([
    ['key', { key: 1 }],
    ['file', { file: 1 }],
    ['format', { format: 1 }],
    ['editable', { editable: 'yes' }],
    ['buildTime', { buildTime: 'no' }],
    ['revision', { revision: 1 }],
    ['buildTimeFields', { buildTimeFields: 'site.title' }],
  ])('refuses a document whose %s has the wrong type', async (_, change) => {
    editor.fetch.mockResolvedValueOnce(Response.json({ ...valid, ...change }));
    await editor.open('bad/doc');
    expect(noteOf('bad/doc')).toBe(refused);
  });

  it.each([
    ['an array', []],
    ['a string', 'text'],
    ['a number', 42],
    ['null', null],
  ])('refuses a document that is %s', async (_, body) => {
    editor.fetch.mockResolvedValueOnce(Response.json(body));
    await editor.open('bad/doc');
    expect(noteOf('bad/doc')).toBe(refused);
  });

  it.each([
    ['md', 'text'],
    ['md', 42],
    ['mdx', 'text'],
    ['mdx', 42],
  ])(
    'refuses a %s document whose value is not an object (%j)',
    async (format, value) => {
      editor.fetch.mockResolvedValueOnce(
        Response.json({ ...valid, format, value }),
      );
      await editor.open('bad/doc');
      expect(noteOf('bad/doc')).toBe(refused);
    },
  );

  it.each([
    [42, '42'],
    ['text', '"text"'],
    [[], '[]'],
  ])(
    'shows a JSON document whose value is %j in its textbox',
    async (value, text) => {
      editor.fetch.mockResolvedValueOnce(Response.json({ ...valid, value }));
      await editor.open('bad/doc');
      expect(noteOf('bad/doc')).toBe('');
      expect(editor.value('bad/doc').value).toBe(text);
    },
  );

  it('says what a failed answer is when its JSON has no message', async () => {
    editor.fetch.mockResolvedValueOnce(
      Response.json({ error: 'not-found' }, { status: 404 }),
    );
    await editor.open('ghost/doc');
    expect(noteOf('ghost/doc')).toBe(
      'Could not load (404): {"error":"not-found"}',
    );
  });
});

describe('the form of each kind of document', () => {
  const noteEl = (key: string) =>
    editor.section(key).querySelector<HTMLElement>('[data-slot="note"]')!;
  const slotEl = (key: string, name: string) =>
    editor.section(key).querySelector<HTMLElement>(`[data-slot="${name}"]`)!;

  it('shows a plain JSON document with no note, and its labels', async () => {
    await editor.open('authors/ana');
    expect(noteEl('authors/ana').hidden).toBe(true);
    expect(noteEl('authors/ana').textContent).toBe('');
    expect(noteEl('authors/ana').dataset.state).toBeUndefined();
    expect(slotEl('authors/ana', 'file').textContent).toBe(
      'src/content/authors/ana.json (json)',
    );
    expect(editor.value('authors/ana').getAttribute('aria-label')).toBe(
      'authors/ana (JSON)',
    );
    expect(slotEl('authors/ana', 'body-field').hidden).toBe(true);
  });

  it.each([
    ['blog/blog-1', { title: 'One', draft: false }, 'Hello *world*'],
    ['blog/post', { title: 'Post' }, '# Post'],
    ['blog/no-body', { title: 'Bare' }, ''],
  ])(
    'shows the frontmatter and body of %s in their own textboxes',
    async (key, data, body) => {
      await editor.open(key);
      expect(editor.value(key).value).toBe(JSON.stringify(data, null, 2));
      expect(editor.value(key).getAttribute('aria-label')).toBe(
        `${key} frontmatter (JSON)`,
      );
      expect(slotEl(key, 'value-label').textContent).toBe('Frontmatter (JSON)');
      expect(slotEl(key, 'body-field').hidden).toBe(false);
      expect(editor.body(key).value).toBe(body);
      expect(editor.body(key).getAttribute('aria-label')).toBe(`${key} body`);
    },
  );

  it('shows the build-time note of a document, and "the whole file" when it names no field', async () => {
    await editor.open(
      'data:src/config/config.json',
      'data:src/config/menu.json',
    );
    expect(noteEl('data:src/config/config.json').hidden).toBe(false);
    expect(noteEl('data:src/config/config.json').textContent).toBe(
      'Some fields apply after rebuild: site.base_url, site.title',
    );
    expect(noteEl('data:src/config/menu.json').textContent).toBe(
      'Some fields apply after rebuild: the whole file',
    );
  });

  it('joins the notes of a read-only document with ". ", and hides its fields', async () => {
    await editor.open('data:src/config/rules.toml', 'rules/one');
    expect(noteEl('data:src/config/rules.toml').textContent).toBe(
      'Some fields apply after rebuild: rules.limit. Shown as built (this format is not edited here)',
    );
    expect(noteEl('rules/one').hidden).toBe(false);
    expect(noteEl('rules/one').textContent).toBe(
      'Shown as built (this format is not edited here)',
    );
    expect(slotEl('rules/one', 'fields').hidden).toBe(true);
  });

  it('gives a failed load a note in the error state, and no file name', async () => {
    await editor.open('nope/missing');
    expect(noteEl('nope/missing').textContent).toBe(
      'Could not load (404): Unknown document "nope/missing"',
    );
    expect(noteEl('nope/missing').hidden).toBe(false);
    expect(noteEl('nope/missing').dataset.state).toBe('error');
    expect(slotEl('nope/missing', 'file').textContent).toBe('');
  });
});

describe('the status line', () => {
  it('marks the page as ready in the ok state', () => {
    editor.ready('/blog');
    expect(editor.status().textContent).toBe('Page ready: /blog');
    expect(editor.status().dataset.state).toBe('ok');
  });

  it('lists several 422 errors that have no form, joined with "; "', async () => {
    await editor.open('authors/ana');
    editor.fromPage({
      type: 'preview:error',
      path: '/blog',
      status: 422,
      message: 'invalid',
      errors: [
        {
          key: 'blog/other',
          path: ['links', 0, 'url'],
          message: 'Invalid url',
        },
        { key: 'blog/more', path: ['title'], message: 'Required' },
      ],
    });
    expect(editor.status().textContent).toBe(
      '/blog failed (422): invalid (blog/other links.0.url: Invalid url; blog/more title: Required)',
    );
  });
});

describe('saving', () => {
  const section = (key: string) => editor.section(key);
  const value = (key: string) => editor.value(key);
  const bundle = (bundleId: string) =>
    Response.json({ bundle: { bundleId, siteCommit: null } });
  const saveButton = () => document.getElementById('save') as HTMLButtonElement;
  const saves = () =>
    editor.fetch.mock.calls.filter(
      ([url, init]) => url === '/api/changes' && init?.method === 'PUT',
    );
  const previewRequests = () =>
    editor.fetch.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/preview-url'),
    ).length;
  const saveErrorOf = (key: string) =>
    section(key).querySelector<HTMLElement>('[data-slot="save-error"]')!;
  const conflictOf = (key: string) =>
    section(key).querySelector<HTMLElement>('[data-slot="conflict"]')!;

  /** Answers the save's requests: the PUTs and the status requests in turn, a re-read of a document, and the list. Other calls go to the setup's fake API. */
  function routeSave(options: {
    puts: Response[];
    statuses?: Response[];
    reread?: (key: string) => Response;
    changes?: Response;
  }) {
    const base = editor.fetch.getMockImplementation();
    const puts = [...options.puts];
    const statuses = [...(options.statuses ?? [])];
    editor.fetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/changes' && init?.method === 'PUT')
        return puts.shift() ?? new Response(null, { status: 500 });
      if (url === '/api/status') return statuses.shift() ?? bundle('b1');
      if (url === '/api/changes')
        return (
          options.changes ??
          Response.json({
            documents: [
              { key: 'authors/ana', status: 'modified', baseRevision: 'r-ana' },
            ],
            createdRecords: [],
            fileErrors: [],
          })
        );
      if (url.startsWith('/api/documents?key=') && options.reread)
        return options.reread(
          decodeURIComponent(url.slice('/api/documents?key='.length)),
        );
      return base!(input, init);
    });
  }

  const saved = (revision: string, extra: object = {}) =>
    Response.json({
      revisions: { 'authors/ana': revision },
      warnings: [],
      rebuild: false,
      ...extra,
    });
  const conflict = (revision: string) =>
    Response.json(
      {
        error: 'conflict',
        documents: [
          { key: 'authors/ana', revision, value: { name: 'Ana (theirs)' } },
        ],
      },
      { status: 409 },
    );

  it('"Save" sends each edited document with the revision it was read at', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({ puts: [saved('r-ana-2')] });
    saveButton().click();
    await vi.waitFor(() => expect(saves()).toHaveLength(1));
    expect(JSON.parse(String(saves()[0]?.[1]?.body))).toEqual({
      changes: [
        {
          document: 'authors/ana',
          baseRevision: 'r-ana',
          data: { name: 'Ana M', links: [] },
        },
      ],
    });
    await vi.waitFor(() =>
      expect(document.querySelector('#changes-list')!.textContent).toBe(
        'modified: authors/ana',
      ),
    );
    expect(editor.status().textContent).toBe('Saved.');
  });

  it('"Save" sends a deleted document as deleted', async () => {
    await editor.open('authors/ana');
    click(section('authors/ana'), 'delete');
    routeSave({
      puts: [
        Response.json(
          { error: 'save-failed', message: 'git refused' },
          { status: 500 },
        ),
      ],
    });
    saveButton().click();
    await vi.waitFor(() => expect(saves()).toHaveLength(1));
    expect(JSON.parse(String(saves()[0]?.[1]?.body))).toEqual({
      changes: [
        { document: 'authors/ana', baseRevision: 'r-ana', deleted: true },
      ],
    });
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe(
        'The save failed, and nothing was kept. Try again.',
      ),
    );
  });

  it('"Save" sends nothing when no form differs from its saved text', async () => {
    await editor.open('authors/ana');
    saveButton().click();
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe('Nothing to save'),
    );
    expect(saves()).toHaveLength(0);
  });

  it('"Save" sends nothing while a form holds invalid JSON', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":');
    saveButton().click();
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe(
        'Fix the invalid JSON before you save',
      ),
    );
    expect(saves()).toHaveLength(0);
  });

  it('a 409 conflict shows the document\'s controls, and "Reload" takes the saved version', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [conflict('r-ana-3')],
      reread: () =>
        Response.json({
          key: 'authors/ana',
          format: 'json',
          editable: true,
          buildTime: false,
          revision: 'r-ana-3',
          value: { name: 'Ana (theirs)' },
        }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(conflictOf('authors/ana').hidden).toBe(false),
    );
    expect(saveErrorOf('authors/ana').textContent).toBe(
      'Changed since you opened it. Reload to take the saved version, or keep yours.',
    );
    click(section('authors/ana'), 'reload');
    await vi.waitFor(() =>
      expect(value('authors/ana').value).toBe(
        JSON.stringify({ name: 'Ana (theirs)' }, null, 2),
      ),
    );
    expect(conflictOf('authors/ana').hidden).toBe(true);
    expect(saveErrorOf('authors/ana').textContent).toBe('');
  });

  it('"Reload" says so when the document cannot be read again', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [conflict('r-ana-3')],
      reread: () => new Response('busy', { status: 503 }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(conflictOf('authors/ana').hidden).toBe(false),
    );
    click(section('authors/ana'), 'reload');
    await vi.waitFor(() =>
      expect(saveErrorOf('authors/ana').textContent).toBe(
        'Could not reload (503): busy',
      ),
    );
  });

  it('"Keep mine" makes the next save based on the newer revision', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({ puts: [conflict('r-ana-3'), saved('r-ana-4')] });
    saveButton().click();
    await vi.waitFor(() =>
      expect(conflictOf('authors/ana').hidden).toBe(false),
    );
    click(section('authors/ana'), 'keep');
    expect(conflictOf('authors/ana').hidden).toBe(true);
    expect(saveErrorOf('authors/ana').textContent).toBe(
      'Your version is kept. Save again to overwrite the newer one.',
    );
    saveButton().click();
    await vi.waitFor(() => expect(saves()).toHaveLength(2));
    expect(JSON.parse(String(saves()[1]?.[1]?.body))).toEqual({
      changes: [
        {
          document: 'authors/ana',
          baseRevision: 'r-ana-3',
          data: { name: 'Ana M', links: [] },
        },
      ],
    });
  });

  it('"Keep mine" changes nothing when there is no conflict', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({ puts: [] });
    click(section('authors/ana'), 'keep');
    expect(saveErrorOf('authors/ana').textContent).toBe('');
    saveButton().click();
    await vi.waitFor(() => expect(saves()).toHaveLength(1));
    expect(
      JSON.parse(String(saves()[0]?.[1]?.body)).changes[0].baseRevision,
    ).toBe('r-ana');
  });

  it('a 422 shows next to its document, with the path of the field', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [
        Response.json(
          {
            error: 'invalid',
            errors: [
              { key: 'authors/ana', path: ['name'], message: 'Required' },
            ],
          },
          { status: 422 },
        ),
      ],
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(saveErrorOf('authors/ana').textContent).toBe('name: Required'),
    );
    expect(
      section('authors/ana').querySelector<HTMLElement>('[data-slot="error"]')!
        .textContent,
    ).toBe('');
  });

  it('a warning shows next to its document, and the save is still made', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [
        saved('r-ana-2', {
          warnings: [
            {
              key: 'authors/ana',
              path: ['photo'],
              code: 'public-image-missing',
            },
          ],
        }),
      ],
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(saveErrorOf('authors/ana').textContent).toBe(
        'photo: An image this document uses is not in the public folder',
      ),
    );
    expect(editor.status().textContent).toBe('Saved.');
  });

  it('after a save, a staged image of the form takes the path the save wrote', async () => {
    const input = document.getElementById('upload') as HTMLInputElement;
    editor.fetch.mockResolvedValueOnce(
      Response.json(
        {
          id: 'm1',
          url: '/media/staging/m1.png',
          width: 2,
          height: 3,
          format: 'png',
        },
        { status: 201 },
      ),
    );
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([1])], 'm1.png', { type: 'image/png' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe('Uploaded m1.png'),
    );

    await editor.open('authors/ana');
    edit(
      editor.value('authors/ana'),
      '{"name":"Ana","links":[],"photo":"/media/staging/m1.png"}',
    );
    routeSave({
      puts: [saved('r-ana-2')],
      reread: () =>
        Response.json({
          key: 'authors/ana',
          format: 'json',
          editable: true,
          buildTime: false,
          revision: 'r-ana-2',
          value: { name: 'Ana', links: [], photo: '/images/m1.png' },
        }),
    });
    saveButton().click();
    // The typed text keeps its layout; only the staging URL is replaced.
    await vi.waitFor(() =>
      expect(value('authors/ana').value).toBe(
        '{"name":"Ana","links":[],"photo":"/images/m1.png"}',
      ),
    );
  });

  it('a save with a rebuild waits for the bundle to change, then loads the preview again', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [saved('r-ana-2', { rebuild: true })],
      statuses: [bundle('b1'), bundle('b1'), bundle('b2')],
    });
    vi.useFakeTimers();
    try {
      saveButton().click();
      for (let tick = 0; tick < 5 && previewRequests() < 2; tick++)
        await vi.advanceTimersByTimeAsync(1000);
    } finally {
      vi.useRealTimers();
    }
    expect(previewRequests()).toBe(2);
    expect(editor.status().textContent).toBe('Saved. Applies after rebuild.');
  });

  it('after a save, a page that reloads is primed with the saved value', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [saved('r-ana-2')],
      reread: () =>
        Response.json({
          key: 'authors/ana',
          format: 'json',
          editable: true,
          buildTime: false,
          revision: 'r-ana-2',
          value: { name: 'Ana M', links: [] },
        }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(document.querySelector('#changes-list')!.textContent).toBe(
        'modified: authors/ana',
      ),
    );
    editor.ready('/blog');
    expect(editor.lastDraft()).toMatchObject({
      documents: { 'authors/ana': { name: 'Ana M', links: [] } },
    });
  });

  it('a Markdown document is saved as its frontmatter and its body', async () => {
    await editor.open('blog/blog-1');
    edit(editor.body('blog/blog-1'), 'Hello *there*');
    routeSave({ puts: [saved('r-blog-2')] });
    saveButton().click();
    await vi.waitFor(() => expect(saves()).toHaveLength(1));
    expect(JSON.parse(String(saves()[0]?.[1]?.body))).toEqual({
      changes: [
        {
          document: 'blog/blog-1',
          baseRevision: 'r-blog',
          data: {
            data: { title: 'One', draft: false },
            body: 'Hello *there*',
          },
        },
      ],
    });
  });

  it('a failed save is shown in the error state of the status line', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [
        Response.json(
          { error: 'busy', message: 'Another save' },
          { status: 503 },
        ),
      ],
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe(
        'The save did not happen. Try again.',
      ),
    );
    expect(editor.status().dataset.state).toBe('error');
  });

  it('says so when the saved document cannot be read again, and keeps the draft text', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [saved('r-ana-2')],
      reread: () =>
        Response.json({ error: 'busy', message: 'Busy' }, { status: 503 }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(saveErrorOf('authors/ana').textContent).toBe(
        'Saved, but it could not be read again (503): Busy',
      ),
    );
    expect(value('authors/ana').value).toBe('{"name":"Ana M","links":[]}');
  });

  it('shows why the changes list could not be loaded', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [saved('r-ana-2')],
      changes: new Response('no list', { status: 500 }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(document.querySelector('#changes-list')!.textContent).toBe(
        'Could not load the changes (500): no list',
      ),
    );
  });

  it('says "No changes" when the list is empty', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [saved('r-ana-2')],
      changes: Response.json({
        documents: [],
        createdRecords: [],
        fileErrors: [],
      }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(document.querySelector('#changes-list')!.textContent).toBe(
        'No changes',
      ),
    );
  });

  it('after a save that deletes a document, a later save does not send it again', async () => {
    await editor.open('authors/ana');
    click(section('authors/ana'), 'delete');
    routeSave({
      puts: [Response.json({ revisions: {}, warnings: [], rebuild: false })],
      changes: Response.json({
        documents: [],
        createdRecords: [],
        fileErrors: [],
      }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(document.querySelector('#changes-list')!.textContent).toBe(
        'No changes',
      ),
    );
    saveButton().click();
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe('Nothing to save'),
    );
    expect(saves()).toHaveLength(1);
  });

  it('a second save is based on the revision the first one answered, and sends nothing when nothing changed', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [saved('r-ana-2'), saved('r-ana-3')],
      reread: () =>
        Response.json({
          key: 'authors/ana',
          format: 'json',
          editable: true,
          buildTime: false,
          revision: 'r-ana-2',
          value: { name: 'Ana M', links: [] },
        }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(document.querySelector('#changes-list')!.textContent).toBe(
        'modified: authors/ana',
      ),
    );
    saveButton().click();
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe('Nothing to save'),
    );
    expect(saves()).toHaveLength(1);
    edit(editor.value('authors/ana'), '{"name":"Ana N","links":[]}');
    saveButton().click();
    await vi.waitFor(() => expect(saves()).toHaveLength(2));
    expect(
      JSON.parse(String(saves()[1]?.[1]?.body)).changes[0].baseRevision,
    ).toBe('r-ana-2');
  });

  it('a form in another layout of the saved value (compact JSON, other key order) is not sent again', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"links":[],"name":"Ana M"}');
    routeSave({
      puts: [saved('r-ana-2')],
      reread: () =>
        Response.json({
          key: 'authors/ana',
          format: 'json',
          editable: true,
          buildTime: false,
          revision: 'r-ana-2',
          value: { name: 'Ana M', links: [] },
        }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(document.querySelector('#changes-list')!.textContent).toBe(
        'modified: authors/ana',
      ),
    );
    saveButton().click();
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe('Nothing to save'),
    );
    expect(saves()).toHaveLength(1);
  });

  it('Save is disabled while a save runs, and enabled after it', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({ puts: [saved('r-ana-2')] });
    saveButton().click();
    expect(saveButton().disabled).toBe(true);
    await vi.waitFor(() =>
      expect(document.querySelector('#changes-list')!.textContent).toBe(
        'modified: authors/ana',
      ),
    );
    expect(saveButton().disabled).toBe(false);
  });

  it('Save stays enabled while the wait for a rebuild runs', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({ puts: [saved('r-ana-2', { rebuild: true })] });
    vi.useFakeTimers();
    try {
      saveButton().click();
      for (
        let tick = 0;
        tick < 5 &&
        !editor.status().textContent?.includes('Applies after rebuild');
        tick++
      )
        await vi.advanceTimersByTimeAsync(10);
      expect(saveButton().disabled).toBe(false);
      await vi.advanceTimersByTimeAsync(70_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after a save that deletes a document, the overlay holds null for it', async () => {
    await editor.open('authors/ana');
    click(section('authors/ana'), 'delete');
    routeSave({
      puts: [Response.json({ revisions: {}, warnings: [], rebuild: false })],
      changes: Response.json({
        documents: [],
        createdRecords: [],
        fileErrors: [],
      }),
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(document.querySelector('#changes-list')!.textContent).toBe(
        'No changes',
      ),
    );
    editor.ready('/blog');
    expect(editor.lastDraft()).toMatchObject({
      documents: { 'authors/ana': null },
    });
  });

  it('a save whose status before it could not be read says so, and does not reload for a build it cannot compare', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [saved('r-ana-2', { rebuild: true })],
      statuses: [new Response(null, { status: 500 })],
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(editor.status().textContent).toBe(
        'Saved, but the new build could not be checked. Reload the editor later.',
      ),
    );
    expect(previewRequests()).toBe(1);
  });

  it('"Keep mine" on a conflict whose document is gone says the next save creates it', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [
        Response.json(
          {
            error: 'conflict',
            documents: [{ key: 'authors/ana', revision: null }],
          },
          { status: 409 },
        ),
        saved('r-ana-4'),
      ],
    });
    saveButton().click();
    await vi.waitFor(() =>
      expect(conflictOf('authors/ana').hidden).toBe(false),
    );
    click(section('authors/ana'), 'keep');
    expect(saveErrorOf('authors/ana').textContent).toBe(
      'The document is gone from the working copy. Save again to create it.',
    );
    saveButton().click();
    await vi.waitFor(() => expect(saves()).toHaveLength(2));
    expect(
      JSON.parse(String(saves()[1]?.[1]?.body)).changes[0].baseRevision,
    ).toBeNull();
  });

  it('a rebuild wait of an older save does not overwrite the status of a newer save', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [saved('r-ana-2', { rebuild: true }), saved('r-ana-3')],
    });
    vi.useFakeTimers();
    try {
      saveButton().click();
      for (
        let tick = 0;
        tick < 5 &&
        !editor.status().textContent?.includes('Applies after rebuild');
        tick++
      )
        await vi.advanceTimersByTimeAsync(10);
      type(editor.value('authors/ana'), '{"name":"Ana N","links":[]}');
      saveButton().click();
      for (let tick = 0; tick < 5 && saves().length < 2; tick++)
        await vi.advanceTimersByTimeAsync(10);
      for (
        let tick = 0;
        tick < 5 && editor.status().textContent !== 'Saved.';
        tick++
      )
        await vi.advanceTimersByTimeAsync(10);
      expect(editor.status().textContent).toBe('Saved.');
      // The first save's wait runs out after 60 polls, and must not write its message now.
      for (let tick = 0; tick < 70; tick++)
        await vi.advanceTimersByTimeAsync(1000);
    } finally {
      vi.useRealTimers();
    }
    expect(editor.status().textContent).toBe('Saved.');
  });

  it('a rebuild that is not done after 60 polls says so, and does not load the preview again', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana M","links":[]}');
    routeSave({
      puts: [saved('r-ana-2', { rebuild: true })],
    });
    const statusCalls = () =>
      editor.fetch.mock.calls.filter(([url]) => url === '/api/status').length;
    const statusesBefore = statusCalls();
    vi.useFakeTimers();
    try {
      saveButton().click();
      for (
        let tick = 0;
        tick < 70 && !editor.status().textContent?.includes('not ready');
        tick++
      )
        await vi.advanceTimersByTimeAsync(1000);
    } finally {
      vi.useRealTimers();
    }
    expect(editor.status().textContent).toBe(
      'The new build is not ready yet. Reload the editor later.',
    );
    expect(previewRequests()).toBe(1);
    // One status before the save, then one poll per attempt.
    expect(statusCalls() - statusesBefore).toBe(61);
  });
});
