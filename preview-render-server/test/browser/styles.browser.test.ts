// Scoped styles and :global() styles (Highlight.astro) of a block that a draft
// swaps in: the computed styles after the swap are the ones the prerendered page
// has. The body of a Highlight block is Markdown set with set:html, so its
// <strong> and <a> have no scope attribute and only the :global() rules reach them.
import { afterEach, describe, expect, it } from 'vitest';
import {
  openPreview,
  type Preview,
  sampleContent,
  waitUntil,
} from './harness.ts';

interface Block {
  type: string;
  body?: string;
  [key: string]: unknown;
}
interface Landing {
  title: string;
  description: string;
  blocks: Block[];
}
interface Styles {
  box: { background: string; borderStyle: string };
  title: { color: string; letterSpacing: string };
  strong: { color: string; background: string };
  link: { color: string; textDecoration: string };
}

const SWAPPED_BODY =
  'A swapped callout with **strong** text and a [link](/blog).';

let preview: Preview | undefined;
afterEach(() => {
  preview?.close();
  preview = undefined;
});

const readStyles = (preview: Preview) =>
  preview.eval<Styles>(`(() => {
    const of = (selector) => getComputedStyle(document.querySelector(selector));
    const box = of('.highlight');
    const title = of('.highlight-title');
    const strong = of('.highlight-body strong');
    const link = of('.highlight-body a');
    return {
      box: { background: box.backgroundImage, borderStyle: box.borderTopStyle },
      title: { color: title.color, letterSpacing: title.letterSpacing },
      strong: { color: strong.color, background: strong.backgroundColor },
      link: { color: link.color, textDecoration: link.textDecorationLine },
    };
  })()`);

describe('scoped and :global() styles of a swapped block', () => {
  it('the computed styles of a swapped callout match the prerendered page', async () => {
    preview = await openPreview('/landing/long');
    const page = preview;
    const prerendered = await readStyles(page);
    // The default colour would mean the rules did not apply at all.
    expect(prerendered.strong.background).not.toBe('rgba(0, 0, 0, 0)');

    const long = await sampleContent<Landing>('landing/long.json');
    const blocks = long.blocks.map((block) =>
      block.type === 'highlight' ? { ...block, body: SWAPPED_BODY } : block,
    );
    const answer = await page.draft({ 'landing/long': { ...long, blocks } });
    expect(answer.type).toBe('preview:rendered');
    await waitUntil(() =>
      page.eval<boolean>(
        `document.body.textContent.includes("A swapped callout")`,
      ),
    );

    expect(await readStyles(page)).toEqual(prerendered);
  });
});
