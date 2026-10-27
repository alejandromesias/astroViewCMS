// Test editor logic (markup in editor.astro). It only speaks the bridge's
// postMessage protocol (src/protocol.ts, v2) plus one plain request, POST
// /__preview-media/new for uploads. INTERIM (WORKPLAN task 1.6): one JSON
// textbox holds the whole overlay, `{ "documents": {...}, "media": {...} }`.
// Task 1.7 replaces it with a form per document of the page.
import { isPageMessage, type DraftMessage } from '../src/protocol.ts';

export const RENDER_DELAY_MS = 120;

/**
 * Wires up the test editor page (markup in editor.astro): loads the site in
 * the iframe, sends the overlay in the textbox to the bridge as you type,
 * shows render results, and handles draft image uploads. `win` and
 * `fetchImpl` are parameters so tests can pass fakes.
 */
export function startEditor(win: Window = window, fetchImpl: typeof fetch = win.fetch.bind(win)): void {
  const doc = win.document;
  const origin = win.location.origin;
  const byId = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;

  const iframe = byId<HTMLIFrameElement>('preview');
  const status = byId<HTMLElement>('status');
  const template = byId<HTMLTemplateElement>('region-template');

  /** Status line under the title; `state` ('ok' | 'error') drives its color. */
  function setStatus(text: string, state = 'ok') {
    status.textContent = text;
    status.dataset.state = state;
  }

  // The single textbox.
  const section = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  section.querySelector('h2')!.textContent = 'Overlay';
  const textarea = section.querySelector('textarea')!;
  textarea.setAttribute('aria-label', 'Overlay (documents and media)');
  textarea.placeholder = '{ "documents": { "blog/blog-1": { "data": {}, "body": "" } }, "media": {} }';
  const error = section.querySelector('.error')!;
  byId('regions').append(section);

  /** Sends the textbox content to the page as a draft. An empty textbox is an
   *  empty overlay: it still makes the page render, which primes it. Invalid
   *  JSON is flagged and not sent, so the page keeps its last good state. */
  function sendDraft() {
    let overlay: { documents?: DraftMessage['documents']; media?: DraftMessage['media'] } = {};
    if (textarea.value.trim()) {
      try {
        overlay = JSON.parse(textarea.value);
      } catch (parseError) {
        textarea.setAttribute('aria-invalid', 'true');
        error.textContent = (parseError as Error).message;
        return;
      }
    }
    textarea.removeAttribute('aria-invalid');
    error.textContent = '';
    const message: DraftMessage = { type: 'preview:draft', documents: overlay.documents ?? {}, media: overlay.media ?? {} };
    iframe.contentWindow?.postMessage(message, origin);
  }

  // Typing sends a draft after RENDER_DELAY_MS of quiet.
  let timer: ReturnType<typeof setTimeout> | undefined;
  textarea.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(sendDraft, RENDER_DELAY_MS);
  });
  // Reset: empty the textbox and reload the page, which shows the built content.
  section.querySelector('[data-action="reset"]')!.addEventListener('click', () => {
    textarea.value = '';
    textarea.removeAttribute('aria-invalid');
    error.textContent = '';
    iframe.contentWindow?.location.reload();
  });

  // Messages from the bridge: only from the iframe, same origin, well-formed.
  win.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow || event.origin !== origin) return;
    const message = event.data;
    if (!isPageMessage(message)) return;

    if (message.type === 'preview:ready') {
      // The page (re)loaded: send the overlay so it shows the drafts.
      setStatus(`Page ready: ${message.path}`);
      sendDraft();
    } else if (message.type === 'preview:rendered') {
      const limits = message.limits.length ? `; limits: ${message.limits.join(', ')}` : '';
      setStatus(`Rendered ${message.path} in ${message.renderMs} ms; documents: ${message.documents.join(', ') || 'none'}${limits}`);
    } else {
      const fields = message.errors?.map((e) => `${e.key} ${e.path.join('.')}: ${e.message}`).join('; ');
      setStatus(`${message.path} failed (${message.status}): ${message.message}${fields ? ` (${fields})` : ''}`, 'error');
    }
  });

  // Draft image upload: POST the file to /__preview-media/new and show the
  // answer, a media-map entry to paste under "media" with the image's reference.
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
    uploadUrl.textContent = JSON.stringify(await response.json());
    uploadResult.hidden = false;
    setStatus(`Uploaded ${file.name}`);
  });

  byId<HTMLButtonElement>('upload-copy').addEventListener('click', () => {
    void win.navigator.clipboard?.writeText(uploadUrl.textContent ?? '');
  });

  // Load the page only now, so the listener above catches its first "ready".
  iframe.src = new URLSearchParams(win.location.search).get('page') ?? '/';
}
