import { describe, expect, it } from 'vitest';
import { file, glob } from './stubs-flavor1.ts';

describe('glob', () => {
  it('joins the patterns and keeps the base', () => {
    expect(
      glob({ pattern: ['**/*.md', '**/*.mdx'], base: 'src/content/blog' }),
    ).toStrictEqual({
      kind: 'glob',
      pattern: '**/*.md,**/*.mdx',
      base: 'src/content/blog',
    });
  });

  it('marks a glob with its own generateId as customId, and nothing else', () => {
    expect(glob({ pattern: '**/*.json', generateId: () => 'x' })).toStrictEqual(
      { kind: 'glob', pattern: '**/*.json', customId: true },
    );
  });

  it('leaves customId out of a glob without generateId', () => {
    expect(glob({ pattern: '**/*.json' })).toStrictEqual({
      kind: 'glob',
      pattern: '**/*.json',
    });
  });
});

describe('file', () => {
  it('records the file name as the pattern', () => {
    expect(file('src/content/quotes.json')).toStrictEqual({
      kind: 'file',
      pattern: 'src/content/quotes.json',
    });
  });
});
