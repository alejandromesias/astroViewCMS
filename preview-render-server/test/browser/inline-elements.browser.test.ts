// Inline scripts and removed elements after repeated drafts (1.6 open check).
// The patch runs each inline script once and never removes a <style> or <link>
// that the render no longer has (KEEP in patch.ts), so the body could pile up
// copies. The sample site has no define:vars or JSON-LD: the only inline
// scripts it renders are the island bootstraps, and the only body <style>
// elements come from a component that renders in the body (the pricing block).
import { afterEach, describe, expect, it } from 'vitest';
import {
  openPreview,
  type Preview,
  sampleContent,
  waitUntil,
} from './harness.ts';

interface Block {
  type: string;
  plans?: Array<{ price_yearly?: number; [key: string]: unknown }>;
  [key: string]: unknown;
}
interface Landing {
  title: string;
  description: string;
  blocks: Block[];
}

const EDITS = 10;

let preview: Preview | undefined;
afterEach(() => {
  preview?.close();
  preview = undefined;
});

/** Counts of the elements that matter here, by where they are. */
const census = (preview: Preview) =>
  preview.eval<string>(`JSON.stringify({
    headInline: document.head.querySelectorAll('script:not([src])').length,
    bodyInline: document.body.querySelectorAll('script:not([src])').length,
    bodySrc: document.body.querySelectorAll('script[src]').length,
    headStyle: document.head.querySelectorAll('style').length,
    bodyStyle: document.body.querySelectorAll('style').length,
    headLink: document.head.querySelectorAll('link').length,
    bodyLink: document.body.querySelectorAll('link').length,
    islands: document.querySelectorAll('astro-island').length,
  })`);

async function pricingBlock(): Promise<Block> {
  const long = await sampleContent<Landing>('landing/long.json');
  const block = long.blocks.find((b) => b.type === 'pricing');
  if (!block) throw new Error('landing/long has no pricing block');
  return block;
}

const homeWith = async (...extra: Block[]) => {
  const home = await sampleContent<Landing>('landing/home-v2.json');
  return { ...home, blocks: [...home.blocks, ...extra] };
};

describe('inline scripts and removed elements after 10 edits', () => {
  it('10 edits of the pricing props leave one island bootstrap script in the body', async () => {
    preview = await openPreview('/landing/home-v2');
    const page = preview;
    const pricing = await pricingBlock();
    await page.draft({ 'landing/home-v2': await homeWith(pricing) });
    await waitUntil(() =>
      page.eval<boolean>(
        `document.querySelectorAll('astro-island').length === 1`,
      ),
    );
    const start = await census(page);

    for (let edit = 1; edit <= EDITS; edit++) {
      const plans = (pricing.plans ?? []).map((plan, index) =>
        index === 0 ? { ...plan, price_yearly: 490 + edit } : plan,
      );
      await page.draft({
        'landing/home-v2': await homeWith({ ...pricing, plans }),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    // No growth: the same two island bootstraps, one body <style>, one island.
    expect(start).toBe(
      '{"headInline":0,"bodyInline":2,"bodySrc":1,"headStyle":2,"bodyStyle":1,"headLink":9,"bodyLink":0,"islands":1}',
    );
    expect(await census(page)).toBe(start);
  });

  it('10 add/remove edits of the pricing block leave no extra <style> or <link> elements', async () => {
    preview = await openPreview('/landing/home-v2');
    const page = preview;
    const pricing = await pricingBlock();
    const start = await census(page);

    for (let edit = 1; edit <= EDITS; edit++) {
      const blocks = edit % 2 === 1 ? [pricing] : [];
      await page.draft({ 'landing/home-v2': await homeWith(...blocks) });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Ten edits, five adds and five removes; the last one removes the block.
    // The bootstraps added with the first island stay (2, not 2 per add): no pile-up.
    expect(start).toBe(
      '{"headInline":0,"bodyInline":0,"bodySrc":1,"headStyle":2,"bodyStyle":0,"headLink":9,"bodyLink":0,"islands":0}',
    );
    expect(await census(page)).toBe(
      '{"headInline":0,"bodyInline":2,"bodySrc":1,"headStyle":2,"bodyStyle":0,"headLink":9,"bodyLink":0,"islands":0}',
    );
  });
});
