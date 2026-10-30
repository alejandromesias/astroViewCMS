// KNOWN LIMIT (D6): a carousel whose script runs once at page load is not
// re-run after a swap. A priming draft morphs the three Swiper carousels of
// landing/home-v2 back to server markup. Asserted as today, so a change is noticed.
import { afterEach, describe, expect, it } from 'vitest';
import { openPreview, type Preview } from './harness.ts';

let preview: Preview | undefined;
afterEach(() => {
  preview?.close();
  preview = undefined;
});

describe('KNOWN LIMIT: Swiper carousel', () => {
  it('KNOWN LIMIT: a priming draft morphs the Swiper carousel back to server markup', async () => {
    preview = await openPreview('/landing/home-v2');
    const page = preview;
    // Let the carousel initialise (its script runs at page load).
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const census = `JSON.stringify({ initialised: document.querySelectorAll('.swiper-initialized').length, slides: document.querySelectorAll('.swiper-slide').length, activeSlides: document.querySelectorAll('.swiper-slide-active').length })`;
    const before = await page.eval<string>(census);

    const answer = await page.draft({});
    expect(answer.type).toBe('preview:rendered');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Today: the three carousels are back to server markup, not initialised.
    expect(before).toBe('{"initialised":3,"slides":9,"activeSlides":3}');
    expect(await page.eval<string>(census)).toBe(
      '{"initialised":0,"slides":9,"activeSlides":0}',
    );
  });
});
