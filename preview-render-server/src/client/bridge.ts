// Preview bridge: runs in every page of a preview build (injected by
// src/integration.ts), inactive unless the page is inside an iframe. It's the
// browser half of POST /__preview/render: the editor (any editor) talks to it
// with postMessage (see preview-protocol), it asks its own origin to render the
// page it is on with the editor's overlay, and patches the answer into the
// live page (patch.ts).
//
// Pattern from Tina's bridge (@tinacms/bridge region-refresh.ts, Apache-2.0).
import {
  type DraftMessage,
  isDraftMessage,
  type PageMessage,
  PROTOCOL_VERSION,
  protocolMismatch,
  type RenderResponse,
  type ValidationResponse,
} from 'preview-protocol';
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
  const allowed = new Set([
    win.location.origin,
    ...(options.editorOrigins ?? []),
  ]);
  const patcher = createPatcher(win);
  // The origin of the editor that last spoke to us; answers go there.
  let editorOrigin = win.location.origin;
  let requestCount = 0;

  const currentPath = () =>
    pathWithoutToken(win.location.pathname + win.location.search);
  const send = (
    message: PageMessage,
    targets: Iterable<string> = [editorOrigin],
  ) => {
    for (const target of targets) win.parent.postMessage(message, target);
  };

  async function onDraft(message: DraftMessage) {
    const path = currentPath();
    const mismatch = protocolMismatch(message);
    if (mismatch) {
      requestCount++; // an answer in flight is stale now
      send({ type: 'preview:error', path, status: 0, message: mismatch });
      return;
    }
    // Newest draft wins, per page: a slow answer to an older one is dropped.
    const id = ++requestCount;
    try {
      const response = await fetchImpl(
        `/__preview/render?path=${encodeURIComponent(path)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documents: message.documents,
            media: message.media,
          }),
          cache: 'no-store',
          credentials: 'same-origin',
        },
      );
      const text = await response.text();
      if (id !== requestCount) return;
      if (!response.ok) {
        // Failures keep the last good page and go to the editor.
        send(failure(path, response.status, text));
        return;
      }
      const rendered = JSON.parse(text) as RenderResponse;
      const summary = patcher.patch(rendered.html);
      console.info('[preview-bridge] patched', path, {
        changed: summary.changed,
        sent: Object.keys(message.documents),
        read: rendered.documents.length,
        limits: rendered.limits,
        renderMs: rendered.renderMs,
      });
      send({
        type: 'preview:rendered',
        path,
        documents: rendered.documents,
        limits: rendered.limits,
        renderMs: rendered.renderMs,
      });
    } catch (error) {
      if (id !== requestCount) return;
      console.error('[preview-bridge] draft failed', path, error);
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

  // The path the editor was last told about.
  let announcedPath = currentPath();
  // A ClientRouter navigation replaced the document: tell the editor where we are.
  const onNavigated = () => {
    const path = currentPath();
    // An answer still in flight belongs to the old page: drop it. A repeat
    // `ready` for the same path (the second one of a first load, D14) keeps it,
    // or a draft sent between the two readies would be lost.
    if (path !== announcedPath) requestCount++;
    announcedPath = path;
    patcher.reset();
    send({ type: 'preview:ready', path, protocol: PROTOCOL_VERSION }, allowed);
  };

  // Start listening before announcing, so a draft sent in reply isn't missed.
  win.addEventListener('message', onMessage);
  doc.addEventListener('astro:page-load', onNavigated);
  // To every allowed origin: the editor's is not known until it speaks, and a
  // message only arrives where the target origin matches the parent's.
  send(
    { type: 'preview:ready', path: currentPath(), protocol: PROTOCOL_VERSION },
    allowed,
  );
  return () => {
    win.removeEventListener('message', onMessage);
    doc.removeEventListener('astro:page-load', onNavigated);
  };
}

/**
 * The path with its `token` parameters removed (D14): the token that the node
 * exchanges for a cookie must never reach a postMessage. The other parameters
 * keep their order and their encoding. A path without a token comes back
 * unchanged, empty `?` and empty parts included.
 */
export function pathWithoutToken(path: string): string {
  const cut = path.indexOf('?');
  if (cut < 0) return path;
  const parts = path.slice(cut + 1).split('&');
  if (!parts.some((part) => queryName(part) === 'token')) return path;
  const kept = parts.filter(
    (part) => part !== '' && queryName(part) !== 'token',
  );
  return path.slice(0, cut) + (kept.length > 0 ? `?${kept.join('&')}` : '');
}

/** The decoded name of one `name=value` pair, or the raw text if it is malformed. */
function queryName(pair: string): string {
  const eq = pair.indexOf('=');
  const raw = eq < 0 ? pair : pair.slice(0, eq);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** An error answer of the render route as the editor gets it. */
function failure(path: string, status: number, body: string): PageMessage {
  if (status === 422) {
    try {
      const { errors } = JSON.parse(body) as ValidationResponse;
      return {
        type: 'preview:error',
        path,
        status,
        message: 'A draft does not fit its schema',
        errors,
      };
    } catch {
      // Not the usual JSON: fall through to the plain message.
    }
  }
  return { type: 'preview:error', path, status, message: body.slice(0, 500) };
}
