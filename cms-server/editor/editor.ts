// Test editor logic (markup in index.html). It speaks the bridge's
// postMessage protocol (preview-protocol, v2) and reads the CMS API
// (PHASE-2-DESIGN 5.9): GET /api/preview-url for the iframe, GET /api/overlay
// for the starting overlay, GET /api/documents?key= for each document the page
// reads, POST /api/media for uploads, PUT /api/changes for Save and POST
// /api/publish for Publish (the calls are in api.ts, their messages in
// messages.ts; GET /api/status is polled by status.ts). A form per document: a JSON
// textbox, plus a body textarea for Markdown and MDX.

import type {
  DocumentBody,
  OverlayBody,
  SaveBody,
  SaveRequest,
} from 'cms-contract';
import {
  type DraftMessage,
  type FieldError,
  isPageMessage,
  type MediaInfo,
  PROTOCOL_VERSION,
  protocolMismatch,
} from 'preview-protocol';
import {
  getChanges,
  getDocument,
  getOverlay,
  getPreviewUrl,
  getStatus,
  publishChanges,
  saveChanges,
  uploadMedia,
  waitForNewBundle,
} from './api.ts';
import { replaceStagingUrls, stagingPaths } from './media.ts';
import {
  failureMessages,
  failureText,
  type Message,
  publishFailureMessages,
  publishMessages,
  saveMessages,
  statusMessages,
} from './messages.ts';
import {
  type PublishStatus,
  previewChanging,
  previewNotReadyText,
  publishStatusOf,
  startStatusPolling,
  withoutFailedPublish,
} from './status.ts';

export const RENDER_DELAY_MS = 120;

/** How many times a save with `rebuild` polls `GET /api/status`, one second apart, before it stops waiting. */
const REBUILD_POLL_ATTEMPTS = 60;

/** The text a form shows for a document's value: the JSON of the value, and for a Markdown document the JSON of its frontmatter and its body. */
function textOfValue(
  value: unknown,
  markdown: boolean,
): { value: string; body: string } {
  if (!markdown) return { value: JSON.stringify(value, null, 2), body: '' };
  const raw = value as { data?: unknown; body?: string };
  return {
    value: JSON.stringify(raw.data ?? {}, null, 2),
    body: raw.body ?? '',
  };
}

/** The text a form shows for a document as the bundle has it. */
function savedTextOf(info: DocumentBody): { value: string; body: string } {
  return textOfValue(info.value, info.format === 'md' || info.format === 'mdx');
}

