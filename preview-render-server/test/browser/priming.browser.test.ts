// Priming: the bridge announces the page with `preview:ready`, the editor's
// first draft (even an empty one) renders the page, and the render patches the
// prerendered page without a reload.
import { afterEach, describe, expect, it } from 'vitest';
import { openPreview, type Preview } from './harness.ts';

let preview: Preview | undefined;
afterEach(() => {
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
});
