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

const saved = { blocks: [{ type: 'servicios', encabezado: 'Servicios' }] };

function setup(search = '') {
  window.history.replaceState(null, '', `/__editor${search}`);
  document.body.innerHTML = BODY;
  const iframe = document.getElementById('preview') as unknown as HTMLIFrameElement;
  const child = { postMessage: vi.fn() };
  Object.defineProperty(iframe, 'contentWindow', { value: child, configurable: true });
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json(saved));
  startEditor(window, fetch);

  const origin = window.location.origin;
  const fromPage = (data: unknown, source: unknown = child) =>
    window.dispatchEvent(Object.assign(new Event('message'), { data, source, origin }));
  const textarea = (island = 'blocks') =>
    document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="Props for island ${island}"]`);
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
  it('adds a textbox per island, filled with the saved props', async () => {
    editor.fromPage({ type: 'preview:ready', islands: ['blocks'] });

    await vi.waitFor(() => expect(editor.textarea()?.value).toBe(JSON.stringify(saved, null, 2)));
    expect(editor.fetch).toHaveBeenCalledWith('/__preview/blocks', { cache: 'no-store' });
    expect(editor.status().textContent).toBe('Page ready: blocks');
  });

  it('says so when the page has no islands', async () => {
    editor.fromPage({ type: 'preview:ready', islands: [] });
    await vi.waitFor(() => expect(editor.status().textContent).toBe('This page has no editable islands'));
  });

  it('shows an error when the saved props cannot be loaded', async () => {
    editor.fetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    editor.fromPage({ type: 'preview:ready', islands: ['blocks'] });
    await vi.waitFor(() => expect(editor.status().dataset.state).toBe('error'));
    expect(editor.status().textContent).toContain('404');
  });

  it('after a reload of the page, resends the drafts in progress', async () => {
    editor.fromPage({ type: 'preview:ready', islands: ['blocks'] });
    await vi.waitFor(() => expect(editor.textarea()).not.toBeNull());
    editor.textarea()!.value = '{"blocks":[]}';

    editor.fromPage({ type: 'preview:ready', islands: ['blocks'] });

    await vi.waitFor(() =>
      expect(editor.drafts().at(-1)).toEqual({
        message: { type: 'preview:draft', island: 'blocks', props: { blocks: [] } },
        target: editor.origin,
      }),
    );
    expect(document.querySelectorAll('.island')).toHaveLength(1);
  });

  it('removes textboxes for islands the new page does not have', async () => {
    editor.fromPage({ type: 'preview:ready', islands: ['blocks'] });
    await vi.waitFor(() => expect(editor.textarea()).not.toBeNull());
    editor.fromPage({ type: 'preview:ready', islands: [] });
    await vi.waitFor(() => expect(editor.textarea()).toBeNull());
  });
});

describe('editing', () => {
  beforeEach(async () => {
    editor.fromPage({ type: 'preview:ready', islands: ['blocks'] });
    await vi.waitFor(() => expect(editor.textarea()?.value).not.toBe(''));
  });

  it(`sends the draft ${RENDER_DELAY_MS} ms after the last keystroke`, async () => {
    vi.useFakeTimers();
    try {
      type(editor.textarea()!, '{"blocks":[{"type":"hero"}]}');
      type(editor.textarea()!, '{"blocks":[{"type":"servicios"}]}');
      vi.advanceTimersByTime(RENDER_DELAY_MS - 1);
      expect(editor.drafts()).toHaveLength(0);
      vi.advanceTimersByTime(1);
    } finally {
      vi.useRealTimers();
    }
    expect(editor.drafts()).toEqual([
      { message: { type: 'preview:draft', island: 'blocks', props: { blocks: [{ type: 'servicios' }] } }, target: editor.origin },
    ]);
  });

  it('flags invalid JSON and sends nothing', async () => {
    type(editor.textarea()!, '{"blocks": [');
    await vi.waitFor(() => expect(editor.textarea()!.getAttribute('aria-invalid')).toBe('true'));
    expect(document.querySelector('.island .error')!.textContent).not.toBe('');
    expect(editor.drafts()).toHaveLength(0);

    type(editor.textarea()!, '{"blocks": []}');
    await vi.waitFor(() => expect(editor.drafts()).toHaveLength(1));
    expect(editor.textarea()!.hasAttribute('aria-invalid')).toBe(false);
    expect(document.querySelector('.island .error')!.textContent).toBe('');
  });

  it('"Reset to saved" reloads the saved props and sends them', async () => {
    editor.textarea()!.value = '{}';
    document.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click();
    await vi.waitFor(() => expect(editor.drafts()).toHaveLength(1));
    expect(editor.textarea()!.value).toBe(JSON.stringify(saved, null, 2));
    expect(editor.drafts()[0].message).toEqual({ type: 'preview:draft', island: 'blocks', props: saved });
  });
});

describe('status messages from the page', () => {
  it('shows render times', () => {
    editor.fromPage({ type: 'preview:rendered', island: 'blocks', renderMs: 0.3 });
    expect(editor.status().textContent).toBe('Rendered "blocks" in 0.3 ms');
  });

  it('shows errors', () => {
    editor.fromPage({ type: 'preview:error', island: 'blocks', status: 500, message: 'boom' });
    expect(editor.status().textContent).toBe('"blocks" failed (500): boom');
    expect(editor.status().dataset.state).toBe('error');
  });

  it('ignores messages from other windows and unknown messages', () => {
    const before = editor.status().textContent;
    editor.fromPage({ type: 'preview:rendered', island: 'blocks', renderMs: 1 }, {});
    editor.fromPage({ type: 'pageNavigation', pathname: '/' });
    expect(editor.status().textContent).toBe(before);
  });
});

describe('draft image upload', () => {
  const choose = (file: File) => {
    const input = document.getElementById('upload') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  it('uploads the file and shows its URL', async () => {
    editor.fetch.mockResolvedValueOnce(Response.json({ url: '/__preview-media/0123456789abcdef.png' }, { status: 201 }));
    const file = new File([new Uint8Array([1, 2, 3])], 'retrato.png', { type: 'image/png' });
    choose(file);

    await vi.waitFor(() => expect(document.getElementById('upload-result')!.hidden).toBe(false));
    expect(document.getElementById('upload-url')!.textContent).toBe('/__preview-media/0123456789abcdef.png');
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

  it('copies the URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    document.getElementById('upload-url')!.textContent = '/__preview-media/0123456789abcdef.png';
    document.getElementById('upload-copy')!.click();
    expect(writeText).toHaveBeenCalledWith('/__preview-media/0123456789abcdef.png');
  });
});
