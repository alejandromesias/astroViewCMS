// Preview bridge: runs in every page of a preview build (injected by
// src/integration.ts), inactive unless the page is inside an iframe. It's the
// browser half of POST /__preview/render: the editor (any editor) talks to it
// with postMessage (see ../protocol.ts), it asks its own origin to render the
// page it is on with the editor's overlay, and patches the answer into the
// live page (patch.ts).
//
// Pattern from Tina's bridge (@tinacms/bridge region-refresh.ts, Apache-2.0).
import { isDraftMessage, type DraftMessage, type PageMessage, type RenderResponse, type ValidationResponse } from '../protocol.ts';
import { createPatcher } from './patch.ts';

export interface BridgeOptions {
  /** Origins besides the page's own that may drive it (the editor's). Never `'*'`. */
  editorOrigins?: string[];
}

/**
 * Starts the bridge. It announces the page with `preview:ready` (the editor
 * answers with a draft, even an empty one, which primes the page: it may be
 * older than the saved content, and the answer tells the editor which
 * documents the page reads), then renders and patches on every
 * `preview:draft`. After a ClientRouter navigation it announces the new path.
 *
 * `win` and `fetchImpl` are parameters so tests can pass fakes. Returns a
 * function that stops it, or null when the page isn't in an iframe (the
 * bridge is then inactive, so previews opened directly behave like the site).
 */
export function startBridge(
  win: Window & typeof globalThis = window,
  fetchImpl: typeof fetch = win.fetch.bind(win),
  options: BridgeOptions = {},
): (() => void) | null {
  if (win.parent === win) return null;

  const doc = win.document;
  const allowed = new Set([win.location.origin, ...(options.editorOrigins ?? [])]);
  const patcher = createPatcher(win);
  // The origin of the editor that last spoke to us; answers go there.
  let editorOrigin = win.location.origin;
  let requestCount = 0;

  const currentPath = () => win.location.pathname + win.location.search;
  const send = (message: PageMessage, targets: Iterable<string> = [editorOrigin]) => {
    for (const target of targets) win.parent.postMessage(message, target);
  };

  async function onDraft(message: DraftMessage) {
    const path = currentPath();
    // Newest draft wins, per page: a slow answer to an older one is dropped.
    const id = ++requestCount;
    try {
      const response = await fetchImpl(`/__preview/render?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: message.documents, media: message.media }),
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const text = await response.text();
      if (id !== requestCount) return;
      if (!response.ok) {
        // Failures keep the last good page and go to the editor.
        send(failure(path, response.status, text));
        return;
      }
      const rendered = JSON.parse(text) as RenderResponse;
      patcher.patch(rendered.html);
      send({ type: 'preview:rendered', path, documents: rendered.documents, limits: rendered.limits, renderMs: rendered.renderMs });
    } catch (error) {
      if (id !== requestCount) return;
      send({ type: 'preview:error', path, status: 0, message: String(error) });
    }
  }

  // One message from the editor: only from the parent window, from an
  // allowed origin, and well-formed.
  const onMessage = (event: MessageEvent) => {
    if (event.source !== win.parent || !allowed.has(event.origin)) return;
    if (!isDraftMessage(event.data)) return;
    editorOrigin = event.origin;
    void onDraft(event.data);
  };

  // A ClientRouter navigation replaced the document: tell the editor where we are.
  const onNavigated = () => {
    // An answer still in flight belongs to the old page: drop it.
    requestCount++;
    patcher.reset();
    send({ type: 'preview:ready', path: currentPath() }, allowed);
  };

  // Start listening before announcing, so a draft sent in reply isn't missed.
  win.addEventListener('message', onMessage);
  doc.addEventListener('astro:page-load', onNavigated);
  // To every allowed origin: the editor's is not known until it speaks, and a
  // message only arrives where the target origin matches the parent's.
  send({ type: 'preview:ready', path: currentPath() }, allowed);
  return () => {
    win.removeEventListener('message', onMessage);
    doc.removeEventListener('astro:page-load', onNavigated);
  };
}

/** An error answer of the render route as the editor gets it. */
function failure(path: string, status: number, body: string): PageMessage {
  if (status === 422) {
    try {
      const { errors } = JSON.parse(body) as ValidationResponse;
      return { type: 'preview:error', path, status, message: 'A draft does not fit its schema', errors };
    } catch {
      // Not the usual JSON: fall through to the plain message.
    }
  }
  return { type: 'preview:error', path, status, message: body.slice(0, 500) };
}
