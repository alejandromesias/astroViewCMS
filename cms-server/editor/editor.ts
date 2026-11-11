// Test editor logic (markup in index.html). It speaks the bridge's
// postMessage protocol (preview-protocol, v2) and reads the CMS API
// (PHASE-2-DESIGN 5.9): GET /api/preview-url for the iframe, GET /api/overlay
// for the starting overlay, GET /api/documents?key= for each document the page
// reads, and POST /api/media for uploads. A form per document: a JSON textbox,
// plus a body textarea for Markdown and MDX.

import type { RenderRequest } from 'preview-contract';
import {
  type DraftMessage,
  type FieldError,
  isPageMessage,
  type MediaInfo,
  PROTOCOL_VERSION,
  protocolMismatch,
} from 'preview-protocol';

// The CMS API's answers as the editor reads them (PHASE-2-DESIGN 5.9). Each is
// checked before use: a wrong shape is an error, not a cast (IMPLEMENTATION-
// RECOMMENDATIONS 2). Local copies: cms-server never imports the renderer (5.11).

/** The body of `GET /api/documents?key=` (5.3). */
interface EditorDocument {
  key: string;
  file: string;
  format: string;
  editable: boolean;
  buildTime: boolean;
  buildTimeFields?: string[];
  revision: string;
  value?: unknown;
}

/** The answer of `GET /api/preview-url?path=`. */
interface PreviewUrl {
  url: string;
  origin: string;
}

/** The value as a record of unknown fields, or `undefined` when it is not an object. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isEditorDocument(value: unknown): value is EditorDocument {
  const info = recordOf(value);
  return (
    info !== undefined &&
    typeof info.key === 'string' &&
    typeof info.file === 'string' &&
    typeof info.format === 'string' &&
    typeof info.editable === 'boolean' &&
    typeof info.buildTime === 'boolean' &&
    typeof info.revision === 'string' &&
    (info.buildTimeFields === undefined ||
      Array.isArray(info.buildTimeFields)) &&
    hasEditableValue(info)
  );
}

/** The server sends `value` for every editable document (bundle-routes.ts 195), and a Markdown value is an object (`{ data, body }`). */
function hasEditableValue(info: Record<string, unknown>): boolean {
  if (!info.editable) return true;
  if (info.format === 'md' || info.format === 'mdx')
    return recordOf(info.value) !== undefined;
  return info.value !== undefined;
}

function isPreviewUrl(value: unknown): value is PreviewUrl {
  const answer = recordOf(value);
  return (
    answer !== undefined &&
    typeof answer.url === 'string' &&
    typeof answer.origin === 'string'
  );
}

/** The answer of `POST /api/media` (5.9), as the media map keeps it. The answer's id is not needed. */
function isUploadAnswer(value: unknown): value is MediaInfo {
  const answer = recordOf(value);
  return (
    answer !== undefined &&
    typeof answer.url === 'string' &&
    typeof answer.width === 'number' &&
    typeof answer.height === 'number' &&
    typeof answer.format === 'string'
  );
}

/** The answer of `GET /api/overlay`: the `RenderRequest` the render route takes. */
function isOverlay(value: unknown): value is RenderRequest {
  const answer = recordOf(value);
  return (
    answer !== undefined &&
    recordOf(answer.documents) !== undefined &&
    recordOf(answer.media) !== undefined
  );
}

/** Reads a JSON answer and checks its shape; throws when the shape is wrong. */
async function readAnswer<T>(
  response: Response,
  isShape: (value: unknown) => value is T,
): Promise<T> {
  const body: unknown = await response.json();
  if (!isShape(body)) throw new Error('the answer has the wrong shape');
  return body;
}

/** The text of a failed answer: its `message` when it is a JSON `{ error, message }`, else the body. */
async function answerMessage(response: Response): Promise<string> {
  const text = (await response.text()).trim();
  try {
    const message = recordOf(JSON.parse(text))?.message;
    if (typeof message === 'string') return message;
  } catch {
    // Not JSON: the text itself is the message.
  }
  return text;
}

export const RENDER_DELAY_MS = 120;

const LIMIT_NOTES: Record<string, string> = {
  'mdx-body': 'MDX body: preview after save',
  'schema-refinement': 'a schema refinement could not run',
  'markdown-plugins': 'Markdown plugins failed, shown without them',
};

/** What a `limits` value of a render means for the author; unknown values are
 *  shown as they are. */
export function limitNote(limit: string): string {
  // biome-ignore lint/style/noNonNullAssertion: guarded by Object.hasOwn above
  if (Object.hasOwn(LIMIT_NOTES, limit)) return LIMIT_NOTES[limit]!;
  if (limit.startsWith('code-language:'))
    return `\`${limit.slice('code-language:'.length)}\` highlighted after publish`;
  return limit;
}