/** A value as JSON text with each object's keys sorted, so two layouts of one value give the same text. */
function canonicalText(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) => {
    if (child === null || typeof child !== 'object' || Array.isArray(child))
      return child;
    const record = child as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = record[key];
    return sorted;
  });
}

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
  info: Pick<DocumentBody, 'buildTime' | 'buildTimeFields'>,
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
  /** `saved`: not in the overlay. `edited`: sent as the form says. `deleted`: sent as null. `gone`: the delete was saved; the form is read-only until "Restore". */
  state: 'saved' | 'edited' | 'deleted' | 'gone';
  /** The revision the next save is based on: the one the document was read at, or the one a save answered. */
  revision: string | null;
  /** What a save answered for this document: its 422 and warning messages. */
  saveError: HTMLElement;
  /** The reload and keep buttons, shown after a `409 conflict`. */
  conflictControls: HTMLElement;
  /** The "Deleted" note and the restore button, shown once a delete is saved. */
  restoreControls: HTMLElement;
  /** True from a saved delete until a save answers a revision for the document: it is not in the working copy. */
  removed: boolean;
  /** True when the Delete button locked the view (lockGone): the answer of a save made meanwhile keeps that Delete. A Reset's lock does not. */
  lockedByDelete: boolean;
  /** Set by a `409 conflict`: the revision the saved document has now. "Keep mine" takes it as the base. */
  conflict: { revision: string | null } | undefined;
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
  const changesList = byId<HTMLElement>('changes-list');

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
  let overlay: OverlayBody = { documents: {}, media: {} };
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
    info: DocumentBody | undefined,
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
      revision: info?.revision ?? null,
      saveError: slot('save-error'),
      conflictControls: slot('conflict'),
      restoreControls: slot('restore'),
      removed: false,
      lockedByDelete: false,
      conflict: undefined,
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
      view.saved = savedTextOf(info);

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
          writeForm(view);
          // A document whose delete was saved goes back to its locked state, not to a form the working copy lacks.
          if (view.removed) lockGone(view);
          else view.state = 'saved';
          sendDraft();
        });
      // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
      section
        .querySelector('[data-action="delete"]')!
        .addEventListener('click', () => {
          // Nothing to delete in a working copy that already lost it.
          if (view.removed) lockGone(view, true);
          else view.state = 'deleted';
          sendDraft();
        });
      // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
      section
        .querySelector('[data-action="reload"]')!
        .addEventListener('click', () => void reloadDocument(view));
      // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
      section
        .querySelector('[data-action="keep"]')!
        .addEventListener('click', () => keepMine(view));
      // biome-ignore lint/style/noNonNullAssertion: the template and the markup guarantee this element
      section
        .querySelector('[data-action="restore"]')!
        .addEventListener('click', () => restoreDocument(view));
    } else {
      slot('fields').hidden = true;
    }

    // A document that finishes loading after a navigation may no longer be read.
    section.hidden = !read.has(key);
    views.set(key, view);
    documentsList.append(section);
    return view;
  }

  /** A saved delete locks the form (the text, Reset and Delete) and shows "Restore"; restoring unlocks it. */
  function setGone(view: DocumentView, gone: boolean) {
    for (const control of view.section.querySelectorAll<
      HTMLTextAreaElement | HTMLButtonElement
    >('textarea, [data-action="reset"], [data-action="delete"]'))
      control.disabled = gone;
    view.restoreControls.hidden = !gone;
  }

  /** Locks a removed view's form. `byDelete` marks a lock from the Delete button, which the answer of a save made meanwhile keeps (applySaved). */
  function lockGone(view: DocumentView, byDelete = false) {
    view.state = 'gone';
    view.lockedByDelete = byDelete;
    // A render that dropped the key hid the section; a locked form must stay reachable so "Restore" is there.
    view.section.hidden = false;
    setGone(view, true);
  }

  /** "Restore": the document is created again from the form's text, by the next save (it has no revision). */
  function restoreDocument(view: DocumentView) {
    setGone(view, false);
    view.state = 'edited';
    sendDraft();
  }

  /** Puts the saved text back into the form. */
  function writeForm(view: DocumentView) {
    if (view.value) view.value.value = view.saved.value;
    if (view.body) view.body.value = view.saved.body;
  }

  /** Fetches each document the page read that the editor doesn't have yet. */
  async function loadDocument(key: string) {
    requested.add(key);
    const answer = await getDocument(fetchImpl, key);
    if (answer.ok) addView(key, answer.body);
    else addView(key, undefined, failureText('Could not load', answer.failure));
  }

  /** Loads the starting overlay. A refusal is shown and the editor starts without it. */
  async function loadOverlay() {
    const answer = await getOverlay(fetchImpl);
    if (answer.ok) {
      overlay = answer.body;
      return;
    }
    overlayProblem = failureText('Could not load the overlay', answer.failure);
    setStatus(overlayProblem, 'error');
  }

  /** Opens the preview at the page's path (the `page` parameter), via `GET /api/preview-url`.
   *  The answer gives the iframe's URL and the origin its messages come from. A refusal
   *  is shown with its message, and the iframe is not loaded. */
  async function openPreview() {
    const path = new URLSearchParams(win.location.search).get('page') ?? '/';
    const answer = await getPreviewUrl(fetchImpl, path);
    if (!answer.ok) {
      // A refusal is shown as its message; a request that got no answer, or a wrong one, says so.
      const { failure } = answer;
      setStatus(
        failure.kind === 'http'
          ? failure.text
          : `Could not open the preview: ${failure.text}`,
        'error',
      );
      return;
    }
    previewOrigin = answer.body.origin;
    // Load the page only now, so the listener above catches its first "ready". A new URL reloads the page with a fresh token.
    iframe.src = answer.body.url;
  }

  /** Shows the forms of the documents the latest render read; the others stay
   *  hidden with their edits, which keep going out. */
  function showDocuments(keys: string[]) {
    read = new Set(keys);
    // A deleted document may not be read by the page any more: its form stays, so "Restore" is there.
    for (const view of views.values())
      view.section.hidden = !read.has(view.key) && view.state !== 'gone';
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

  // ---- saving: PUT /api/changes with the forms' changes -------------------

  /** The changes the forms hold, or undefined when a form's JSON is invalid (nothing is sent then). */
  function changesOf(): SaveRequest['changes'] | undefined {
    const changes: SaveRequest['changes'][number][] = [];
    for (const view of views.values()) {
      if (view.state === 'deleted') {
        changes.push({
          document: view.key,
          baseRevision: view.revision,
          deleted: true,
        });
      } else if (view.state === 'edited') {
        try {
          changes.push({
            document: view.key,
            baseRevision: view.revision,
            data: formValue(view),
          });
        } catch {
          return undefined;
        }
      }
    }
    return changes;
  }

  /** Shows messages next to the forms they name, and the others in the status line. */
  function showMessages(messages: Message[]) {
    const lines = new Map<DocumentView, string[]>();
    const general: Message[] = [];
    for (const message of messages) {
      const view =
        message.field === undefined ? undefined : views.get(message.field);
      if (view === undefined) general.push(message);
      else lines.set(view, [...(lines.get(view) ?? []), message.text]);
    }
    for (const [view, texts] of lines)
      view.saveError.textContent = texts.join('; ');
    if (general.length > 0)
      setStatus(
        general.map((message) => message.text).join('; '),
        general.some((message) => message.level === 'error') ? 'error' : 'ok',
      );
  }

  /** Shows or hides a document's reload and keep buttons. */
  function setConflict(
    view: DocumentView,
    conflict: { revision: string | null } | undefined,
  ) {
    view.conflict = conflict;
    view.conflictControls.hidden = conflict === undefined;
    // A document missing from the working copy cannot be reloaded: only "Keep mine" (create) makes sense.
    const reload = view.section.querySelector<HTMLButtonElement>(
      '[data-action="reload"]',
    );
    if (reload) reload.hidden = conflict?.revision === null;
  }

  /** The overlay keeps a document's saved value, so a page that reloads shows what the save wrote. */
  function keepInOverlay(key: string, value: unknown) {
    overlay = { ...overlay, documents: { ...overlay.documents, [key]: value } };
  }

  /** Re-reads a saved document: its staged images take the saved paths in the form, and the saved text becomes the baseline. */
  async function refreshSaved(view: DocumentView) {
    const answer = await getDocument(fetchImpl, view.key);
    if (!answer.ok) {
      view.saveError.textContent = failureText(
        'Saved, but it could not be read again',
        answer.failure,
      );
      return;
    }
    let draft: unknown;
    try {
      draft = formValue(view);
    } catch {
      draft = undefined;
    }
    const paths = stagingPaths(draft, answer.body.value, (url) =>
      Object.hasOwn(media, url),
    );
    if (view.value)
      view.value.value = replaceStagingUrls(view.value.value, paths);
    if (view.body) view.body.value = replaceStagingUrls(view.body.value, paths);
    view.saved = savedTextOf(answer.body);
    // The forms may hold another layout of the saved value (compact JSON, other key order): compare the values, not the text.
    let same = false;
    try {
      same =
        canonicalText(formValue(view)) === canonicalText(answer.body.value);
    } catch {
      same = false;
    }
    // A Delete made while the save was pending stays for the next save (applySaved sets it on a view it unlocks); any other view takes the comparison.
    if (view.state !== 'deleted') view.state = same ? 'saved' : 'edited';
    keepInOverlay(view.key, answer.body.value);
  }

  /** "Reload": takes the saved version of a document, which drops the draft text. */
  async function reloadDocument(view: DocumentView) {
    const answer = await getDocument(fetchImpl, view.key);
    if (!answer.ok) {
      view.saveError.textContent = failureText(
        'Could not reload',
        answer.failure,
      );
      return;
    }
    view.revision = answer.body.revision;
    view.saved = savedTextOf(answer.body);
    if (view.state === 'gone') setGone(view, false);
    view.state = 'saved';
    writeForm(view);
    keepInOverlay(view.key, answer.body.value);
    setConflict(view, undefined);
    view.saveError.textContent = '';
    sendDraft();
  }

  /** "Keep mine": the next save is based on the newer revision, so it overwrites the other change. */
  function keepMine(view: DocumentView) {
    if (view.conflict === undefined) return;
    const gone = view.conflict.revision === null;
    view.revision = view.conflict.revision;
    setConflict(view, undefined);
    if (view.state === 'gone') {
      // Locked during its save: a live document keeps a Delete made meanwhile (a Reset's lock keeps the text), and a missing one is created from the kept text.
      setGone(view, false);
      view.state = !gone && view.lockedByDelete ? 'deleted' : 'edited';
      // The lock sent null for the document; the kept text or the Delete goes out now.
      sendDraft();
    } else if (view.state === 'saved') {
      // A saved view is not sent by a save, so the kept text becomes an edit and the next save sends it.
      view.state = 'edited';
      // The overlay may hold null for it (a saved delete), so the preview gets the kept text now.
      sendDraft();
    }
    if (gone && view.state === 'deleted') {
      // Someone else already deleted it: the draft delete has nothing to delete, so the form locks as after a saved delete.
      view.removed = true;
      lockGone(view);
      keepInOverlay(view.key, null);
      sendDraft();
      view.saveError.textContent =
        'The document is already gone from the working copy. Restore it to create it again.';
      return;
    }
    if (view.state === 'deleted') {
      view.saveError.textContent =
        'Your delete is kept. Save again to delete the newer version.';
      return;
    }
    view.saveError.textContent = gone
      ? 'The document is gone from the working copy. Save again to create it.'
      : 'Your version is kept. Save again to overwrite the newer one.';
  }

  /** Shows the documents that differ from the merge base (GET /api/changes). */
  async function refreshChanges() {
    const answer = await getChanges(fetchImpl);
    const lines = answer.ok
      ? [
          ...answer.body.documents.map(
            (entry) => `${entry.status}: ${entry.key}`,
          ),
          ...answer.body.fileErrors.map(
            (file) => `${file.path}: ${file.error.message}`,
          ),
        ]
      : [failureText('Could not load the changes', answer.failure)];
    changesList.replaceChildren(
      ...(lines.length === 0 ? ['No changes'] : lines).map((text) => {
        const item = doc.createElement('li');
        item.textContent = text;
        return item;
      }),
    );
  }

  /** A save with `rebuild` applies after the next build: waits for the bundle to change, then loads the preview again. Its status line is written only while `attempt` is the latest save. */
  async function followRebuild(
    bundleBefore: string | null | undefined,
    attempt: number,
  ) {
    const isLatest = () => attempt === latestSave;
    // Without a status from before the save there is nothing to compare the build with: the wait would end at once.
    if (bundleBefore === undefined) {
      if (isLatest())
        setStatus(
          'Saved, but the new build could not be checked. Reload the editor later.',
          'error',
        );
      return;
    }
    const changed = await waitForNewBundle(
      fetchImpl,
      bundleBefore ?? undefined,
      REBUILD_POLL_ATTEMPTS,
    );
    if (changed) await openPreview();
    else if (isLatest())
      setStatus(
        'The new build is not ready yet. Reload the editor later.',
        'error',
      );
  }

  /** What a saved answer changes: the revisions, the re-read documents, the list, and the rebuild. */
  async function applySaved(
    body: SaveBody,
    bundleBefore: string | null | undefined,
    attempt: number,
    changes: SaveRequest['changes'],
  ) {
    showMessages(saveMessages(body));
    // The documents this save deletes. One marked deleted while the save is pending is not among them.
    const deleting = new Set(
      changes.flatMap((change) =>
        change.deleted === true ? [change.document] : [],
      ),
    );
    // What each document held when the save sent it: the baseline of its form until the re-read answers.
    const sent = new Map<string, unknown>(
      changes.map((change) => [change.document, change.data] as const),
    );
    // A document the save deleted is not in the answer's revisions: it is gone, so its view leaves the deleted state and holds no revision. Its form keeps what was typed during the save, and Restore sends it again.
    let deletedHere = false;
    for (const view of views.values()) {
      if (!deleting.has(view.key)) continue;
      view.removed = true;
      view.revision = null;
      keepInOverlay(view.key, null);
      lockGone(view);
      deletedHere = true;
    }
    if (deletedHere) sendDraft();
    let unlocked = false;
    for (const [key, revision] of Object.entries(body.revisions)) {
      const view = views.get(key);
      if (view === undefined) continue;
      view.revision = revision;
      view.removed = false;
      // A view locked during its save opens: the save made the document live. A Delete made meanwhile stays for the next save; a Reset's lock takes the comparison in refreshSaved.
      if (view.state === 'gone') {
        setGone(view, false);
        view.state = view.lockedByDelete ? 'deleted' : 'edited';
        unlocked = true;
      }
      // The text the save sent is the baseline until the re-read answers, so a failed re-read keeps Reset and the overlay on what was saved.
      const data = sent.get(key);
      if (data !== undefined) {
        view.saved = textOfValue(data, view.body !== undefined);
        keepInOverlay(key, data);
      }
      await refreshSaved(view);
    }
    // The lock sent null for an unlocked document; the overlay now holds what the save made live.
    if (unlocked) sendDraft();
    await refreshChanges();
    // Not awaited: the wait for the build runs on while the user saves again.
    if (body.rebuild) void followRebuild(bundleBefore, attempt);
  }

  const saveButton = byId<HTMLButtonElement>('save');
  const publishButton = byId<HTMLButtonElement>('publish');
  const publishStatus = byId<HTMLElement>('publish-status');
  const publishResult = byId<HTMLElement>('publish-result');
  // Counts the PUTs sent; a rebuild wait of an older save does not write the status line.
  let latestSave = 0;
  /** True while a save's own requests run. */
  let saving = false;
  /** True while this page's Publish request runs. */
  let publishing = false;
  /** True while GET /api/status reports a publish running. */
  let publishRunning = false;
  /** The preview node's state as GET /api/status last reported it; undefined before a report with a node part. */
  let previewNode: PublishStatus['node'];

  /** Sets Save and Publish. Both are off while a publish runs (the drafts stay as they are), and Save is off during its own requests. Save is also off while the preview node is not ready: the preview refuses a save then, and its tooltip says why. */
  function refreshButtons() {
    const busy = publishing || publishRunning;
    const notReady = previewNotReadyText(previewNode);
    saveButton.disabled = busy || saving || notReady !== '';
    saveButton.title = notReady;
    publishButton.disabled = busy;
  }

  /** Writes messages into a status element: their texts joined, and its state the worst level among them. It is hidden when there are none. */
  function showLines(element: HTMLElement, messages: Message[]) {
    let state = 'ok';
    if (messages.some((message) => message.level === 'warning'))
      state = 'warning';
    if (messages.some((message) => message.level === 'error')) state = 'error';
    element.textContent = messages.map((message) => message.text).join('; ');
    element.dataset.state = state;
    element.hidden = messages.length === 0;
  }

  /** Saves the forms. Save is off while the save's own requests run; a rebuild wait does not hold it (saves go on during a build). */
  async function save() {
    saving = true;
    refreshButtons();
    try {
      await saveForms();
    } finally {
      saving = false;
      refreshButtons();
    }
  }

  /** Saves every form that differs from its saved text (PUT /api/changes). The bundle before the save is the one a rebuild replaces. */
  async function saveForms() {
    for (const view of views.values()) view.saveError.textContent = '';
    const changes = changesOf();
    if (changes === undefined) {
      setStatus('Fix the invalid JSON before you save', 'error');
      return;
    }
    if (changes.length === 0) {
      setStatus('Nothing to save');
      return;
    }
    const before = await getStatus(fetchImpl);
    const bundleBefore = before.ok
      ? (before.body.bundle?.bundleId ?? null)
      : undefined;
    // Only a PUT counts as a newer save, whatever its answer: its message replaces the older wait's status.
    const attempt = ++latestSave;
    const answer = await saveChanges(fetchImpl, { changes });
    if (!answer.ok) {
      if (answer.failure.code === 'conflict')
        for (const doc of answer.failure.body.documents) {
          const view = views.get(doc.key);
          if (view) {
            setConflict(view, { revision: doc.revision });
            // A live revision: the document exists on the server, so the flag of a saved delete no longer holds.
            if (doc.revision !== null) view.removed = false;
          }
        }
      // A failure with only field messages writes nothing to the status line, which would keep an older save's text.
      setStatus(
        'The save did not happen. See the messages next to the forms.',
        'error',
      );
      showMessages(failureMessages(answer.failure));
      return;
    }
    await applySaved(answer.body, bundleBefore, attempt, changes);
  }

  // ---- publishing: POST /api/publish, and the publish state from GET /api/status

  /** True from a failed publish of this page until its next publish starts. The status line then leaves out the failed text, which that publish's answer shows (polls included). */
  let lastPublishFailed = false;
  /** The stop of the status poll while one runs, or undefined. At most one poll runs. */
  let stopPoll: (() => void) | undefined;

  /** Starts the poll of GET /api/status, unless one runs or the page is hidden. The poll reads at once, then every second while something runs and every 5 s while nothing does. `busy` is the state the caller last saw. */
  function startPoll(busy = false) {
    if (stopPoll !== undefined || document.visibilityState === 'hidden') return;
    stopPoll = startStatusPolling({
      fetchImpl,
      onChange: onPublishStatus,
      // A poll read that reports a publish running is a later publish: its failure is shown, even when the read is unchanged.
      onRead: (status) => {
        if (status.state === 'publishing') lastPublishFailed = false;
      },
      initiallyBusy: busy,
    });
  }

  /** Ends the poll, if one runs. The next start reads the status at once. */
  function endPoll() {
    stopPoll?.();
    stopPoll = undefined;
  }

  // A hidden page is not polled. When it is visible again, the poll starts and reads at once.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') endPoll();
    else startPoll();
  });

  /** Shows the publish state the status reports and sets the buttons. Called each time the reported state changes. */
  function onPublishStatus(status: PublishStatus) {
    // A publish that runs now (another tab's, or one this page's refused answer reveals) is a later publish: its failure is shown.
    if (status.state === 'publishing') lastPublishFailed = false;
    const shown = lastPublishFailed ? withoutFailedPublish(status) : status;
    publishRunning = shown.state === 'publishing';
    previewNode = shown.node;
    refreshButtons();
    showLines(publishStatus, statusMessages(shown));
  }

  /** Publishes the saved changes. Publish is off while it runs. Its answer is shown next to the button; after a commit the changes list is read again. */
  async function publish() {
    publishing = true;
    lastPublishFailed = false;
    refreshButtons();
    showLines(publishResult, []);
    try {
      const answer = await publishChanges(fetchImpl);
      if (answer.ok) {
        showLines(publishResult, publishMessages(answer.body));
        await refreshChanges();
      } else {
        // A refusal at the gate did not run this publish, so a failed state in the status comes from an earlier one: it stays shown.
        lastPublishFailed =
          answer.failure.code !== 'publish-in-progress' &&
          answer.failure.code !== 'busy';
        showLines(publishResult, publishFailureMessages(answer.failure));
      }
      // The publish may have cleared a failed state or an upstream build error: read the status now, not at the next reload.
      // The poll is ended first, so a read it sent earlier cannot answer after this one.
      endPoll();
      const status = await getStatus(fetchImpl);
      let busy = false;
      if (status.ok) {
        const shown = publishStatusOf(status.body);
        onPublishStatus(shown);
        busy = shown.state === 'publishing' || previewChanging(shown);
      }
      // The poll starts again from here: at the busy interval if the status is busy, after its idle wait otherwise.
      startPoll(busy);
    } finally {
      publishing = false;
      refreshButtons();
    }
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
    const answer = await uploadMedia(fetchImpl, file);
    if (!answer.ok) {
      setStatus(failureText('Upload failed', answer.failure), 'error');
      return;
    }
    const entry = answer.body;
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
  });

  byId<HTMLButtonElement>('upload-copy').addEventListener('click', () => {
    void win.navigator.clipboard?.writeText(uploadUrl.textContent ?? '');
  });

  saveButton.addEventListener('click', () => void save());
  publishButton.addEventListener('click', () => void publish());

  // The overlay first, so the page's first "ready" finds it in place. The
  // listener above is registered before any load, so no message is missed.
  await loadOverlay();
  await openPreview();
  // Reads the publish state now (a page reloaded during a publish keeps the buttons off, and a failed publish keeps its error),
  // then again each second while a publish runs (status.ts).
  startPoll();
}

// The page's script starts the editor once its markup is in place. Tests import
// this module without that markup, so nothing starts then.
if (document.getElementById('preview')) void startEditor();
