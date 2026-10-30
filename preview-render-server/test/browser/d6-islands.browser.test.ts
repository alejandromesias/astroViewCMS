// D6: hydrated components on a patched page. A `client:visible` React island
// (the pricing toggle, PricingPlans) is added to landing/home-v2 by a draft. It
// hydrates when scrolled into view; a change to its props keeps its state; a
// block added next to it leaves the island (its node and its state) alone.
import { afterEach, describe, expect, it } from 'vitest';
import {
  openPreview,
  type Preview,
  sampleContent,
  waitUntil,
} from './harness.ts';

interface Plan {
  title: string;
  price: number;
  price_yearly?: number;
  type: string;
}
interface Block {
  type: string;
  title?: string;
  plans?: Plan[];
}
interface Landing {
  title: string;
  description: string;
  blocks: Block[];
}

const ISLAND = 'astro-island[component-url*="PricingPlans"]';

let preview: Preview | undefined;
afterEach(() => {
  preview?.close();
  preview = undefined;
});

/** The pricing block of the long landing page, six plans with yearly prices. */
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

/** Scrolls the island into view and waits for it to hydrate (ssr attribute gone).
 *  An astro-island has no box of its own, so its first child is scrolled to. */
async function hydrate(preview: Preview) {
  await preview.eval(
    `document.querySelector(${JSON.stringify(ISLAND)}).firstElementChild.scrollIntoView({ block: 'center' })`,
  );
  await waitUntil(() =>
    preview.eval<boolean>(
      `!document.querySelector(${JSON.stringify(ISLAND)}).hasAttribute('ssr')`,
    ),
  );
}

const pressed = (preview: Preview, label: string) =>
  preview.eval<string | null>(`(() => {
    const button = [...document.querySelectorAll('[aria-label="Billing period"] button')]
      .find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    return button ? button.getAttribute('aria-pressed') : null;
  })()`);

const clickToggle = (preview: Preview, label: string) =>
  preview.eval(`[...document.querySelectorAll('[aria-label="Billing period"] button')]
    .find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`);

const islandText = (preview: Preview) =>
  preview.eval<string>(
    `document.querySelector(${JSON.stringify(ISLAND)}).textContent`,
  );

describe('D6: a hydrated pricing island on a patched page', () => {
  it('a pricing block added by a draft hydrates in view, with Monthly selected', async () => {
    preview = await openPreview('/landing/home-v2');
    const plans = await pricingBlock();
    const answer = await preview.draft({
      'landing/home-v2': await homeWith(plans),
    });
    expect(answer.type).toBe('preview:rendered');

    expect(
      await preview.eval<number>(
        `document.querySelectorAll(${JSON.stringify(ISLAND)}).length`,
      ),
    ).toBe(1);
    // Not hydrated yet: the island is below the fold (client:visible).
    expect(
      await preview.eval<boolean>(
        `document.querySelector(${JSON.stringify(ISLAND)}).hasAttribute('ssr')`,
      ),
    ).toBe(true);

    await hydrate(preview);

    expect(await pressed(preview, 'Monthly')).toBe('true');
    expect(await pressed(preview, 'Yearly')).toBe('false');
    expect((await islandText(preview)).split('/ month')).toHaveLength(4);
    expect((await islandText(preview)).split('/ year')).toHaveLength(1);
  });

  it('clicking Yearly switches every price to its yearly one', async () => {
    preview = await openPreview('/landing/home-v2');
    await preview.draft({
      'landing/home-v2': await homeWith(await pricingBlock()),
    });
    await hydrate(preview);

    await clickToggle(preview, 'Yearly');

    expect(await pressed(preview, 'Yearly')).toBe('true');
    expect(await pressed(preview, 'Monthly')).toBe('false');
    expect((await islandText(preview)).split('/ year')).toHaveLength(4);
    expect((await islandText(preview)).split('/ month')).toHaveLength(1);
  });

  it('a change to the toggle props re-renders the island and keeps Yearly selected', async () => {
    preview = await openPreview('/landing/home-v2');
    const plans = await pricingBlock();
    await preview.draft({ 'landing/home-v2': await homeWith(plans) });
    await hydrate(preview);
    await clickToggle(preview, 'Yearly');

    const edited: Block = {
      ...plans,
      plans: (plans.plans ?? []).map((plan, index) =>
        index === 0 ? { ...plan, price_yearly: 477 } : plan,
      ),
    };
    await preview.draft({ 'landing/home-v2': await homeWith(edited) });

    const page = preview;
    await waitUntil(async () => (await islandText(page)).includes('$477'));
    expect(await pressed(preview, 'Yearly')).toBe('true');
    expect(await pressed(preview, 'Monthly')).toBe('false');
    expect((await islandText(preview)).includes('$490')).toBe(false);
  });

  /** Hydrates the island with Yearly selected, marks its node, then drafts a
   *  CTA block (the home page's own, retitled) before or after the island. */
  async function addCtaAroundIsland(placement: 'before' | 'after') {
    preview = await openPreview('/landing/home-v2');
    const plans = await pricingBlock();
    await preview.draft({ 'landing/home-v2': await homeWith(plans) });
    await hydrate(preview);
    await clickToggle(preview, 'Yearly');
    // A JS property, not a data attribute: the patch syncs an island's attributes to the render.
    await preview.eval(
      `document.querySelector(${JSON.stringify(ISLAND)}).kept = 'same node'`,
    );

    const home = await sampleContent<Landing>('landing/home-v2.json');
    const cta = home.blocks.find((b) => b.type === 'cta');
    if (!cta) throw new Error('landing/home-v2 has no cta block');
    const next: Block = { ...cta, title: 'Added next to the island' };
    const blocks = placement === 'before' ? [next, plans] : [plans, next];
    const answer = await preview.draft({
      'landing/home-v2': await homeWith(...blocks),
    });
    expect(answer.type).toBe('preview:rendered');
    await waitUntil(() =>
      preview!.eval<boolean>(
        'document.body.textContent.includes("Added next to the island")',
      ),
    );
  }

  // Control: a block after the island. The island keeps its node and its state.
  it('a block added after the hydrated island leaves the island, its node and its state, untouched', async () => {
    await addCtaAroundIsland('after');

    expect(
      await preview!.eval<string | undefined>(
        `document.querySelector(${JSON.stringify(ISLAND)}).kept`,
      ),
    ).toBe('same node');
    expect(await pressed(preview!, 'Yearly')).toBe('true');
    expect((await islandText(preview!)).split('/ year')).toHaveLength(4);
  });

  // GAP (found while writing this suite, 2026-10-30): a block added right before
  // the island replaces its node. The island re-hydrates with Monthly selected.
  // The expectation is the control's; this asserts today's behaviour until fixed.
  it('GAP: a block added before the hydrated island replaces its node and resets Yearly to Monthly', async () => {
    await addCtaAroundIsland('before');
    // The new island is in view, so it hydrates on its own: wait for it.
    await hydrate(preview!);

    expect(
      await preview!.eval<string | undefined>(
        `document.querySelector(${JSON.stringify(ISLAND)}).kept`,
      ),
    ).toBeUndefined();
    expect(await pressed(preview!, 'Monthly')).toBe('true');
    expect(await pressed(preview!, 'Yearly')).toBe('false');
  });
});
