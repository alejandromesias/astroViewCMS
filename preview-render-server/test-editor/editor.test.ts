// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RENDER_DELAY_MS, startEditor } from './editor.ts';

// The real markup from editor.astro, so the test follows it. (A path, not a
// URL: under happy-dom, URL is the DOM's, which node:fs doesn't accept.)
const BODY = fs
  .readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'editor.astro'), 'utf8')
  .match(/<body>([\s\S]*)<\/body>/)![1]
  // A plain element stands in for the iframe: happy-dom would try to load it.
  // The editor only uses its src and contentWindow.
  .replace(/<iframe\b([^>]*)><\/iframe>/, '<div$1></div>');

function setup(search = '') {
  window.history.replaceState(null, '', `/__editor${search}`);
  document.body.innerHTML = BODY;
  const iframe = document.getElementById('preview') as unknown as HTMLIFrameElement;
  const child = { postMessage: vi.fn(), location: { reload: vi.fn() } };
  Object.defineProperty(iframe, 'contentWindow', { value: child, configurable: true });
  const fetch = vi.fn<typeof globalThis.fetch>();
  startEditor(window, fetch);

  const origin = window.location.origin;
  const fromPage = (data: unknown, source: unknown = child) =>
    window.dispatchEvent(Object.assign(new Event('message'), { data, source, origin }));
  const textarea = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Overlay (documents and media)"]')!;
  const status = () => document.getElementById('status')!;
  const drafts = () => child.postMessage.mock.calls.map(([message, target]) => ({ message, target }));
  return { iframe, child, fetch, origin, fromPage, textarea, status, drafts };
}

const type = (textarea: HTMLTextAreaElement, value: string) => {
  textarea.value = value;
  textarea.dispatchEvent(new Event('input'));
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

describe('on preview:ready', () => {
  it('sends an empty overlay when the textbox is empty, which primes the page', () => {
    editor.fromPage({ type: 'preview:ready', path: '/blog' });
    expect(editor.status().textContent).toBe('Page ready: /blog');
    expect(editor.drafts()).toEqual([{ message: { type: 'preview:draft', documents: {}, media: {} }, target: editor.origin }]);
  });

  it('after a reload of the page, resends the overlay in progress', () => {
    editor.textarea().value = '{"documents":{"blog/a":null},"media":{"a.png":{"url":"/x","width":1,"height":1,"format":"png"}}}';
    editor.fromPage({ type: 'preview:ready', path: '/blog' });
    editor.fromPage({ type: 'preview:ready', path: '/faq' });
    expect(editor.drafts().at(-1)!.message).toEqual({
      type: 'preview:draft',
      documents: { 'blog/a': null },
      media: { 'a.png': { url: '/x', width: 1, height: 1, format: 'png' } },
    });
    expect(editor.drafts()).toHaveLength(2);
  });
});

describe('editing', () => {
  it(`sends the draft ${RENDER_DELAY_MS} ms after the last keystroke`, () => {
    vi.useFakeTimers();
    try {
      type(editor.textarea(), '{"documents":{"a/b":1}}');
      type(editor.textarea(), '{"documents":{"a/b":2}}');
      vi.advanceTimersByTime(RENDER_DELAY_MS - 1);
      expect(editor.drafts()).toHaveLength(0);
      vi.advanceTimersByTime(1);
    } finally {
      vi.useRealTimers();
    }
    expect(editor.drafts()).toEqual([{ message: { type: 'preview:draft', documents: { 'a/b': 2 }, media: {} }, target: editor.origin }]);
  });

  it('flags invalid JSON and sends nothing', async () => {
    type(editor.textarea(), '{"documents": ');
    await vi.waitFor(() => expect(editor.textarea().getAttribute('aria-invalid')).toBe('true'));
    expect(document.querySelector('.region .error')!.textContent).not.toBe('');
    expect(editor.drafts()).toHaveLength(0);

    type(editor.textarea(), '{"documents": {}}');
    await vi.waitFor(() => expect(editor.drafts()).toHaveLength(1));
    expect(editor.textarea().hasAttribute('aria-invalid')).toBe(false);
    expect(document.querySelector('.region .error')!.textContent).toBe('');
  });

  it('"Reset" empties the textbox and reloads the page', () => {
    type(editor.textarea(), '{"documents": ');
    document.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click();
    expect(editor.textarea().value).toBe('');
    expect(editor.textarea().hasAttribute('aria-invalid')).toBe(false);
    expect(editor.child.location.reload).toHaveBeenCalledOnce();
  });
});

describe('status messages from the page', () => {
  it('shows what a render read and its limits', () => {
    editor.fromPage({ type: 'preview:rendered', path: '/blog', documents: ['blog/a', 'authors/b'], limits: ['code-language:cpp'], renderMs: 0.3 });
    expect(editor.status().textContent).toBe('Rendered /blog in 0.3 ms; documents: blog/a, authors/b; limits: code-language:cpp');
  });

  it('shows errors, with the failing fields', () => {
    editor.fromPage({ type: 'preview:error', path: '/blog', status: 500, message: 'boom' });
    expect(editor.status().textContent).toBe('/blog failed (500): boom');
    expect(editor.status().dataset.state).toBe('error');
    editor.fromPage({ type: 'preview:error', path: '/blog', status: 422, message: 'bad', errors: [{ key: 'blog/a', path: ['title'], message: 'required' }] });
    expect(editor.status().textContent).toBe('/blog failed (422): bad (blog/a title: required)');
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
  const choose = (file: File) => {
    const input = document.getElementById('upload') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  it('uploads the file and shows the media-map entry', async () => {
    const entry = { url: '/__preview-media/0123456789abcdef.png', width: 10, height: 20, format: 'png' };
    editor.fetch.mockResolvedValueOnce(Response.json(entry, { status: 201 }));
    const file = new File([new Uint8Array([1, 2, 3])], 'retrato.png', { type: 'image/png' });
    choose(file);

    await vi.waitFor(() => expect(document.getElementById('upload-result')!.hidden).toBe(false));
    expect(JSON.parse(document.getElementById('upload-url')!.textContent!)).toEqual(entry);
    expect(editor.fetch).toHaveBeenCalledWith('/__preview-media/new', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: file,
    });
    expect(editor.status().textContent).toBe('Uploaded retrato.png');
  });

  it('shows a failed upload', async () => {
    editor.fetch.mockResolvedValueOnce(new Response('Supported types: image/png', { status: 415 }));
    choose(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    await vi.waitFor(() => expect(editor.status().textContent).toBe('Upload failed (415): Supported types: image/png'));
    expect(document.getElementById('upload-result')!.hidden).toBe(true);
  });

  it('copies the entry', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    document.getElementById('upload-url')!.textContent = '{"url":"/x"}';
    document.getElementById('upload-copy')!.click();
    expect(writeText).toHaveBeenCalledWith('{"url":"/x"}');
  });
});
