// KNOWN LIMIT: the FAQ accordion (elements page) is a React island. After a body
// swap its open state survives and it still toggles; its script is not re-run.
// Asserted as today, so a change is noticed.
import { afterEach, describe, expect, it } from 'vitest';
import { openPreview, type Preview, waitUntil } from './harness.ts';

let preview: Preview | undefined;
afterEach(() => {
  preview?.close();
  preview = undefined;
});

describe('KNOWN LIMIT: FAQ accordion', () => {
  it('KNOWN LIMIT: the elements-page FAQ accordion stays open and toggles after a body swap', async () => {
    preview = await openPreview('/elements');
    const page = preview;
    const header = `document.querySelector('.accordion-header')`;
    const classOf = `${header}.parentElement.className`;
    await page.eval(`${header}.click()`);
    const openBefore = await page.eval<string>(classOf);

    await page.draft({
      'pages/elements': {
        data: {
          title: 'Elements, swapped',
          meta_title: '',
          description: 'swap',
          draft: false,
        },
        body: '',
      },
    });
    await waitUntil(() =>
      page.eval<boolean>(`document.title === "Elements, swapped"`),
    );
    const openAfter = await page.eval<string>(classOf);
    await page.eval(`${header}.click()`);
    const closed = await page.eval<string>(classOf);

    // The sample's Accordion writes `${show ? "active" : ""}` and `${className ?? ""}`,
    // so no class reads "undefined" and an open one has `active`. The spaces stay.
    expect(openBefore).toBe('accordion active ');
    expect(openAfter).toBe('accordion active ');
    expect(closed).toBe('accordion  ');
  });
});
