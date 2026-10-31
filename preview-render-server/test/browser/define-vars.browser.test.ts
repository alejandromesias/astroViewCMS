// Inline define:vars scripts and JSON-LD of an edited page (D6 browser findings,
// task 1.8a item 3). /fixtures/define-vars is a test-only page of the sample
// site (src/pages/fixtures): one entry with a define:vars script and a JSON-LD
// block. The sample content has neither.
import { afterEach, describe, expect, it } from 'vitest';
import {
  openPreview,
  type Preview,
  sampleContent,
  waitUntil,
} from './harness.ts';

interface Fixture {
  title: string;
  label: string;
  name: string;
}

const PATH = '/fixtures/define-vars';
const KEY = 'fixtures/define-vars';
const EDITS = 10;

let preview: Preview | undefined;
afterEach(() => {
  preview?.close();
  preview = undefined;
});

/** The fixture entry as the sample content has it, with some fields changed. */
const fixture = async (overrides: Partial<Fixture> = {}) => ({
  ...(await sampleContent<Fixture>('fixtures/define-vars.json')),
  ...overrides,
});

/** Counts and values that matter here. The define:vars script is the one whose text
 *  holds `fixtureLabel`; the JSON-LD name is read from each block. */
const census = (preview: Preview) =>
  preview.eval<string>(`JSON.stringify({
    defineVarsScripts: [...document.querySelectorAll('script')]
      .filter((s) => s.textContent.includes('fixtureLabel')).length,
    jsonLd: document.querySelectorAll('script[type="application/ld+json"]').length,
    windowLabel: window.fixtureLabel,
    label: document.getElementById('fixture-label').textContent,
    name: document.getElementById('fixture-name').textContent,
  })`);

const jsonLdNames = (preview: Preview) =>
  preview.eval<
    string[]
  >(`[...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => JSON.parse(s.textContent).name)`);

describe('define:vars and JSON-LD of an edited test-only page', () => {
  it('the page renders with one define:vars script and one JSON-LD block', async () => {
    preview = await openPreview(PATH);

    expect(JSON.parse(await census(preview))).toEqual({
      defineVarsScripts: 1,
      jsonLd: 1,
      windowLabel: 'Monthly',
      label: 'Monthly',
      name: 'Fixture product',
    });
  });

  it('a draft that changes the define:vars value updates it in the live page', async () => {
    preview = await openPreview(PATH);
    const page = preview;
    await page.draft({ [KEY]: await fixture({ label: 'Yearly' }) });
    await waitUntil(() =>
      page.eval<boolean>(
        `document.getElementById('fixture-label').textContent === 'Yearly'`,
      ),
    );

    // The new define:vars text runs as a new script; the old one stays (LIMIT below).
    expect(JSON.parse(await census(page))).toMatchObject({
      defineVarsScripts: 2,
      jsonLd: 1,
      windowLabel: 'Yearly',
      label: 'Yearly',
    });
  });

  it('a draft with the same define:vars values adds no script', async () => {
    preview = await openPreview(PATH);
    const page = preview;
    const start = await census(page);

    for (let edit = 1; edit <= EDITS; edit++) {
      await page.draft({ [KEY]: await fixture({ name: `Renamed ${edit}` }) });
    }
    await waitUntil(() =>
      page.eval<boolean>(
        `document.getElementById('fixture-name').textContent === 'Renamed ${EDITS}'`,
      ),
    );

    expect(JSON.parse(start).defineVarsScripts).toBe(1);
    expect(JSON.parse(await census(page)).defineVarsScripts).toBe(1);
  });

  // LIMIT (task 1.8a item 3): the bridge runs an inline script once per text (the
  // `ran` set), so each new define:vars text is a new script element. The morph
  // keeps the old ones (beforeNodeRemoved keeps SCRIPT), so they pile up.
  it('LIMIT: each edit of a define:vars value adds one more script element, the old ones stay', async () => {
    preview = await openPreview(PATH);
    const page = preview;

    for (let edit = 1; edit <= EDITS; edit++) {
      await page.draft({ [KEY]: await fixture({ label: `Edit ${edit}` }) });
    }
    await waitUntil(() =>
      page.eval<boolean>(`window.fixtureLabel === 'Edit ${EDITS}'`),
    );

    expect(JSON.parse(await census(page))).toMatchObject({
      defineVarsScripts: 1 + EDITS,
      jsonLd: 1,
      windowLabel: `Edit ${EDITS}`,
      label: `Edit ${EDITS}`,
    });
  });

  // LIMIT (task 1.8a item 3): the JSON-LD text changes, so the bridge appends a new
  // block and the morph keeps the old one. Two blocks hold two names.
  it('LIMIT: a JSON-LD edit appends a second block and keeps the stale one', async () => {
    preview = await openPreview(PATH);
    const page = preview;
    await page.draft({ [KEY]: await fixture({ name: 'Renamed product' }) });
    await waitUntil(() =>
      page.eval<boolean>(
        `document.getElementById('fixture-name').textContent === 'Renamed product'`,
      ),
    );

    expect(await jsonLdNames(page)).toEqual([
      'Fixture product',
      'Renamed product',
    ]);
  });

  it('LIMIT: ten JSON-LD edits leave one block per distinct name, the stale ones included', async () => {
    preview = await openPreview(PATH);
    const page = preview;

    for (let edit = 1; edit <= EDITS; edit++) {
      await page.draft({ [KEY]: await fixture({ name: `Product ${edit}` }) });
    }
    await waitUntil(() =>
      page.eval<boolean>(
        `document.getElementById('fixture-name').textContent === 'Product ${EDITS}'`,
      ),
    );

    const names = await jsonLdNames(page);
    expect(names).toHaveLength(1 + EDITS);
    expect(names.at(-1)).toBe(`Product ${EDITS}`);
  });
});
