// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from 'preview-protocol';
import { RENDER_DELAY_MS, buildTimeNote, limitNote, startEditor } from './editor.ts';

// The real markup from editor.astro, so the test follows it. (A path, not a
// URL: under happy-dom, URL is the DOM's, which node:fs doesn't accept.)
const BODY = fs
  .readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'editor.astro'), 'utf8')
  .match(/<body>([\s\S]*)<\/body>/)![1]!
  // A plain element stands in for the iframe: happy-dom would try to load it.
  // The editor only uses its src and contentWindow.
  .replace(/<iframe\b([^>]*)><\/iframe>/, '<div$1></div>');

/** What GET /__dev/documents answers for each key (src/dev/documents.ts). */
const DOCUMENTS: Record<string, unknown> = {
  'authors/ana': { key: 'authors/ana', file: 'src/content/authors/ana.json', format: 'json', buildTime: false, value: { name: 'Ana', links: [] } },
  'blog/blog-1': { key: 'blog/blog-1', file: 'src/content/blog/blog-1.md', format: 'md', buildTime: false, value: { data: { title: 'One', draft: false }, body: 'Hello *world*' } },
  'data:src/config/config.json': {
    key: 'data:src/config/config.json',
    file: 'src/config/config.json',
    format: 'json',
    buildTime: true,
    buildTimeFields: ['site.base_url', 'site.title'],
    value: { site: {} },
  },
  'data:src/config/theme.json': { key: 'data:src/config/theme.json', file: 'src/config/theme.json', format: 'json', buildTime: true, buildTimeFields: ['*'], value: {} },
  'rules/one': { key: 'rules/one', file: 'src/content/rules.toml', format: 'toml', editable: false, buildTime: false },
};

function setup(search = '') {
  window.history.replaceState(null, '', `/__editor${search}`);
  document.body.innerHTML = BODY;
  const iframe = document.getElementById('preview') as unknown as HTMLIFrameElement;
  const child = { postMessage: vi.fn(), location: { reload: vi.fn() } };
  Object.defineProperty(iframe, 'contentWindow', { value: child, configurable: true });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.startsWith('/__dev/documents?key=')) {
      const key = decodeURIComponent(url.slice('/__dev/documents?key='.length));
      return key in DOCUMENTS ? Response.json(DOCUMENTS[key]) : new Response(`Unknown document "${key}"`, { status: 404 });
    }
    return new Response(null, { status: 204 });
  });
  startEditor(window, fetch);

  const origin = window.location.origin;
  const fromPage = (data: unknown, source: unknown = child) =>
    window.dispatchEvent(Object.assign(new Event('message'), { data, source, origin }));
  const ready = (pagePath = '/blog') => fromPage({ type: 'preview:ready', path: pagePath, protocol: PROTOCOL_VERSION });
  const rendered = (documents: string[], limits: string[] = [], pagePath = '/blog') =>
    fromPage({ type: 'preview:rendered', path: pagePath, documents, limits, renderMs: 0.3 });
  const section = (key: string) => document.querySelector<HTMLElement>(`[data-key="${key}"]`)!;
  const value = (key: string) => section(key).querySelector<HTMLTextAreaElement>('[data-field="value"]')!;
  const body = (key: string) => section(key).querySelector<HTMLTextAreaElement>('[data-field="body"]')!;
  const error = (key: string) => section(key).querySelector<HTMLElement>('[data-slot="error"]')!;
  const status = () => document.getElementById('status')!;
  const drafts = () => child.postMessage.mock.calls.map(([message]) => message);
  const lastDraft = () => drafts().at(-1);
  /** Page read these documents: waits until their forms exist. */
  const open = async (...keys: string[]) => {
    rendered(keys);
    await vi.waitFor(() => keys.forEach((key) => expect(section(key)).not.toBeNull()));
  };
  return { iframe, child, fetch, origin, fromPage, ready, rendered, section, value, body, error, status, drafts, lastDraft, open };
}

const type = (textarea: HTMLTextAreaElement, text: string) => {
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
};
const click = (root: Element, action: string) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
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

let editor: ReturnType<typeof setup>;
beforeEach(() => {
  editor = setup();
});

describe('loading the page', () => {
  it('loads "/" in the iframe by default', () => {
    expect(editor.iframe.src).toBe('/');
  });

  it('loads ?page= when given', () => {
    expect(setup('?page=/servicios').iframe.src).toBe('/servicios');
  });
});

