// Test editor logic (markup in editor.astro). It speaks the bridge's
// postMessage protocol (preview-protocol, v2) plus three plain requests: GET
// /__dev/documents?key= for the raw value of each document the page reads (a
// stopgap for the CMS app's GET /api/documents, WORKPLAN task 1.7), POST
// /__preview/warm, and POST /__preview-media/new for uploads. A form per
// document: a JSON textbox, plus a body textarea for Markdown and MDX.
import {
  PROTOCOL_VERSION,
  isPageMessage,
  protocolMismatch,
  type DraftMessage,
  type FieldError,
  type MediaInfo,
} from 'preview-protocol';
import type { DevDocument } from '../src/dev/documents.ts';

export const RENDER_DELAY_MS = 120;

const LIMIT_NOTES: Record<string, string> = {
  'mdx-body': 'MDX body: preview after save',
  'schema-refinement': 'a schema refinement could not run',
  'markdown-plugins': 'Markdown plugins failed, shown without them',
};

/** What a `limits` value of a render means for the author; unknown values are
 *  shown as they are. */
export function limitNote(limit: string): string {
  if (Object.hasOwn(LIMIT_NOTES, limit)) return LIMIT_NOTES[limit]!;
  if (limit.startsWith('code-language:')) return `\`${limit.slice('code-language:'.length)}\` highlighted after publish`;
  return limit;
}

/** The build-time warning of a document (D1), or '' for one that applies at once. */
export function buildTimeNote(info: Pick<DevDocument, 'buildTime' | 'buildTimeFields'>): string {
  if (!info.buildTime) return '';
  const fields = info.buildTimeFields ?? ['*'];
  return `Some fields apply after rebuild: ${fields.includes('*') ? 'the whole file' : fields.join(', ')}`;
}

/** One document of the page: its form and what it is doing in the overlay. */
interface DocumentView {
  key: string;
  section: HTMLElement;
  error: HTMLElement;
  /** Absent when the document could not be loaded or is read-only. */
  value?: HTMLTextAreaElement;
  body?: HTMLTextAreaElement;
  /** The text the form showed when loaded, which "Reset" restores. */
  saved: { value: string; body: string };
  /** `saved`: not in the overlay. `edited`: sent as the form says. `deleted`: sent as null. */
  state: 'saved' | 'edited' | 'deleted';
}

/**
 * Wires up the test editor page (markup in editor.astro): loads the site in
 * the iframe, sends the overlay built from the forms to the bridge as you
 * type, shows render results, and handles draft image uploads. `win` and
 * `fetchImpl` are parameters so tests can pass fakes.
 */
