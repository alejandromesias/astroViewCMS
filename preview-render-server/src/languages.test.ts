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

describe('aliases', () => {
  it.each([
    ['js', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'],
    ['ts', 'typescript'], ['mts', 'typescript'], ['cts', 'typescript'],
    ['sh', 'bash'], ['shell', 'bash'], ['shellscript', 'bash'], ['zsh', 'bash'],
    ['yml', 'yaml'], ['md', 'markdown'], ['py', 'python'], ['rb', 'ruby'],
    ['c++', 'cpp'], ['c#', 'csharp'], ['cs', 'csharp'], ['rs', 'rust'],
    ['golang', 'go'], ['kt', 'kotlin'], ['ps1', 'powershell'],
  ])('%s is %s', (alias, language) => {
    expect(canonicalLanguage(alias)).toBe(language);
    expect(canonicalLanguage(alias.toUpperCase())).toBe(language);
  });

  it('keeps unknown languages, lowercased', () => {
    expect(canonicalLanguage('Rust')).toBe('rust');
    expect(canonicalLanguage('toString')).toBe('tostring');
    expect(canonicalLanguage('')).toBe('');
  });

  it('does not read names inherited from Object.prototype as aliases', () => {
    expect(canonicalLanguage('constructor')).toBe('constructor');
    expect(canonicalLanguage('__proto__')).toBe('__proto__');
    expect([...codeLanguages('```constructor\nx\n```')]).toEqual(['constructor']);
    const limited: unknown[] = [];
    restrictLanguages('```__proto__\nx\n```', new Set(), (l) => limited.push(l));
    expect(limited).toEqual(['__proto__']);
  });
});

describe('plain text languages', () => {
  it.each(['', 'text', 'txt', 'plain', 'plaintext', 'TEXT', 'PlainText'])('%j is not reported and not limited', (language) => {
    const text = `\`\`\`${language}\nx\n\`\`\``;
    const limited: string[] = [];
    expect(codeLanguages(text).size).toBe(0);
    expect(restrictLanguages(text, new Set(), (l) => limited.push(l))).toBe(text);
    expect(limited).toEqual([]);
  });

  it('a name that only contains a plain word is a language', () => {
    expect([...codeLanguages('```texts\nx\n```\n\n```ptext\nx\n```')].sort()).toEqual(['ptext', 'texts']);
  });
});

describe('opening fences', () => {
  const languages = (text: string) => [...codeLanguages(text)];

  it('accepts up to three spaces of indent, not four', () => {
    expect(languages('   ```go\nx\n```')).toEqual(['go']);
    expect(languages('    ```go\nx\n```')).toEqual([]);
    expect(languages('\t```go\nx\n```')).toEqual([]);
  });

  it('needs three markers, of one kind', () => {
    expect(languages('``go\nx\n``')).toEqual([]);
    expect(languages('~~go\nx\n~~')).toEqual([]);
    expect(languages('`~`go\nx')).toEqual([]);
    expect(languages('~~~go\nx')).toEqual(['go']);
    expect(languages('`````go\nx')).toEqual(['go']);
  });

  it('must start the line', () => {
    expect(languages('x ```go\ny')).toEqual([]);
    expect(languages('- ```go\ny')).toEqual([]);
  });

  it('allows spaces and tabs before the language, and stops it at a space, brace or backtick', () => {
    expect(languages('```   go')).toEqual(['go']);
    expect(languages('```\tgo')).toEqual(['go']);
    expect(languages('```go title="x"')).toEqual(['go']);
    expect(languages('```go\ttitle')).toEqual(['go']);
    expect(languages('```go{1,2}')).toEqual(['go']);
    expect(languages('```go`x')).toEqual(['go']);
    expect(languages('```{1,2}')).toEqual([]);
  });

  it('a fence line with only a language-less title is plain', () => {
    expect(languages('``` {1}\nx')).toEqual([]);
  });
});

describe('closing fences', () => {
  const languages = (text: string) => [...codeLanguages(text)];

  it('closes on a line with the same marker, at least as long, with only spaces after', () => {
    expect(languages('```a\n```\n```b\n```')).toEqual(['a', 'b']);
    expect(languages('```a\n````\n```b\n```')).toEqual(['a', 'b']);
    expect(languages('```a\n```   \n```b\n```')).toEqual(['a', 'b']);
    expect(languages('```a\n```\t\n```b\n```')).toEqual(['a', 'b']);
    expect(languages('```a\n   ```\n```b\n```')).toEqual(['a', 'b']);
    expect(languages('```a\n```\r\n```b\n```')).toEqual(['a', 'b']);
  });

  it('does not close on anything else', () => {
    expect(languages('````a\n```\n```b\n````')).toEqual(['a']);
    expect(languages('```a\n~~~\n```b\n```')).toEqual(['a']);
    expect(languages('```a\n``\n```b\n```')).toEqual(['a']);
    expect(languages('```a\n    ```\n```b\n```')).toEqual(['a']);
    expect(languages('```a\n```x\n```b\n```')).toEqual(['a']);
    expect(languages('```a\n``` x\n```b\n```')).toEqual(['a']);
    expect(languages('```a\nx ```\n```b\n```')).toEqual(['a']);
    expect(languages('```a\n```b\n```')).toEqual(['a']);
  });

  it('a tilde fence closes only on tildes', () => {
    expect(languages('~~~a\n```\n~~~b\n~~~')).toEqual(['a']);
    expect(languages('~~~a\n~~~\n~~~b\n~~~')).toEqual(['a', 'b']);
  });

  it('a closing line is not read as a new opening', () => {
    expect(languages('```a\n```\nplain')).toEqual(['a']);
  });
});

describe('restrictLanguages edits', () => {
  const limit = (text: string, allowed: string[] = []) => {
    const limited: string[] = [];
    return { out: restrictLanguages(text, new Set(allowed), (l) => limited.push(l)), limited };
  };

  it('replaces only the language, wherever it starts', () => {
    expect(limit('```ruby').out).toBe('```text');
    expect(limit('   ```ruby').out).toBe('   ```text');
    expect(limit('~~~~  ruby title="x"').out).toBe('~~~~  text title="x"');
    expect(limit('```\truby{1}').out).toBe('```\ttext{1}');
    expect(limit('```Ruby\nx\n```').out).toBe('```text\nx\n```');
  });

  it('reports the canonical name of the alias that was limited', () => {
    expect(limit('```RB\nx\n```').limited).toEqual(['ruby']);
    expect(limit('```c++\nx\n```').limited).toEqual(['cpp']);
  });

  it('does not report allowed or plain languages', () => {
    expect(limit('```rb\nx\n```', ['ruby'])).toEqual({ out: '```rb\nx\n```', limited: [] });
  });

  it('handles every fence in a document and leaves other lines alone', () => {
    const text = 'a\n```ruby\nx\n```\nb\n```go\ny\n```\nc';
    expect(limit(text, ['go'])).toEqual({ out: 'a\n```text\nx\n```\nb\n```go\ny\n```\nc', limited: ['ruby'] });
    expect(limit(text).limited).toEqual(['ruby', 'go']);
  });

  it('keeps CRLF line ends', () => {
    expect(limit('```ruby\r\nx\r\n```\r\n').out).toBe('```text\r\nx\r\n```\r\n');
  });

  it('keeps text without fences exactly', () => {
    expect(limit('').out).toBe('');
    expect(limit('a\n\nb\n').out).toBe('a\n\nb\n');
  });
});
