import { describe, expect, it } from 'vitest';
import { extractHead, stripSourceScripts } from './head.ts';

describe('extractHead', () => {
  it('reads the title and the attributes of each meta tag', () => {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title> A &amp; B </title>
      <meta name="description" content="Say &quot;hi&quot;"><meta property='og:title' content=plain></head><body><meta name="x" content="body"></body></html>`;
    expect(extractHead(html)).toEqual({
      title: 'A & B',
      meta: [
        { charset: 'UTF-8' },
        { name: 'description', content: 'Say "hi"' },
        { property: 'og:title', content: 'plain' },
      ],
    });
  });

  it('a page without head data gives an empty result', () => {
    expect(extractHead('<p>fragment</p>')).toEqual({ meta: [] });
  });
});

describe('stripSourceScripts', () => {
  it('removes dev-only component script references and keeps real scripts', () => {
    const dev = '<script type="module" src="/abs/Foo.astro?astro&amp;type=script&amp;index=0&amp;lang.ts"></script>';
    const real = '<script type="module" src="/_astro/page.abc.js"></script>';
    expect(stripSourceScripts(`<a></a>${dev}${real}`)).toBe(`<a></a>${real}`);
  });
});