/** The build-time warning of a document (D1), or '' for one that applies at once. */
export function buildTimeNote(
  info: Pick<EditorDocument, 'buildTime' | 'buildTimeFields'>,
): string {
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
 * Wires up the test editor page (markup in index.html): loads the site in
 * the iframe, sends the overlay built from the forms to the bridge as you
 * type, shows render results, and handles draft image uploads. `win` and
 * `fetchImpl` are parameters so tests can pass fakes. Resolves once the
 * starting overlay is in and the preview is open (or refused).
 */
export async function startEditor(
  win: Window = window,
  fetchImpl: typeof fetch = win.fetch.bind(win),
): Promise<void> {
  const doc = win.document;
  const byId = <T extends HTMLElement>(id: string) =>
    doc.getElementById(id) as T;

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
  /** The origin of the preview, from its answer; undefined until the preview is open. */
  let previewOrigin: string | undefined;
  /** The starting overlay from `GET /api/overlay`, which the drafts win over. */
  let overlay: RenderRequest = { documents: {}, media: {} };
  /** Why the starting overlay is missing, or '' when it loaded. It stays in the status line when the page is ready. */
  let overlayProblem = '';

  /** The text a form holds as the document's value. Throws on invalid JSON. */
  function formValue(view: DocumentView): unknown {
    // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
    const data: unknown = JSON.parse(view.value!.value);
    return view.body ? { data, body: view.body.value } : data;
  }

  /** Sends the overlay to the page: the starting overlay, with the edited
   *  documents on top and the media maps merged, even when that is nothing (an
   *  empty overlay still makes the page render, which primes it). A document
   *  whose JSON is invalid is flagged and left out of the drafts, not sent with
   *  its last valid value. Nothing is sent before the preview is open. */
  function sendDraft() {
    if (mismatched || previewOrigin === undefined) return;
    const documents: DraftMessage['documents'] = { ...overlay.documents };
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
    const message: DraftMessage = {
      type: 'preview:draft',
      protocol: PROTOCOL_VERSION,
      documents,
      media: { ...overlay.media, ...media },
    };
    envelopeView.textContent = JSON.stringify(
      { documents: message.documents, media: message.media },
      null,
      2,
    );
    iframe.contentWindow?.postMessage(message, previewOrigin);
  }

  // Typing sends a draft after RENDER_DELAY_MS of quiet.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function scheduleDraft() {
    clearTimeout(timer);
    timer = setTimeout(sendDraft, RENDER_DELAY_MS);
  }

  // ---- the forms ------------------------------------------------------

  function addView(
    key: string,
    info: EditorDocument | undefined,
    failure = '',
  ): DocumentView {
    // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
    const section = template.content.firstElementChild!.cloneNode(
      true,
    ) as HTMLElement;
    const slot = (name: string) =>
      // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
      section.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;
    section.dataset.key = key;
    slot('key').textContent = key;
    slot('file').textContent = info ? `${info.file} (${info.format})` : '';
    const view: DocumentView = {
      key,
      section,
      error: slot('error'),
      saved: { value: '', body: '' },
      state: 'saved',
    };

    const note = slot('note');
    const notes = [
      info ? buildTimeNote(info) : '',
      info && !info.editable
        ? 'Shown as built (this format is not edited here)'
        : '',
      failure,
    ].filter(Boolean);
    note.textContent = notes.join('. ');
    note.hidden = notes.length === 0;
    if (failure) note.dataset.state = 'error';

    if (info?.editable) {
      const markdown = info.format === 'md' || info.format === 'mdx';
      const raw = info.value as { data?: unknown; body?: string };
      view.saved = markdown
        ? {
            value: JSON.stringify(raw.data ?? {}, null, 2),
            body: raw.body ?? '',
          }
        : { value: JSON.stringify(info.value, null, 2), body: '' };

      // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
      view.value = section.querySelector<HTMLTextAreaElement>(
        '[data-field="value"]',
      )!;
      view.value.setAttribute(
        'aria-label',
        markdown ? `${key} frontmatter (JSON)` : `${key} (JSON)`,
      );
      if (markdown) {
        slot('value-label').textContent = 'Frontmatter (JSON)';
        slot('body-field').hidden = false;
        // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
        view.body = section.querySelector<HTMLTextAreaElement>(
          '[data-field="body"]',
        )!;
        view.body.setAttribute('aria-label', `${key} body`);
      }
      writeForm(view);
      for (const textarea of [view.value, view.body]) {
        textarea?.addEventListener('input', () => {
          view.state = 'edited';
          scheduleDraft();
        });
      }
      // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
      section
        .querySelector('[data-action="reset"]')!
        .addEventListener('click', () => {
          view.state = 'saved';
          writeForm(view);
          sendDraft();
        });
      // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
      section
        .querySelector('[data-action="delete"]')!
        .addEventListener('click', () => {
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
      const response = await fetchImpl(
        `/api/documents?key=${encodeURIComponent(key)}`,
      );
      if (!response.ok) {
        addView(
          key,
          undefined,
          `Could not load (${response.status}): ${await answerMessage(response)}`,
        );
        return;
      }
      addView(key, await readAnswer(response, isEditorDocument));
    } catch (loadError) {
      addView(
        key,
        undefined,
        `Could not load: ${(loadError as Error).message}`,
      );
    }
  }

  /** Loads the starting overlay. A refusal is shown and the editor starts without it. */
  async function loadOverlay() {
    try {
      const response = await fetchImpl('/api/overlay');
      if (!response.ok) {
        overlayProblem = `Could not load the overlay (${response.status}): ${await answerMessage(response)}`;
        setStatus(overlayProblem, 'error');
        return;
      }
      overlay = await readAnswer(response, isOverlay);
    } catch (loadError) {
      overlayProblem = `Could not load the overlay: ${(loadError as Error).message}`;
      setStatus(overlayProblem, 'error');
    }
  }

  /** Opens the preview at the page's path (the `page` parameter), via `GET /api/preview-url`.
   *  The answer gives the iframe's URL and the origin its messages come from. A refusal
   *  is shown with its message, and the iframe is not loaded. */
  async function openPreview() {
    const path = new URLSearchParams(win.location.search).get('page') ?? '/';
    try {
      const response = await fetchImpl(
        `/api/preview-url?path=${encodeURIComponent(path)}`,
      );
      if (!response.ok) {
        setStatus(await answerMessage(response), 'error');
        return;
      }
      const preview = await readAnswer(response, isPreviewUrl);
      previewOrigin = preview.origin;
      // Load the page only now, so the listener above catches its first "ready".
      iframe.src = preview.url;
    } catch (loadError) {
      setStatus(
        `Could not open the preview: ${(loadError as Error).message}`,
        'error',
      );
    }
  }

  /** Shows the forms of the documents the latest render read; the others stay
   *  hidden with their edits, which keep going out. */
  function showDocuments(keys: string[]) {
    read = new Set(keys);
    for (const view of views.values())
      view.section.hidden = !read.has(view.key);
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
      else
        lines.set(view, [
          ...(lines.get(view) ?? []),
          `${fieldError.path.join('.')}: ${fieldError.message}`,
        ]);
    }
    for (const [view, messages] of lines)
      view.error.textContent = messages.join('; ');
    return unmatched;
  }

  // ---- messages from the bridge: only from the iframe, from the preview origin, well-formed

  win.addEventListener('message', (event) => {
    if (
      previewOrigin === undefined ||
      event.source !== iframe.contentWindow ||
      event.origin !== previewOrigin
    )
      return;
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
      // The page (re)loaded: prime it with the overlay, even an empty one. The
      // server warms the renderer when it hands out the preview URL (5.8).
      if (overlayProblem)
        setStatus(`${overlayProblem}. Page ready: ${message.path}`, 'error');
      else setStatus(`Page ready: ${message.path}`);
      sendDraft();
    } else if (message.type === 'preview:rendered') {
      // The priming draft renders right after ready, so the overlay refusal stays on this line too.
      const rendered = `Rendered ${message.path} in ${message.renderMs} ms; documents: ${message.documents.join(', ') || 'none'}`;
      if (overlayProblem) setStatus(`${overlayProblem}. ${rendered}`, 'error');
      else setStatus(rendered);
      showLimits(message.limits);
      showDocuments(message.documents);
    } else {
      const unmatched = message.errors ? showFieldErrors(message.errors) : [];
      const fields = unmatched
        .map((e) => `${e.key} ${e.path.join('.')}: ${e.message}`)
        .join('; ');
      setStatus(
        `${message.path} failed (${message.status}): ${message.message}${fields ? ` (${fields})` : ''}`,
        'error',
      );
    }
  });

  // ---- draft image upload ----------------------------------------------

  // POST the file to /api/media (5.9). The answer goes into the media map under
  // its `url`, which is what a document's image field holds (D12).
  const upload = byId<HTMLInputElement>('upload');
  const uploadResult = byId<HTMLElement>('upload-result');
  const uploadUrl = byId<HTMLElement>('upload-url');

  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    if (!file) return;
    try {
      const response = await fetchImpl('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!response.ok) {
        setStatus(
          `Upload failed (${response.status}): ${await answerMessage(response)}`,
          'error',
        );
        return;
      }
      const entry = await readAnswer(response, isUploadAnswer);
      // Only the MediaInfo fields: the answer's id is not part of the overlay.
      media[entry.url] = {
        url: entry.url,
        width: entry.width,
        height: entry.height,
        format: entry.format,
      };
      uploadUrl.textContent = entry.url;
      uploadResult.hidden = false;
      setStatus(`Uploaded ${file.name}`);
      sendDraft();
    } catch (uploadError) {
      setStatus(`Upload failed: ${(uploadError as Error).message}`, 'error');
    }
  });

  byId<HTMLButtonElement>('upload-copy').addEventListener('click', () => {
    void win.navigator.clipboard?.writeText(uploadUrl.textContent ?? '');
  });

  // The overlay first, so the page's first "ready" finds it in place. The
  // listener above is registered before any load, so no message is missed.
  await loadOverlay();
  await openPreview();
}

// The page's script starts the editor once its markup is in place. Tests import
// this module without that markup, so nothing starts then.
if (document.getElementById('preview')) void startEditor();
