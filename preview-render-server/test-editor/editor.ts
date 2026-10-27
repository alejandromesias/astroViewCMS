// Test editor logic (markup in editor.astro). It only speaks the bridge's
// postMessage protocol (src/protocol.ts) plus one plain request, POST
// /__preview-media/new for uploads. It has no source of saved content any more
// (the island GET route is gone, WORKPLAN task 1.1): textboxes start empty and
// the editor sends a draft only for a textbox that has content. Task 1.7
// brings a dev-only document route back.
import { isPageMessage, type DraftMessage, type Props } from '../src/protocol.ts';

export const RENDER_DELAY_MS = 120;

/**
 * Wires up the test editor page (markup in editor.astro): loads the site in
 * the iframe, builds a JSON textbox per island the page reports, sends
 * drafts to the bridge as you type, shows render results, and handles draft
 * image uploads. `win` and `fetchImpl` are parameters so tests can pass fakes.
 */
export function startEditor(win: Window = window, fetchImpl: typeof fetch = win.fetch.bind(win)): void {
  const doc = win.document;
  const origin = win.location.origin;
  const byId = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;

  const iframe = byId<HTMLIFrameElement>('preview');
  const status = byId<HTMLElement>('status');
  const islandsRoot = byId<HTMLElement>('islands');
  const template = byId<HTMLTemplateElement>('island-template');
  const textareas = new Map<string, HTMLTextAreaElement>();

  /** Status line under the title; `state` ('ok' | 'error') drives its color. */
  function setStatus(text: string, state = 'ok') {
    status.textContent = text;
    status.dataset.state = state;
  }

  /** Sends an island's textbox content to the page as a draft. An empty
   *  textbox sends nothing. Invalid JSON is flagged on the textbox and not
   *  sent, so the page keeps its last good state. */
  function sendDraft(island: string) {
    const textarea = textareas.get(island)!;
    const error = textarea.closest('.island')!.querySelector('.error')!;
    if (!textarea.value.trim()) return;
    let props: Props;
    try {
      props = JSON.parse(textarea.value) as Props;
    } catch (parseError) {
      textarea.setAttribute('aria-invalid', 'true');
      error.textContent = (parseError as Error).message;
      return;
    }
    textarea.removeAttribute('aria-invalid');
    error.textContent = '';
    const message: DraftMessage = { type: 'preview:draft', island, props };
    iframe.contentWindow?.postMessage(message, origin);
  }

  /** Adds an island's section (empty textbox + reset button). Typing sends a
   *  draft after RENDER_DELAY_MS of quiet. */
  function addIsland(island: string) {
    const section = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    section.querySelector('h2')!.textContent = `Island: ${island}`;
    const error = section.querySelector('.error')!;
    const textarea = section.querySelector('textarea')!;
    textarea.setAttribute('aria-label', `Props for island ${island}`);
    islandsRoot.append(section);
    textareas.set(island, textarea);

    let timer: ReturnType<typeof setTimeout> | undefined;
    textarea.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => sendDraft(island), RENDER_DELAY_MS);
    });
    // Reset: empty the textbox and reload the page, which shows the built content.
    section.querySelector('[data-action="reset"]')!.addEventListener('click', () => {
      textarea.value = '';
      textarea.removeAttribute('aria-invalid');
      error.textContent = '';
      iframe.contentWindow?.location.reload();
    });
  }

  // Messages from the bridge: only from the iframe, same origin, well-formed.
  win.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow || event.origin !== origin) return;
    const message = event.data;
    if (!isPageMessage(message)) return;

    if (message.type === 'preview:ready') {
      // The page (re)loaded: rebuild the textboxes for the islands it has,
      // keeping drafts in progress, and send them so the page shows them.
      const islands = message.islands;
      for (const island of [...textareas.keys()]) {
        if (!islands.includes(island)) {
          textareas.get(island)!.closest('.island')!.remove();
          textareas.delete(island);
        }
      }
      for (const island of islands) {
        if (!textareas.has(island)) addIsland(island);
        else sendDraft(island);
      }
      setStatus(islands.length ? `Page ready: ${islands.join(', ')}` : 'This page has no editable islands');
    } else if (message.type === 'preview:rendered') {
      setStatus(`Rendered "${message.island}" in ${message.renderMs} ms`);
    } else {
      setStatus(`"${message.island}" failed (${message.status}): ${message.message}`, 'error');
    }
  });

  // Draft image upload: POST the file to /__preview-media/new and show the URL
  // to paste into an image field.
  const upload = byId<HTMLInputElement>('upload');
  const uploadResult = byId<HTMLElement>('upload-result');
  const uploadUrl = byId<HTMLElement>('upload-url');

  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    if (!file) return;
    const response = await fetchImpl('/__preview-media/new', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!response.ok) {
      setStatus(`Upload failed (${response.status}): ${await response.text()}`, 'error');
      return;
    }
    const { url } = (await response.json()) as { url: string };
    uploadUrl.textContent = url;
    uploadResult.hidden = false;
    setStatus(`Uploaded ${file.name}`);
  });

  byId<HTMLButtonElement>('upload-copy').addEventListener('click', () => {
    void win.navigator.clipboard?.writeText(uploadUrl.textContent ?? '');
  });

  // Load the page only now, so the listener above catches its first "ready".
  iframe.src = new URLSearchParams(win.location.search).get('page') ?? '/';
}
