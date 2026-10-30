// Morph on a long page (landing/long, 44 blocks): a draft that edits one block
// patches the page in place. An untouched block keeps its DOM node, and the
// scroll position does not move.
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import {
  openPreview,
  type Preview,
  sampleContent,
  waitUntil,
} from './harness.ts';

interface Block {
  type: string;
  title?: string;
  [key: string]: unknown;
}
interface Landing {
  title: string;
  description: string;
  blocks: Block[];
}

// The workflow block's heading (block 3 of landing/long, never edited here).
const UNTOUCHED_HEADING = 'Experience the best workflow with us (4)';
const EDITED_TITLE = 'Morph edit on the first block';

let preview: Preview | undefined;
afterEach(() => {
  preview?.close();
  preview = undefined;
});

/** Marks the workflow block's section (its DOM node) and returns the mark's reader. */
const markUntouched = (preview: Preview) =>
  preview.eval(`(() => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === ${JSON.stringify(UNTOUCHED_HEADING)});
    heading.closest('section').morphMark = 'untouched';
  })()`);

const readUntouched = (preview: Preview) =>
  preview.eval<{ mark?: string; top: number }>(`(() => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === ${JSON.stringify(UNTOUCHED_HEADING)});
    const section = heading.closest('section');
    return { mark: section.morphMark, top: section.getBoundingClientRect().top };
  })()`);

describe('morph on landing/long', () => {
  it('an edit below the viewport keeps an untouched block and leaves scrollY unchanged', async () => {
    await commands.blockImages();
    preview = await openPreview('/landing/long');
    const page = preview;
    const long = await sampleContent<Landing>('landing/long.json');
    await page.eval('window.scrollTo(0, 2400)');
    await markUntouched(page);

    // The last block (the highlight callout) is far below the viewport.
    const blocks = long.blocks.map((block) =>
      block.type === 'highlight' ? { ...block, title: EDITED_TITLE } : block,
    );
    const answer = await page.draft({ 'landing/long': { ...long, blocks } });

    expect(answer.type).toBe('preview:rendered');
    await waitUntil(() =>
      page.eval<boolean>(
        `document.body.textContent.includes(${JSON.stringify(EDITED_TITLE)})`,
      ),
    );
    expect((await readUntouched(page)).mark).toBe('untouched');
    expect(await page.eval<number>('window.scrollY')).toBe(2400);
  });

  // GAP-candidate, measured: an edit above the viewport (the banner). The page
  // keeps the reader's content in place by scroll anchoring, so scrollY moves by
  // the height the edit takes away. Assert that today's numbers: the untouched
  // block's position on screen is unchanged, and scrollY moved.
  it('GAP: an edit above the viewport moves scrollY by 60 px while the untouched block stays on screen', async () => {
    await commands.blockImages();
    preview = await openPreview('/landing/long');
    const page = preview;
    const long = await sampleContent<Landing>('landing/long.json');
    await page.eval('window.scrollTo(0, 2400)');
    await markUntouched(page);
    const before = await readUntouched(page);

    const [first, ...rest] = long.blocks;
    if (!first) throw new Error('landing/long has no blocks');
    await page.draft({
      'landing/long': {
        ...long,
        blocks: [{ ...first, title: EDITED_TITLE }, ...rest],
      },
    });
    await waitUntil(() =>
      page.eval<boolean>(
        `document.body.textContent.includes(${JSON.stringify(EDITED_TITLE)})`,
      ),
    );

    const after = await readUntouched(page);
    expect(after.mark).toBe('untouched');
    // Today's numbers (GAP, WORKPLAN 1.8 status): the block stays on screen to
    // 0.28 px, while scrollY moves by the 60 px the edit takes off the content
    // above it (Chromium's scroll anchoring). The expectation of the other test
    // (scrollY unchanged) does not hold for an edit above the viewport.
    expect(after.top - before.top).toBe(0.28125);
    expect(await page.eval<number>('window.scrollY')).toBe(2340);
  });
});