describe('protocol mismatch', () => {
  it.each([
    ['a different protocol', { type: 'preview:ready', path: '/blog', protocol: 1 }],
    ['no protocol', { type: 'preview:ready', path: '/blog' }],
  ])('flags a ready with %s and sends no draft', (_, message) => {
    const editor = setup();
    editor.fromPage(message);
    expect(editor.status().dataset.state).toBe('error');
    expect(editor.status().textContent).toContain('protocol mismatch');
    expect(editor.drafts()).toHaveLength(0);
    expect(editor.fetch).not.toHaveBeenCalled();
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
  it('sends an empty overlay, which primes the page, and warms the renderer', () => {
    editor.ready();
    expect(editor.status().textContent).toBe('Page ready: /blog');
    expect(editor.drafts()).toEqual([{ type: 'preview:draft', protocol: PROTOCOL_VERSION, documents: {}, media: {} }]);
    expect(editor.child.postMessage).toHaveBeenCalledWith(expect.anything(), editor.origin);
    expect(editor.fetch).toHaveBeenCalledWith('/__preview/warm', { method: 'POST' });
  });

  it('survives a failing warm-up call', () => {
    editor.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(() => editor.ready()).not.toThrow();
  });

  it('after a navigation, re-primes with the same overlay', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"Ana (draft)"}');
    editor.ready('/faq');
    expect(editor.lastDraft().documents).toEqual({ 'authors/ana': { name: 'Ana (draft)' } });
  });
});

describe('loading documents', () => {
  it('fetches each document the page read, once', async () => {
    await editor.open('authors/ana', 'blog/blog-1');
    editor.rendered(['authors/ana', 'blog/blog-1']);
    const fetched = editor.fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/__dev'));
    expect(fetched).toEqual(['/__dev/documents?key=authors%2Fana', '/__dev/documents?key=blog%2Fblog-1']);
  });

  it('shows a JSON document in one textbox', async () => {
    await editor.open('authors/ana');
    expect(JSON.parse(editor.value('authors/ana').value)).toEqual({ name: 'Ana', links: [] });
    expect(editor.section('authors/ana').querySelector('[data-slot="file"]')!.textContent).toBe('src/content/authors/ana.json (json)');
    expect(editor.body('authors/ana').closest('label')!.hidden).toBe(true);
  });

  it('shows a Markdown document as frontmatter JSON and a body', async () => {
    await editor.open('blog/blog-1');
    expect(JSON.parse(editor.value('blog/blog-1').value)).toEqual({ title: 'One', draft: false });
    expect(editor.body('blog/blog-1').value).toBe('Hello *world*');
    expect(editor.body('blog/blog-1').closest('label')!.hidden).toBe(false);
  });

  it('lists a read-only document as built, without a textbox, and never sends it', async () => {
    await editor.open('rules/one');
    expect(editor.section('rules/one').querySelector('textarea')!.closest('[data-slot="fields"]')).toHaveProperty('hidden', true);
    expect(editor.section('rules/one').textContent).toContain('Shown as built');
    editor.ready();
    expect(editor.lastDraft().documents).toEqual({});
  });

  it('says why a document could not be loaded, and does not retry it', async () => {
    await editor.open('missing/one');
    expect(editor.section('missing/one').textContent).toContain('Could not load (404)');
    expect(editor.section('missing/one').querySelector('textarea')!.closest('[data-slot="fields"]')).toHaveProperty('hidden', true);
    editor.rendered(['missing/one']);
    expect(editor.fetch.mock.calls.filter(([url]) => String(url).includes('missing'))).toHaveLength(1);
  });

  it('says so when the request itself fails', async () => {
    editor.fetch.mockRejectedValueOnce(new Error('offline'));
    await editor.open('authors/ana');
    expect(editor.section('authors/ana').textContent).toContain('Could not load: offline');
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
    await vi.waitFor(() => expect(editor.section('blog/blog-1')).not.toBeNull());
    await vi.waitFor(() => expect(editor.section('authors/ana')).not.toBeNull());
    expect(editor.section('authors/ana').hidden).toBe(true);
    expect(editor.section('blog/blog-1').hidden).toBe(false);
  });

  it('warns about build-time fields', async () => {
    expect(buildTimeNote({ buildTime: false })).toBe('');
    expect(buildTimeNote({ buildTime: true, buildTimeFields: ['*'] })).toBe('Some fields apply after rebuild: the whole file');
    await editor.open('data:src/config/config.json', 'data:src/config/theme.json', 'authors/ana');
    expect(editor.section('data:src/config/config.json').textContent).toContain('Some fields apply after rebuild: site.base_url, site.title');
    expect(editor.section('data:src/config/theme.json').textContent).toContain('Some fields apply after rebuild: the whole file');
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
    expect(editor.drafts()).toEqual([{ type: 'preview:draft', protocol: PROTOCOL_VERSION, documents: { 'authors/ana': { name: 'B' } }, media: {} }]);
  });

  it('sends a document edited only in its body as { data, body }', async () => {
    await editor.open('blog/blog-1');
    edit(editor.body('blog/blog-1'), 'Changed');
    expect(editor.lastDraft().documents).toEqual({ 'blog/blog-1': { data: { title: 'One', draft: false }, body: 'Changed' } });
  });

  it('leaves untouched documents out of the overlay', async () => {
    await editor.open('authors/ana', 'blog/blog-1');
    edit(editor.value('authors/ana'), '{"name":"A"}');
    expect(Object.keys(editor.lastDraft().documents)).toEqual(['authors/ana']);
  });

  it('flags invalid JSON, leaves that document out and still sends the others', async () => {
    await editor.open('authors/ana', 'blog/blog-1');
    edit(editor.value('authors/ana'), '{"name":');
    expect(editor.value('authors/ana').getAttribute('aria-invalid')).toBe('true');
    expect(editor.error('authors/ana').textContent).not.toBe('');
    expect(editor.lastDraft().documents).toEqual({});

    edit(editor.body('blog/blog-1'), 'Changed');
    expect(Object.keys(editor.lastDraft().documents)).toEqual(['blog/blog-1']);

    edit(editor.value('authors/ana'), '{"name":"Fixed"}');
    expect(editor.value('authors/ana').hasAttribute('aria-invalid')).toBe(false);
    expect(editor.error('authors/ana').textContent).toBe('');
    expect(editor.lastDraft().documents['authors/ana']).toEqual({ name: 'Fixed' });
  });

  it('keeps the last overlay sent in a read-only view', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{"name":"A"}');
    expect(JSON.parse(document.getElementById('envelope')!.textContent!)).toEqual({ documents: { 'authors/ana': { name: 'A' } }, media: {} });
  });
});

