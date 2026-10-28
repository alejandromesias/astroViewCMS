import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DataStore } from './documents.ts';
import { collectLanguages, LANGUAGES_FILE, readLanguages } from './languages.ts';

const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'languages-test-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('collectLanguages', () => {
  it('collects the fence languages of the Markdown and MDX files, plus the extra ones, sorted', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'content'));
    fs.writeFileSync(path.join(root, 'content/a.md'), '```js\nx\n```\n');
    fs.writeFileSync(path.join(root, 'content/b.mdx'), '```css\nx\n```\n');
    fs.writeFileSync(path.join(root, 'content/c.json'), '"```ruby\\nx\\n```"');
    const store: DataStore = new Map([
      [
        'pages',
        new Map([
          ['a', { id: 'a', filePath: 'content/a.md' }],
          ['b', { id: 'b', filePath: 'content/b.mdx' }],
          ['c', { id: 'c', filePath: 'content/c.json' }],
          ['gone', { id: 'gone', filePath: 'content/gone.md' }],
          ['none', { id: 'none' }],
        ]),
      ],
    ]);
    expect(collectLanguages(root, store, ['Go', 'ts'])).toEqual(['css', 'go', 'javascript', 'typescript']);
  });
});

describe('readLanguages', () => {
  it('reads the list the build wrote', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, LANGUAGES_FILE), JSON.stringify({ languages: ['css'] }));
    expect(readLanguages(dir)).toEqual(new Set(['css']));
  });

  it('is undefined without a list, which means no restriction', () => {
    expect(readLanguages(tempDir())).toBeUndefined();
  });
});

describe('collectLanguages: which files are read', () => {
  const FENCE = '```ruby\nx\n```\n';
  const storeOf = (...paths: Array<string | undefined>): DataStore =>
    new Map([['c', new Map(paths.map((filePath, i) => [`e${i}`, { id: `e${i}`, filePath }]))]]);
  const siteWith = (files: string[]) => {
    const root = tempDir();
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), FENCE);
    }
    return root;
  };

  it.each(['a.md', 'a.mdx', 'a.markdown', 'a.MD', 'a.Mdx', 'a.MARKDOWN', 'deep/er/a.md'])('reads %s', (file) => {
    expect(collectLanguages(siteWith([file]), storeOf(file))).toEqual(['ruby']);
  });

  it.each(['a.json', 'a.md.txt', 'a.txt', 'a.mdy', 'a.xmd', 'a.md ', 'md', 'a.mdx.json', 'a.markdown2', 'a.yaml'])('does not read %s', (file) => {
    expect(collectLanguages(siteWith([file]), storeOf(file))).toEqual([]);
  });

  it('skips entries without a file path, empty paths and missing files', () => {
    const root = siteWith(['a.md']);
    expect(collectLanguages(root, storeOf(undefined, '', 'gone.md'))).toEqual([]);
  });

  it('resolves paths against the root', () => {
    const root = siteWith(['content/a.md']);
    expect(collectLanguages(root, storeOf('content/a.md'))).toEqual(['ruby']);
    expect(collectLanguages(path.join(root, 'content'), storeOf('content/a.md'))).toEqual([]);
  });

  it('reads every collection and entry, once each language', () => {
    const root = siteWith(['a.md', 'b.md']);
    fs.writeFileSync(path.join(root, 'b.md'), '```go\nx\n```\n\n```ruby\nx\n```\n~~~sh\nx\n~~~\n');
    const store: DataStore = new Map([
      ['one', new Map([['a', { id: 'a', filePath: 'a.md' }]])],
      ['two', new Map([['b', { id: 'b', filePath: 'b.md' }]])],
    ]);
    expect(collectLanguages(root, store)).toEqual(['bash', 'go', 'ruby']);
  });

  it('leaves out plain fences and uses canonical, sorted names for the extra languages', () => {
    const root = tempDir();
    expect(collectLanguages(root, new Map(), ['TS', 'Go', 'ts', 'C++'])).toEqual(['cpp', 'go', 'typescript']);
    expect(collectLanguages(root, new Map())).toEqual([]);
  });
});

describe('readLanguages: details', () => {
  const manifestWith = (text: string) => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, LANGUAGES_FILE), text);
    return dir;
  };

  it('is undefined for a list that is broken or has no languages', () => {
    expect(readLanguages(manifestWith('{broken'))).toBeUndefined();
    expect(readLanguages(manifestWith('{}'))).toBeUndefined();
    expect(readLanguages(manifestWith('{"languages": "css"}'))).toBeUndefined();
    expect(readLanguages(manifestWith('null'))).toBeUndefined();
  });

  it('keeps an empty list, which restricts every language', () => {
    expect(readLanguages(manifestWith('{"languages": []}'))).toEqual(new Set());
  });

  it('names the file code-languages.json', () => {
    expect(LANGUAGES_FILE).toBe('code-languages.json');
  });
});
