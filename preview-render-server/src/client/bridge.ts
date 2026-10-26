// Preview bridge: runs in every page of a preview build (bridge-entry.ts),
// inactive unless the page is inside an iframe. It's the browser half of the
// /__preview route: the editor (any editor) talks to it with postMessage (see
// ../protocol.ts), it fetches the render from its own origin and swaps the
// HTML into the island's wrapper.
//
// Pattern from Tina's bridge (@tinacms/bridge island-refresh.ts, Apache-2.0).
import { isDraftMessage, type PageMessage } from '../protocol.ts';

const ISLAND_ATTR = 'data-preview-island';

/** Starts the bridge; returns a function that stops it (or null when the page
 *  isn't in an iframe). */
export function startBridge(win: Window = window, fetchImpl: typeof fetch = win.fetch.bind(win)): (() => void) | null {
  if (win.parent === win) return null;

  const doc = win.document;
  const origin = win.location.origin;
  const latestRequest = new Map<string, number>(); // island -> id of its newest request
  let requestCount = 0;

  const send = (message: PageMessage) => win.parent.postMessage(message, origin);
  const findIsland = (name: string) =>
    Array.from(doc.querySelectorAll<HTMLElement>(`[${ISLAND_ATTR}]`)).find(
      (element) => element.getAttribute(ISLAND_ATTR) === name,
    );

  const onMessage = async (event: MessageEvent) => {
    if (event.source !== win.parent || event.origin !== origin) return;
    if (!isDraftMessage(event.data)) return;

    const { island, props } = event.data;
    const element = findIsland(island);
    if (!element) {
      send({ type: 'preview:error', island, status: 0, message: 'No such island on this page' });
      return;
    }

    // Only the newest draft may land: a slow answer to an older one is dropped.
    const id = ++requestCount;
    latestRequest.set(island, id);
    try {
      const response = await fetchImpl(`/__preview/${encodeURIComponent(island)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(props ?? {}),
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const body = await response.text();
      if (latestRequest.get(island) !== id) return;
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
        send({ type: 'preview:error', island, status: response.status, message: body.slice(0, 500) });
        return;
      }
      element.innerHTML = body;
      // Swapped-in HTML would replay the site's entrance animations on every
      // edit. Jump them to their end state; the first page load is unaffected.
      for (const animation of element.getAnimations?.({ subtree: true }) ?? []) animation.finish();
      send({ type: 'preview:rendered', island, renderMs: serverRenderMs(response) });
    } catch (error) {
      if (latestRequest.get(island) !== id) return;
      send({ type: 'preview:error', island, status: 0, message: String(error) });
    }
  };

  win.addEventListener('message', onMessage);
  send({
    type: 'preview:ready',
    islands: Array.from(doc.querySelectorAll(`[${ISLAND_ATTR}]`), (element) => element.getAttribute(ISLAND_ATTR) ?? ''),
  });
  return () => win.removeEventListener('message', onMessage);
}

function serverRenderMs(response: Response): number {
  return Number(response.headers.get('server-timing')?.match(/dur=([\d.]+)/)?.[1] ?? Number.NaN);
}
