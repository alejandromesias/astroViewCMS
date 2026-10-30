// Priming: the bridge announces the page with `preview:ready`, the editor's
// first draft (even an empty one) renders the page, and the render patches the
// prerendered page without a reload.
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { openPreview, type Preview, sampleContent } from './harness.ts';

// Holds the render of a draft long enough for the second `ready` to arrive first.
const HOLD_MS = 1500;

let preview: Preview | undefined;
afterEach(async () => {
  await commands.delayRenders(0);
  preview?.close();
  preview = undefined;
});

const count = (preview: Preview, type: string) =>
  preview.messages.filter((m) => m.type === type).length;

// The documents the home page reads with no overlay (the render's own list).
const BUILT_READS = [
  'data:src/config/config.json',
  'data:src/config/menu.json',
  'data:src/config/social.json',
  'data:src/config/theme.json',
  'landing/home-v2',
  'landing/long',
  'landing/product',
  'partners/atlas',
  'partners/bright',
  'partners/loop',
  'partners/northwind',
  'stats/editors',
  'stats/sites',
  'stats/uptime',
  'testimonials/t-ana',
  'testimonials/t-kofi',
  'testimonials/t-lena',
  'testimonials/t-marco',
];

describe('priming', () => {
  it('an empty draft renders the page and the answer names the path and the documents read', async () => {
    preview = await openPreview('/landing/home-v2');
    expect(preview.messages[0]).toEqual({
      type: 'preview:ready',
      path: '/landing/home-v2',
      protocol: 2,
    });

    const answer = await preview.draft({});

    expect(answer).toEqual({
      type: 'preview:rendered',
      path: '/landing/home-v2',
      documents: BUILT_READS,
      limits: [],
      renderMs: expect.any(Number),
    });
    expect(count(preview, 'preview:rendered')).toBe(1);
  });

  // WORKPLAN 1.6 open question, ANSWERED: yes. `astro:page-load` fires on the
  // first load too, so the bridge sends a second `ready` with no draft in
  // between. An editor that answers every `ready` therefore renders twice on
  // load (limit: one extra render per load, output is unchanged).
  it('the first load also fires astro:page-load: a second ready, and an editor that answers it renders again (limit)', async () => {
    preview = await openPreview('/landing/home-v2');
    await preview.draft({});
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(count(preview, 'preview:ready')).toBe(2);
    expect(count(preview, 'preview:rendered')).toBe(1);

    await preview.draft({});

    expect(count(preview, 'preview:rendered')).toBe(2);
  });

  // D14 gap: a draft sent between the two `ready`s of a first load was dropped,
  // because the second `ready` bumped the newest-wins counter while its answer
  // was in flight. The second `ready` is fired here at a chosen moment (while
  // the render is held), so the race happens every run. The editor does not
  // answer this `ready`: it primed the page already, so only the draft's answer
  // can bring the new title.
  it('a repeat ready for the same path does not drop a draft whose render is in flight', async () => {
    preview = await openPreview('/landing/home-v2');
    const page = preview;
    await commands.blockImages();
    await commands.delayRenders(HOLD_MS);
    const before = page.messages.length;

    page.post({
      'landing/home-v2': await homeTitled('Sent between the readies'),
    });
    await page.eval(`document.dispatchEvent(new Event('astro:page-load'))`);

    const answer = await page.answer(before);
    expect(answer).toMatchObject({
      type: 'preview:rendered',
      path: '/landing/home-v2',
    });
    expect(
      await page.eval<boolean>(
        `document.body.textContent.includes("Sent between the readies")`,
      ),
    ).toBe(true);
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