export function startEditor(win: Window = window, fetchImpl: typeof fetch = win.fetch.bind(win)): void {
  const doc = win.document;
  const origin = win.location.origin;
  const byId = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;

  const iframe = byId<HTMLIFrameElement>('preview');
  const status = byId<HTMLElement>('status');
  const limitsList = byId<HTMLElement>('limits');
  const documentsList = byId<HTMLElement>('documents');
  const envelopeView = byId<HTMLElement>('envelope');
  const template = byId<HTMLTemplateElement>('document-template');

  /** Status line under the title; `state` ('ok' | 'error') drives its color. */
  function setStatus(text: string, state = 'ok') {
    status.textContent = text;
    status.dataset.state = state;
  }

  // ---- the overlay ----------------------------------------------------

  const views = new Map<string, DocumentView>();
  /** Keys being fetched or already tried, so a failure is not retried on every render. */
  const requested = new Set<string>();
  /** The media map: the `url` of each upload to its entry (D12). */
  const media: Record<string, MediaInfo> = {};
  /** The documents the latest render read; a form of any other is hidden. */
  let read = new Set<string>();
  /** True after a `ready` of another protocol version: nothing is sent then. */
  let mismatched = false;

  /** The text a form holds as the document's value. Throws on invalid JSON. */
  function formValue(view: DocumentView): unknown {
    const data: unknown = JSON.parse(view.value!.value);
    return view.body ? { data, body: view.body.value } : data;
  }

  /** Sends the overlay to the page: every edited document, with the media map,
   *  even when that is nothing (an empty overlay still makes the page render,
   *  which primes it). A document whose JSON is invalid is flagged and left
   *  out, not sent with its last valid value. */
  function sendDraft() {
    if (mismatched) return;
    const documents: DraftMessage['documents'] = {};
    for (const view of views.values()) {
      let problem = '';
      if (view.state === 'deleted') {
        documents[view.key] = null;
      } else if (view.state === 'edited') {
        try {
          documents[view.key] = formValue(view);
        } catch (parseError) {
          problem = (parseError as Error).message;
        }
      }
      if (problem) view.value?.setAttribute('aria-invalid', 'true');
      else view.value?.removeAttribute('aria-invalid');
      view.error.textContent = problem;
    }
    const message: DraftMessage = { type: 'preview:draft', protocol: PROTOCOL_VERSION, documents, media: { ...media } };
    envelopeView.textContent = JSON.stringify({ documents: message.documents, media: message.media }, null, 2);
    iframe.contentWindow?.postMessage(message, origin);
  }

  // Typing sends a draft after RENDER_DELAY_MS of quiet.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function scheduleDraft() {
    clearTimeout(timer);
    timer = setTimeout(sendDraft, RENDER_DELAY_MS);
  }

  // ---- the forms ------------------------------------------------------

  function addView(key: string, info: DevDocument | undefined, failure = ''): DocumentView {
    const section = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const slot = (name: string) => section.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;
    section.dataset.key = key;
    slot('key').textContent = key;
    slot('file').textContent = info ? `${info.file} (${info.format})` : '';
    const view: DocumentView = { key, section, error: slot('error'), saved: { value: '', body: '' }, state: 'saved' };

    const note = slot('note');
    const notes = [info ? buildTimeNote(info) : '', info?.editable === false ? 'Shown as built (this format is not edited here)' : '', failure].filter(Boolean);
    note.textContent = notes.join('. ');
    note.hidden = notes.length === 0;
    if (failure) note.dataset.state = 'error';

    if (info && info.editable !== false) {
      const markdown = info.format === 'md' || info.format === 'mdx';
      const raw = (info.value ?? (markdown ? { data: {}, body: '' } : {})) as { data?: unknown; body?: string };
      view.saved = markdown
        ? { value: JSON.stringify(raw.data ?? {}, null, 2), body: raw.body ?? '' }
        : { value: JSON.stringify(info.value, null, 2), body: '' };

      view.value = section.querySelector<HTMLTextAreaElement>('[data-field="value"]')!;
      view.value.setAttribute('aria-label', markdown ? `${key} frontmatter (JSON)` : `${key} (JSON)`);
      if (markdown) {
        slot('value-label').textContent = 'Frontmatter (JSON)';
        slot('body-field').hidden = false;
        view.body = section.querySelector<HTMLTextAreaElement>('[data-field="body"]')!;
        view.body.setAttribute('aria-label', `${key} body`);
      }
      writeForm(view);
      for (const textarea of [view.value, view.body]) {
        textarea?.addEventListener('input', () => {
          view.state = 'edited';
          scheduleDraft();
        });
      }
      section.querySelector('[data-action="reset"]')!.addEventListener('click', () => {
        view.state = 'saved';
        writeForm(view);
        sendDraft();
      });
      section.querySelector('[data-action="delete"]')!.addEventListener('click', () => {
        view.state = 'deleted';
        sendDraft();
      });
    } else {
      slot('fields').hidden = true;
    }

    // A document that finishes loading after a navigation may no longer be read.
    section.hidden = !read.has(key);
    views.set(key, view);
    documentsList.append(section);
    return view;
  }

  /** Puts the saved text back into the form. */
  function writeForm(view: DocumentView) {
    if (view.value) view.value.value = view.saved.value;
    if (view.body) view.body.value = view.saved.body;
  }

  /** Fetches each document the page read that the editor doesn't have yet. */
  async function loadDocument(key: string) {
    requested.add(key);
    try {
      const response = await fetchImpl(`/__dev/documents?key=${encodeURIComponent(key)}`);
      if (!response.ok) {
        addView(key, undefined, `Could not load (${response.status}): ${(await response.text()).trim()}`);
        return;
      }
      addView(key, (await response.json()) as DevDocument);
    } catch (loadError) {
      addView(key, undefined, `Could not load: ${(loadError as Error).message}`);
    }
  }

  /** Shows the forms of the documents the latest render read; the others stay
   *  hidden with their edits, which keep going out. */
  function showDocuments(keys: string[]) {
    read = new Set(keys);
    for (const view of views.values()) view.section.hidden = !read.has(view.key);
    for (const key of keys) if (!requested.has(key)) void loadDocument(key);
  }

  function showLimits(limits: string[]) {
    limitsList.replaceChildren(
      ...limits.map((limit) => {
        const item = doc.createElement('li');
        item.textContent = limitNote(limit);
        return item;
      }),
    );
    limitsList.hidden = limits.length === 0;
  }

  /** Puts each 422 field next to its document; returns the ones with no form. */
  function showFieldErrors(errors: FieldError[]): FieldError[] {
    const unmatched: FieldError[] = [];
    const lines = new Map<DocumentView, string[]>();
    for (const fieldError of errors) {
      const view = views.get(fieldError.key);
      if (!view) unmatched.push(fieldError);
      else lines.set(view, [...(lines.get(view) ?? []), `${fieldError.path.join('.')}: ${fieldError.message}`]);
    }
    for (const [view, messages] of lines) view.error.textContent = messages.join('; ');
    return unmatched;
  }

  // ---- messages from the bridge: only from the iframe, same origin, well-formed

  win.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow || event.origin !== origin) return;
    const message = event.data;
    if (!isPageMessage(message)) return;

    if (message.type === 'preview:ready') {
      // A bundle of another version (or built before the field) can't be driven.
      const mismatch = protocolMismatch(message);
      mismatched = mismatch !== null;
      if (mismatch) {
        setStatus(`${message.path}: ${mismatch}`, 'error');
        return;
      }
      // The page (re)loaded: prime it with the overlay, even an empty one, and
      // warm the Markdown renderer, in parallel.
      setStatus(`Page ready: ${message.path}`);
      sendDraft();
      void fetchImpl('/__preview/warm', { method: 'POST' }).catch(() => undefined);
    } else if (message.type === 'preview:rendered') {
      setStatus(`Rendered ${message.path} in ${message.renderMs} ms; documents: ${message.documents.join(', ') || 'none'}`);
      showLimits(message.limits);
      showDocuments(message.documents);
    } else {
      const unmatched = message.errors ? showFieldErrors(message.errors) : [];
      const fields = unmatched.map((e) => `${e.key} ${e.path.join('.')}: ${e.message}`).join('; ');
      setStatus(`${message.path} failed (${message.status}): ${message.message}${fields ? ` (${fields})` : ''}`, 'error');
    }
  });

  // ---- draft image upload ----------------------------------------------

  // POST the file to /__preview-media/new. The answer goes into the media map
  // under its `url`, which is what a document's image field holds (D12).
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
    const entry = (await response.json()) as MediaInfo;
    media[entry.url] = entry;
    uploadUrl.textContent = entry.url;
    uploadResult.hidden = false;
    setStatus(`Uploaded ${file.name}`);
    sendDraft();
  });

  byId<HTMLButtonElement>('upload-copy').addEventListener('click', () => {
    void win.navigator.clipboard?.writeText(uploadUrl.textContent ?? '');
  });

  // Load the page only now, so the listener above catches its first "ready".
  iframe.src = new URLSearchParams(win.location.search).get('page') ?? '/';
}
