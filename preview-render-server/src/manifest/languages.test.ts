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
