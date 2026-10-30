// Custom browser commands (vitest.browser.config.ts `commands`). They run in
// Node with Playwright's API, so they can reach into the preview iframe, which
// is cross-origin to the harness page: a page can't read `contentDocument` of
// it, but Playwright's frame API can. The iframe is found by its name
// ('preview'), which survives a ClientRouter navigation.
import type { BrowserCommand, BrowserCommandContext } from 'vitest/node';

const RENDER_ROUTE = '**/__preview/render**';

type Context = BrowserCommandContext;

function previewFrame(ctx: Context) {
  const frame = ctx.page.frame({ name: 'preview' });
  if (!frame) throw new Error('no iframe named "preview" on the harness page');
  return frame;
}

// The foreign editor is a second page, served by Playwright's route handler
// under an origin the bridge does not list (see origins.browser.test.ts).
let foreignPage: Context['page'] | undefined;

/** Runs a JavaScript expression in the preview frame; returns its value (plain data only). */
export const previewEval: BrowserCommand<[expression: string]> = (
  ctx,
  expression,
) => previewFrame(ctx).evaluate(expression);

/** Holds every render request for `ms` before it is sent (0 releases them). A
 *  render that is still in flight when the page changes is what the bridge's
 *  stale-answer rule must drop. */
export const delayRenders: BrowserCommand<[ms: number]> = async (ctx, ms) => {
  await ctx.page.unroute(RENDER_ROUTE);
  if (ms === 0) return;
  await ctx.page.route(RENDER_ROUTE, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
};

const IMAGE_REQUEST = /\/_image|\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?|$)/;

/** Aborts every image request of the page (sized in the markup, so the layout holds).
 *  Image transforms on the preview server otherwise queue behind each other and
 *  delay the renders of the next test. */
export const blockImages: BrowserCommand<[]> = (ctx) =>
  ctx.page.route(IMAGE_REQUEST, (route) => route.abort());

/**
 * Opens a page at `editorOrigin` (never listed by the bridge) that embeds the
 * preview in an iframe named 'preview'. Its HTML comes from the route, so no
 * server runs for it. Replaces any foreign page opened before.
 */
export const openForeignEditor: BrowserCommand<[previewUrl: string]> = async (
  ctx,
  previewUrl,
) => {
  await closeForeign();
  const page = await ctx.page.context().newPage();
  foreignPage = page;
  await page.route('https://foreign-editor.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><iframe name="preview" src="${previewUrl}"></iframe><script>
        window.received = [];
        window.addEventListener('message', (event) => window.received.push({ origin: event.origin, type: event.data && event.data.type }));
      </script></body></html>`,
    }),
  );
  await page.goto('https://foreign-editor.example/');
  await page.frame({ name: 'preview' })?.waitForLoadState('load');
};

/** Posts a message from the foreign page into the preview iframe, to `previewOrigin`. */
export const foreignPost: BrowserCommand<
  [previewOrigin: string, message: unknown]
> = async (_ctx, previewOrigin, message) => {
  const page = requireForeign();
  await page.evaluate(
    ([origin, data]) => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        'iframe[name="preview"]',
      );
      iframe?.contentWindow?.postMessage(data, origin);
    },
    [previewOrigin, message] as const,
  );
};

/** What the foreign page's window received (origin and type of each message). */
export const foreignReceived: BrowserCommand<[]> = () =>
  requireForeign().evaluate(
    () => (window as unknown as { received: unknown[] }).received,
  );

/** Runs an expression in the preview iframe of the foreign page. */
export const foreignEval: BrowserCommand<[expression: string]> = (
  _ctx,
  expression,
) => {
  const page = requireForeign();
  const frame = page.frame({ name: 'preview' });
  if (!frame) throw new Error('no preview frame on the foreign page');
  return frame.evaluate(expression);
};

export const closeForeignEditor: BrowserCommand<[]> = () => closeForeign();

function requireForeign(): NonNullable<typeof foreignPage> {
  if (!foreignPage) throw new Error('no foreign editor is open');
  return foreignPage;
}

async function closeForeign() {
  await foreignPage?.close();
  foreignPage = undefined;
}

export const previewCommands = {
  previewEval,
  delayRenders,
  blockImages,
  openForeignEditor,
  foreignPost,
  foreignReceived,
  foreignEval,
  closeForeignEditor,
};
