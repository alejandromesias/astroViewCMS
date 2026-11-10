import { describe, expect, it } from 'vitest';
import {
  bundleOf,
  documentOf,
  saveContext,
} from '../../test/helpers/save-context.ts';
import type { Bundle } from '../bundle/read.ts';
import { dataOf, isMarkdownDocument } from './markdown.ts';

// The collections of a bundle that has one glob collection `blog` with the given pattern.
function blogCollection(pattern: string): Bundle['collections'] {
  return new Map([
    ['blog', { loader: { kind: 'glob', pattern, base: 'src/content/blog' } }],
  ]) as Bundle['collections'];
}

describe('isMarkdownDocument: a document the bundle or an earlier save holds', () => {
  it('is Markdown for the formats md and mdx', () => {
    for (const format of ['md', 'mdx'] as const) {
      const ctx = saveContext({
        documents: new Map([
          ['blog/a', documentOf('blog/a', { format, file: 'src/a.md' })],
        ]),
      });
      expect(isMarkdownDocument('blog/a', ctx)).toBe(true);
    }
  });

  it('is not Markdown for json, yaml or any other format', () => {
    for (const format of ['json', 'yaml', 'toml'] as const) {
      const ctx = saveContext({
        documents: new Map([
          ['blog/a', documentOf('blog/a', { format, file: 'src/a.x' })],
        ]),
      });
      expect(isMarkdownDocument('blog/a', ctx)).toBe(false);
    }
  });

  it('is not Markdown for one entry of a shared file, whatever the file format', () => {
    const ctx = saveContext({
      documents: new Map([
        [
          'blog/a',
          documentOf('blog/a', {
            format: 'md',
            file: 'src/shared.md',
            entryKey: 'a',
          }),
        ],
      ]),
    });
    expect(isMarkdownDocument('blog/a', ctx)).toBe(false);
  });
});

describe('isMarkdownDocument: a create gets the format of its new file', () => {
  it('takes the first extension of a brace pattern', () => {
    const ctx = saveContext({
      bundle: bundleOf([], blogCollection('**/*.{md,mdx}')),
    });
    expect(isMarkdownDocument('blog/new', ctx)).toBe(true);
  });

  it('takes the only extension of a plain pattern', () => {
    const ctx = saveContext({
      bundle: bundleOf([], blogCollection('**/*.md')),
    });
    expect(isMarkdownDocument('blog/new', ctx)).toBe(true);
  });

  it('is not Markdown when the first extension of the pattern is json', () => {
    const ctx = saveContext({
      bundle: bundleOf([], blogCollection('**/*.{json,md}')),
    });
    expect(isMarkdownDocument('blog/new', ctx)).toBe(false);
  });

  it('has no format when the pattern names no extension', () => {
    const ctx = saveContext({ bundle: bundleOf([], blogCollection('**/*')) });
    expect(isMarkdownDocument('blog/new', ctx)).toBe(false);
  });

  it('takes the newEntryFormat of the config over the pattern', () => {
    const asMdx = saveContext({
      bundle: bundleOf([], blogCollection('**/*.json')),
      config: {
        collections: { blog: { newEntryFormat: 'mdx' } },
        media: { folder: 'src/assets/uploads' },
      },
    });
    expect(isMarkdownDocument('blog/new', asMdx)).toBe(true);
    const asJson = saveContext({
      bundle: bundleOf([], blogCollection('**/*.md')),
      config: {
        collections: { blog: { newEntryFormat: 'json' } },
        media: { folder: 'src/assets/uploads' },
      },
    });
    expect(isMarkdownDocument('blog/new', asJson)).toBe(false);
  });

  it('has no format for a key whose collection the bundle does not hold', () => {
    const ctx = saveContext({ bundle: bundleOf([]) });
    expect(isMarkdownDocument('blog/new', ctx)).toBe(false);
  });

  it('has no format for a key with no collection part', () => {
    const ctx = saveContext({
      bundle: bundleOf([], blogCollection('**/*.md')),
    });
    expect(isMarkdownDocument('loose', ctx)).toBe(false);
  });

  it('reads a prototype key as no collection, not as one of Object.prototype', () => {
    const ctx = saveContext({
      bundle: bundleOf([], blogCollection('**/*.md')),
    });
    expect(isMarkdownDocument('__proto__/new', ctx)).toBe(false);
    expect(isMarkdownDocument('constructor/new', ctx)).toBe(false);
  });
});

describe('dataOf', () => {
  it('gives the data of a Markdown value', () => {
    expect(dataOf({ data: { title: 'Hello' }, body: 'Body\n' })).toStrictEqual({
      title: 'Hello',
    });
  });

  it('gives null when the data is null, not undefined', () => {
    expect(dataOf({ data: null, body: '' })).toBeNull();
  });

  it('gives undefined for a value with no data key', () => {
    expect(dataOf({ body: 'Body\n' })).toBeUndefined();
  });

  it('gives undefined for a value that is not an object', () => {
    expect(dataOf('text')).toBeUndefined();
    expect(dataOf(7)).toBeUndefined();
    expect(dataOf(null)).toBeUndefined();
    expect(dataOf(undefined)).toBeUndefined();
  });
});