describe('reset and delete', () => {
  it('"Reset" restores the saved text and takes the document out of the overlay, without sending null', async () => {
    await editor.open('blog/blog-1');
    edit(editor.value('blog/blog-1'), '{"title":"Two"}');
    edit(editor.body('blog/blog-1'), 'Changed');
    click(editor.section('blog/blog-1'), 'reset');
    expect(JSON.parse(editor.value('blog/blog-1').value)).toEqual({ title: 'One', draft: false });
    expect(editor.body('blog/blog-1').value).toBe('Hello *world*');
    expect(editor.lastDraft().documents).toEqual({});
    expect(editor.child.location.reload).not.toHaveBeenCalled();
  });

  it('"Reset" clears an invalid-JSON flag', async () => {
    await editor.open('authors/ana');
    edit(editor.value('authors/ana'), '{');
    click(editor.section('authors/ana'), 'reset');
    expect(editor.value('authors/ana').hasAttribute('aria-invalid')).toBe(false);
    expect(editor.error('authors/ana').textContent).toBe('');
  });

  it('"Delete in draft" sends null, and typing again brings the document back', async () => {
    await editor.open('authors/ana', 'blog/blog-1');
    click(editor.section('authors/ana'), 'delete');
    expect(editor.lastDraft().documents).toEqual({ 'authors/ana': null });
    edit(editor.value('authors/ana'), '{"name":"Back"}');
    expect(editor.lastDraft().documents).toEqual({ 'authors/ana': { name: 'Back' } });
    click(editor.section('authors/ana'), 'delete');
    click(editor.section('authors/ana'), 'reset');
    expect(editor.lastDraft().documents).toEqual({});
  });
});

