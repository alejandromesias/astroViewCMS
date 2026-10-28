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

describe('extractHead: what counts as the head, the title and a meta tag', () => {
  it('does not take <header> for <head>, nor other tags that start with the same letters', () => {
    expect(extractHead('<header><title>T</title><meta name="a" content="b"></header>')).toEqual({ meta: [] });
    expect(extractHead('<head><title-x>no</title-x><titles>no</titles><metadata name="a"></metadata></head>')).toEqual({ meta: [] });
  });

  it('accepts attributes on the tags, any letter case and line breaks', () => {
    const html = '<HEAD lang="en">\n<TITLE id="t">\n  Two\n  lines\n</TITLE>\n<META NAME="a" content="b">\n</HEAD>';
    expect(extractHead(html)).toEqual({ title: 'Two\n  lines', meta: [{ NAME: 'a', content: 'b' }] });
  });

  it('ignores a title and meta tags outside the head', () => {
    const html = '<title>Body</title><meta name="x" content="y"><head><meta name="a" content="b"></head><title>After</title>';
    expect(extractHead(html)).toEqual({ meta: [{ name: 'a', content: 'b' }] });
  });

  it('stops at the first </head>, and a head without a title has no title key', () => {
    const result = extractHead('<head><meta name="a" content="1"></head><meta name="b" content="2"></head>');
    expect(result).toEqual({ meta: [{ name: 'a', content: '1' }] });
    expect('title' in result).toBe(false);
  });

  it('keeps an empty or blank title as an empty string', () => {
    expect(extractHead('<head><title></title></head>')).toEqual({ title: '', meta: [] });
    expect(extractHead('<head><title>   </title></head>')).toEqual({ title: '', meta: [] });
  });

  it('takes the first title', () => {
    expect(extractHead('<head><title>One</title><title>Two</title></head>').title).toBe('One');
  });

  it('reads self-closing meta tags and attributes without a value', () => {
    expect(extractHead('<head><meta name="a" content="b" /><meta itemscope></head>').meta).toEqual([
      { name: 'a', content: 'b' },
      { itemscope: '' },
    ]);
  });

  it('reads quoted values with spaces, single quotes inside double quotes and unquoted values', () => {
    expect(extractHead(`<head><meta name="a b" content="it's"><meta name='x' content=y></head>`).meta).toEqual([
      { name: 'a b', content: "it's" },
      { name: 'x', content: 'y' },
    ]);
  });

  it('keeps an empty attribute value', () => {
    expect(extractHead('<head><meta name="a" content=""></head>').meta).toEqual([{ name: 'a', content: '' }]);
  });
});

describe('extractHead: entities', () => {
  it.each([
    ['&quot;', '"'],
    ['&#39;', "'"],
    ['&lt;', '<'],
    ['&gt;', '>'],
    ['&amp;', '&'],
  ])('decodes %s in titles and attribute values', (entity, character) => {
    const result = extractHead(`<head><title>a${entity}b</title><meta content="a${entity}b"></head>`);
    expect(result.title).toBe(`a${character}b`);
    expect(result.meta[0]!.content).toBe(`a${character}b`);
  });

  it('decodes every occurrence, and decodes &amp; last so that it is not decoded twice', () => {
    expect(extractHead('<head><title>&lt;a&gt; &lt;b&gt; &amp;lt; &amp;amp;</title></head>').title).toBe('<a> <b> &lt; &amp;amp;'.replace('&amp;amp;', '&amp;'));
  });
});

describe('stripSourceScripts: details', () => {
  const tag = (src: string, extra = '') => `<script ${extra}src="${src}"${extra ? '' : ''}></script>`;

  it('removes the tag with ?astro&type=script written either way', () => {
    expect(stripSourceScripts(tag('/a/Foo.astro?astro&type=script&index=0&lang.ts'))).toBe('');
    expect(stripSourceScripts(tag('/a/Foo.astro?astro&amp;type=script&amp;index=0'))).toBe('');
  });

  it('removes every such tag, also with other attributes around src', () => {
    const html = `x<script type="module" src="/a.astro?astro&type=script" defer></script>y<script src="/b.astro?astro&type=script&index=1"></script>z`;
    expect(stripSourceScripts(html)).toBe('xyz');
  });

  it('keeps tags that only look similar', () => {
    for (const kept of [
      '<script src="/a.astro?astro&type=style"></script>',
      '<script src="/a.astro?type=script"></script>',
      '<script src="/a.astro?astro&amp;amp;type=script"></script>',
      '<script src="/a.js"></script>',
      '<script>const x = "?astro&type=script";</script>',
      '<script src="/a.astro?astro&type=script">code</script>',
      '<script src="/a.astro?astro&type=script"',
      '<scripts src="/a.astro?astro&type=script"></scripts>',
    ]) {
      expect(stripSourceScripts(kept)).toBe(kept);
    }
  });

  it('works on text without such tags', () => {
    expect(stripSourceScripts('')).toBe('');
    expect(stripSourceScripts('<p>hi</p>')).toBe('<p>hi</p>');
  });
});
