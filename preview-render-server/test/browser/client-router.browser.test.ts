// ClientRouter: a navigation inside the iframe replaces the document's content
// without a reload, so the bridge's JavaScript survives it. The bridge drops an
// answer to a draft sent before the navigation (it would be patched into the new
// page), and announces `ready` again with the new path.
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import {
  openPreview,
  type Preview,
  sampleContent,
  waitUntil,
} from './harness.ts';

const HOME = '/landing/home-v2';
const NEXT = '/pricing';
// Holds the render of a draft long enough for the navigation to finish first.
const HOLD_MS = 1500;

let preview: Preview | undefined;
afterEach(async () => {
  await commands.delayRenders(0);
  preview?.close();
  preview = undefined;
});

describe('ClientRouter navigation', () => {
  it('a draft sent before a navigation is dropped, and the bridge announces ready again', async () => {
    preview = await openPreview(HOME);
    const page = preview;
    await commands.blockImages();
    await commands.delayRenders(HOLD_MS);
    const readyBefore = page.messages.filter(
      (m) => m.type === 'preview:ready',
    ).length;
    const renderedBefore = page.messages.filter(
      (m) => m.type === 'preview:rendered',
    ).length;

    page.post({
      'landing/home-v2': await homeTitled('Dropped before navigation'),
    });
    await page.eval(`document.querySelector('a[href="${NEXT}"]').click()`);

    await waitUntil(async () =>
      page.messages.some((m) => m.type === 'preview:ready' && m.path === NEXT),
    );
    await waitUntil(() =>
      page.eval<boolean>(`location.pathname === ${JSON.stringify(NEXT)}`),
    );
    // Long enough for the held render to come back, were it not dropped.
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS + 1000));

    const sinceNavigation = page.messages.slice(readyBefore);
    expect(sinceNavigation.map((m) => m.type)).toEqual(['preview:ready']);
    expect(sinceNavigation[0]).toEqual({
      type: 'preview:ready',
      path: NEXT,
      protocol: 2,
    });
    expect(
      page.messages.filter((m) => m.type === 'preview:rendered').length,
    ).toBe(renderedBefore);
    expect(
      await page.eval<boolean>(
        `document.body.textContent.includes("Dropped before navigation")`,
      ),
    ).toBe(false);
  });

  it('a draft sent after the navigation is answered for the new page', async () => {
    preview = await openPreview(HOME);
    const page = preview;
    await commands.blockImages();
    await page.eval(`document.querySelector('a[href="${NEXT}"]').click()`);
    await waitUntil(() =>
      page.eval<boolean>(`location.pathname === ${JSON.stringify(NEXT)}`),
    );
    await waitUntil(async () =>
      page.messages.some((m) => m.type === 'preview:ready' && m.path === NEXT),
    );

    const answer = await page.draft({});

    expect(answer).toMatchObject({ type: 'preview:rendered', path: NEXT });
  });
});

/** The home page's overlay with the banner title changed. */
async function homeTitled(title: string) {
  const home = await sampleContent<{
    blocks: Array<{ type: string; title?: string }>;
  }>('landing/home-v2.json');
  return {
    ...home,
    blocks: home.blocks.map((block) =>
      block.type === 'banner' ? { ...block, title } : block,
    ),
  };
}
