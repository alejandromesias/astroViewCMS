// Preview bridge: added to every page of a preview build, inactive unless the
// page is inside an iframe. It's the browser half of the /__preview route:
// the editor (any editor) talks to it with postMessage, it fetches the render
// from its own origin and swaps the HTML into the island's wrapper.
//
// Messages (same origin only, parent window only):
//   page -> editor  { type: 'preview:ready', islands: ['blocks', ...] }
//   editor -> page  { type: 'preview:draft', island: 'blocks', props: {...} }
//   page -> editor  { type: 'preview:rendered', island, renderMs }
//   page -> editor  { type: 'preview:error', island, status, message }
//
// Pattern from Tina's bridge (@tinacms/bridge island-refresh.ts, Apache-2.0).

if (window.parent !== window) {
  const ORIGIN = window.location.origin;
  const latestRequest = new Map(); // island -> id of its newest render request
  let requestCount = 0;

  const send = (message) => window.parent.postMessage(message, ORIGIN);
  const findIsland = (name) =>
    Array.prototype.find.call(
      document.querySelectorAll('[data-preview-island]'),
      (element) => element.getAttribute('data-preview-island') === name,
    );

  window.addEventListener('message', async (event) => {
    if (event.source !== window.parent || event.origin !== ORIGIN) return;
    const message = event.data;
    if (message?.type !== 'preview:draft' || typeof message.island !== 'string') return;

    const island = message.island;
    const element = findIsland(island);
    if (!element) {
      send({ type: 'preview:error', island, status: 0, message: 'No such island on this page' });
      return;
    }

    // Only the newest draft may land: a slow answer to an older one is dropped.
    const id = ++requestCount;
    latestRequest.set(island, id);
    try {
      const response = await fetch(`/__preview/${encodeURIComponent(island)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.props ?? {}),
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
      for (const animation of element.getAnimations({ subtree: true })) animation.finish();
      const renderMs = Number(response.headers.get('server-timing')?.match(/dur=([\d.]+)/)?.[1]);
      send({ type: 'preview:rendered', island, renderMs });
    } catch (error) {
      if (latestRequest.get(island) !== id) return;
      send({ type: 'preview:error', island, status: 0, message: String(error) });
    }
  });

  send({
    type: 'preview:ready',
    islands: Array.from(document.querySelectorAll('[data-preview-island]'), (element) =>
      element.getAttribute('data-preview-island'),
    ),
  });
}
