// Origins: the bridge takes messages only from the page's own origin and from
// the editor origins the build lists (SiteConfig.editorOrigins). A draft from an
// origin that is not listed is ignored; the same draft from a listed origin is
// applied.
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import {
  openPreview,
  type Preview,
  sampleContent,
  waitUntil,
} from './harness.ts';

const HOME = '/landing/home-v2';
const EDITED_BANNER = 'Sent from an origin that is listed';
const IGNORED_BANNER = 'Sent from an origin that is not listed';

let preview: Preview | undefined;
afterEach(async () => {
  await commands.closeForeignEditor();
  preview?.close();
  preview = undefined;
});

/** The home page's overlay with the banner title set to `title`. */
async function homeWithBanner(title: string) {
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

describe('origins', () => {
  it('a draft from an origin that is not listed is ignored: no answer, no change to the page', async () => {
    await commands.blockImages();
    preview = await openPreview(HOME);
    const previewUrl = `${preview.origin}${HOME}`;
    await commands.openForeignEditor(previewUrl);
    const message = {
      type: 'preview:draft',
      protocol: 2,
      documents: { 'landing/home-v2': await homeWithBanner(IGNORED_BANNER) },
      media: {},
    };

    await commands.foreignPost(preview.origin, message);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // The foreign page itself never hears from the bridge.
    expect(await commands.foreignReceived()).toEqual([]);
    expect(
      await commands.foreignEval(
        `document.body.textContent.includes(${JSON.stringify(IGNORED_BANNER)})`,
      ),
    ).toBe(false);
  });

  it('the same draft from a listed origin is applied (near miss of the case above)', async () => {
    await commands.blockImages();
    preview = await openPreview(HOME);
    const page = preview;

    const answer = await page.draft({
      'landing/home-v2': await homeWithBanner(EDITED_BANNER),
    });

    expect(answer.type).toBe('preview:rendered');
    await waitUntil(() =>
      page.eval<boolean>(
        `document.body.textContent.includes(${JSON.stringify(EDITED_BANNER)})`,
      ),
    );
  });
});
