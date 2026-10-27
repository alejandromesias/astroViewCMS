import { describe, expect, it } from 'vitest';
import { canonicalLanguage, codeLanguages, restrictLanguages } from './languages.ts';

const doc = ['# T', '', '```js title="a.js"', 'const a = 1;', '```', '', '~~~Python', 'x = 1', '~~~', '', '```', 'plain', '```', ''].join('\n');

describe('canonicalLanguage', () => {
  it('lowercases and resolves aliases', () => {
    expect(canonicalLanguage('JS')).toBe('javascript');
    expect(canonicalLanguage('C++')).toBe('cpp');
    expect(canonicalLanguage('css')).toBe('css');
  });
});

describe('codeLanguages', () => {
  it('lists the canonical languages of backtick and tilde fences, not plain ones', () => {
    expect([...codeLanguages(doc)].sort()).toEqual(['javascript', 'python']);
  });

  it('ignores fence-like lines inside a longer fence and an unclosed fence stays open', () => {
    const text = ['````md', '```ruby', '```', '````', '', '```go', 'unclosed'].join('\n');
    expect([...codeLanguages(text)].sort()).toEqual(['go', 'markdown']);
  });

  it('reads the language before a brace or a space', () => {
    expect([...codeLanguages('```ts{1,3}\nx\n```\n\n``` sh\nx\n```')].sort()).toEqual(['bash', 'typescript']);
  });

  it('handles CRLF text', () => {
    expect([...codeLanguages('```css\r\na{}\r\n```\r\n')]).toEqual(['css']);
  });
});

describe('restrictLanguages', () => {
  it('turns fences outside the list into text, keeps the rest of the line, and reports each', () => {
    const limited: string[] = [];
    const out = restrictLanguages(doc, new Set(['javascript']), (language) => limited.push(language));
    expect(out).toContain('```js title="a.js"');
    expect(out).toContain('~~~text\nx = 1');
    expect(limited).toEqual(['python']);
  });

  it('keeps a fence whose alias is allowed and leaves plain fences alone', () => {
    const limited: string[] = [];
    const out = restrictLanguages('```ts\nx\n```\n\n```text\nx\n```\n\n```\nx\n```', new Set(['typescript']), (l) => limited.push(l));
    expect(out).toBe('```ts\nx\n```\n\n```text\nx\n```\n\n```\nx\n```');
    expect(limited).toEqual([]);
  });

  it('does not touch text inside a code block that looks like a fence', () => {
    const text = '````md\n```ruby\nx\n```\n````';
    const limited: string[] = [];
    expect(restrictLanguages(text, new Set(['markdown']), (l) => limited.push(l))).toBe(text);
    expect(limited).toEqual([]);
  });

  it('an empty list limits every language', () => {
    const limited: string[] = [];
    restrictLanguages(doc, new Set(), (l) => limited.push(l));
    expect(limited).toEqual(['javascript', 'python']);
  });
});