describe('status messages from the page', () => {
  it('shows what a render read', () => {
    editor.rendered(['blog/a', 'authors/b'], ['code-language:cpp']);
    expect(editor.status().textContent).toBe('Rendered /blog in 0.3 ms; documents: blog/a, authors/b');
    editor.rendered([]);
    expect(editor.status().textContent).toBe('Rendered /blog in 0.3 ms; documents: none');
  });

  it('shows each limit as a note and clears them on the next render', () => {
    editor.rendered([], ['mdx-body', 'schema-refinement', 'markdown-plugins', 'code-language:cpp', 'something-new']);
    const notes = () => [...document.querySelectorAll('#limits li')].map((li) => li.textContent);
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
    editor.fromPage({ type: 'preview:error', path: '/blog', status: 500, message: 'boom' });
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
        { key: 'authors/ana', path: ['links', 0, 'url'], message: 'Invalid url' },
        { key: 'authors/ana', path: ['name'], message: 'Required' },
        { key: 'blog/other', path: ['title'], message: 'Required' },
      ],
    });
    expect(editor.error('authors/ana').textContent).toBe('links.0.url: Invalid url; name: Required');
    expect(editor.status().textContent).toBe('/blog failed (422): invalid (blog/other title: Required)');
  });

  it('clears the field errors when the next draft goes out', async () => {
    await editor.open('authors/ana');
    editor.fromPage({ type: 'preview:error', path: '/blog', status: 422, message: 'invalid', errors: [{ key: 'authors/ana', path: ['name'], message: 'Required' }] });
    edit(editor.value('authors/ana'), '{"name":"A"}');
    expect(editor.error('authors/ana').textContent).toBe('');
  });

  it('shows a network failure (status 0)', () => {
    editor.fromPage({ type: 'preview:error', path: '/blog', status: 0, message: 'Failed to fetch' });
    expect(editor.status().textContent).toBe('/blog failed (0): Failed to fetch');
  });

  it('ignores messages from other windows and unknown messages', () => {
    const before = editor.status().textContent;
    editor.fromPage({ type: 'preview:rendered', path: '/', documents: [], limits: [], renderMs: 1 }, {});
    editor.fromPage({ type: 'pageNavigation', path: '/' });
    editor.fromPage({ type: 'preview:ready', regions: ['blocks'] }); // protocol v1
    expect(editor.status().textContent).toBe(before);
    expect(editor.drafts()).toHaveLength(0);
  });
});

describe('draft image upload', () => {
  const entry = { url: '/__preview-media/0123456789abcdef.png', width: 10, height: 20, format: 'png' };
  const choose = (file: File) => {
    const input = document.getElementById('upload') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  };
  const upload = async (name = 'retrato.png') => {
    editor.fetch.mockResolvedValueOnce(Response.json(entry, { status: 201 }));
    const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
    choose(file);
    await vi.waitFor(() => expect(document.getElementById('upload-result')!.hidden).toBe(false));
    return file;
  };

  it('uploads the file and shows the URL to put in the document', async () => {
    const file = await upload();
    expect(document.getElementById('upload-url')!.textContent).toBe(entry.url);
    expect(editor.fetch).toHaveBeenCalledWith('/__preview-media/new', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: file });
    expect(editor.status().textContent).toBe('Uploaded retrato.png');
  });

  it('adds the entry to the media map under its url and sends it with every draft', async () => {
    await editor.open('authors/ana');
    await upload();
    expect(editor.lastDraft().media).toEqual({ [entry.url]: entry });
    edit(editor.value('authors/ana'), '{"name":"A"}');
    expect(editor.lastDraft()).toMatchObject({ documents: { 'authors/ana': { name: 'A' } }, media: { [entry.url]: entry } });
    editor.ready();
    expect(editor.lastDraft().media).toEqual({ [entry.url]: entry });
  });

  it('shows a failed upload and sends nothing', async () => {
    editor.fetch.mockResolvedValueOnce(new Response('Supported types: image/png', { status: 415 }));
    choose(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    await vi.waitFor(() => expect(editor.status().textContent).toBe('Upload failed (415): Supported types: image/png'));
    expect(document.getElementById('upload-result')!.hidden).toBe(true);
    expect(editor.drafts()).toHaveLength(0);
  });

  it('copies the URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    document.getElementById('upload-url')!.textContent = '/__preview-media/x.png';
    document.getElementById('upload-copy')!.click();
    expect(writeText).toHaveBeenCalledWith('/__preview-media/x.png');
  });
});
