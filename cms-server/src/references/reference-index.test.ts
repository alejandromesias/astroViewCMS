import type { BundleJson } from 'preview-contract';
import { describe, expect, it } from 'vitest';
import { FIXTURE_BUNDLE } from '../../test/helpers/bundle.ts';
import { readBundle } from '../bundle/read.ts';
import {
  type CollectionSchemaOf,
  createReferenceIndex,
} from './reference-index.ts';

/** The identity of the fixture bundle, as readBundle takes it. */
const identity = (): BundleJson => ({
  bundleId: 'fixture-2026-11-01',
  siteCommit: 'bec46fcadfe832d7bdec8b06eee6ba6546bd2596',
  protocolVersion: 2,
  astroVersion: '7.4.2',
  builtAt: '2026-11-01T10:00:00.000Z',
});

/** The collection schemas of the fixture bundle (the sample's schema.json), read through the 2.4a reader. */
async function sampleSchemaOf(): Promise<CollectionSchemaOf> {
  const bundle = await readBundle(FIXTURE_BUNDLE, identity());
  return (name) => bundle.collections.get(name)?.schema;
}

describe('the reference index on the sample schemas', () => {
  it('lists the posts that name an author, as a string or as { id }', async () => {
    const index = createReferenceIndex(await sampleSchemaOf());
    // Trimmed copies of sample-site/src/content/blog: the author is a string, or { id }. The authors list is plain strings.
    index.rebuild([
      {
        key: 'blog/blog-1',
        value: { title: 'Hello', author: 'ana-torres', authors: ['admin'] },
      },
      { key: 'blog/blog-2', value: { title: 'Two', author: 'marco-rossi' } },
      {
        key: 'blog/blog-3',
        value: { title: 'Three', author: { id: 'ana-torres' } },
      },
    ]);
    expect(index.referrersOf('authors/ana-torres')).toEqual([
      'blog/blog-1',
      'blog/blog-3',
    ]);
    expect(index.referrersOf('authors/marco-rossi')).toEqual(['blog/blog-2']);
    expect(index.referrersOf('authors/admin')).toEqual([]);
  });

  it('lists the landing pages that name a testimonial inside the blocks union', async () => {
    const index = createReferenceIndex(await sampleSchemaOf());
    // A trimmed copy of sample-site/src/content/landing/home-v2.json. The banner block also has items, which are not references.
    index.rebuild([
      {
        key: 'landing/home-v2',
        value: {
          title: 'Home v2 (landing builder)',
          blocks: [
            { type: 'banner', title: 'Banner', items: ['t-lena'] },
            {
              type: 'testimonials',
              title: 'What customers say',
              items: ['t-ana', 't-marco'],
            },
          ],
        },
      },
    ]);
    expect(index.referrersOf('testimonials/t-ana')).toEqual([
      'landing/home-v2',
    ]);
    expect(index.referrersOf('testimonials/t-marco')).toEqual([
      'landing/home-v2',
    ]);
    expect(index.referrersOf('testimonials/t-lena')).toEqual([]);
  });

  it('keeps a reference to a missing document, so that a dangling reference is visible', async () => {
    const index = createReferenceIndex(await sampleSchemaOf());
    index.rebuild([{ key: 'blog/blog-1', value: { author: 'nobody' } }]);
    expect(index.referrersOf('authors/nobody')).toEqual(['blog/blog-1']);
  });
});

describe('the reference index on synthetic schemas', () => {
  it('lists a document among its own referrers when it points at itself', () => {
    const schema = {
      type: 'object',
      properties: {
        parent: { type: 'string', cms: 'reference', collection: 'pages' },
      },
    };
    const index = createReferenceIndex((name) =>
      name === 'pages' ? schema : undefined,
    );
    index.rebuild([
      { key: 'pages/root', value: { parent: 'root' } },
      { key: 'pages/child', value: { parent: 'root' } },
    ]);
    expect(index.referrersOf('pages/root')).toEqual([
      'pages/child',
      'pages/root',
    ]);
  });

  it('reads a reference whose id contains slashes (D10)', () => {
    const schema = {
      type: 'object',
      properties: {
        parent: { type: 'string', cms: 'reference', collection: 'pages' },
      },
    };
    const index = createReferenceIndex((name) =>
      name === 'pages' ? schema : undefined,
    );
    index.rebuild([
      { key: 'pages/a/b', value: { parent: 'a/b' } },
      { key: 'pages/c', value: { parent: 'a/b' } },
    ]);
    expect(index.referrersOf('pages/a/b')).toEqual(['pages/a/b', 'pages/c']);
  });

  it('names no document for an id that is neither a string nor { id }', () => {
    const schema = {
      type: 'object',
      properties: {
        author: { type: 'string', cms: 'reference', collection: 'authors' },
      },
    };
    const index = createReferenceIndex((name) =>
      name === 'blog' ? schema : undefined,
    );
    index.rebuild([
      { key: 'blog/a', value: { author: 42 } },
      { key: 'blog/b', value: { author: { id: 7 } } },
      { key: 'blog/c', value: { author: null } },
    ]);
    expect(index.referrersOf('authors/42')).toEqual([]);
    expect(index.referrersOf('authors/7')).toEqual([]);
    expect(index.referrersOf('authors/null')).toEqual([]);
  });

  it('names no document for a reference whose schema gives no collection', () => {
    const schema = {
      type: 'object',
      properties: { author: { type: 'string', cms: 'reference' } },
    };
    const index = createReferenceIndex((name) =>
      name === 'blog' ? schema : undefined,
    );
    index.rebuild([{ key: 'blog/a', value: { author: 'ana' } }]);
    expect(index.referrersOf('authors/ana')).toEqual([]);
  });

  it('answers a prototype name as an id or as a key with no referrers', () => {
    const schema = {
      type: 'object',
      properties: {
        author: { type: 'string', cms: 'reference', collection: 'authors' },
      },
    };
    const index = createReferenceIndex((name) =>
      name === 'blog' ? schema : undefined,
    );
    index.rebuild([{ key: 'blog/a', value: { author: '__proto__' } }]);
    expect(index.referrersOf('authors/__proto__')).toEqual(['blog/a']);
    expect(index.referrersOf('constructor')).toEqual([]);
    expect(index.referrersOf('toString')).toEqual([]);
    expect(index.referrersOf('__proto__')).toEqual([]);
  });
});

describe('the reference index updates, removals and rebuilds', () => {
  it('moves a referrer to its new target when an update changes the reference', async () => {
    const index = createReferenceIndex(await sampleSchemaOf());
    index.rebuild([{ key: 'blog/blog-1', value: { author: 'ana-torres' } }]);
    index.update('blog/blog-1', { author: 'marco-rossi' });
    expect(index.referrersOf('authors/ana-torres')).toEqual([]);
    expect(index.referrersOf('authors/marco-rossi')).toEqual(['blog/blog-1']);
  });

  it('drops every reference of a document whose update names none', async () => {
    const index = createReferenceIndex(await sampleSchemaOf());
    index.rebuild([{ key: 'blog/blog-1', value: { author: 'ana-torres' } }]);
    index.update('blog/blog-1', { title: 'No author now' });
    expect(index.referrersOf('authors/ana-torres')).toEqual([]);
  });

  it('forgets what a removed document pointed at, and keeps the references to its key', async () => {
    const index = createReferenceIndex(await sampleSchemaOf());
    index.rebuild([
      { key: 'blog/blog-1', value: { author: 'ana-torres' } },
      { key: 'blog/blog-3', value: { author: 'ana-torres' } },
    ]);
    index.remove('blog/blog-1');
    expect(index.referrersOf('authors/ana-torres')).toEqual(['blog/blog-3']);
    index.remove('authors/ana-torres');
    expect(index.referrersOf('authors/ana-torres')).toEqual(['blog/blog-3']);
  });

  it('replaces everything that was indexed before when it rebuilds', async () => {
    const index = createReferenceIndex(await sampleSchemaOf());
    index.rebuild([{ key: 'blog/blog-1', value: { author: 'ana-torres' } }]);
    index.rebuild([{ key: 'blog/blog-2', value: { author: 'marco-rossi' } }]);
    expect(index.referrersOf('authors/ana-torres')).toEqual([]);
    expect(index.referrersOf('authors/marco-rossi')).toEqual(['blog/blog-2']);
  });

  it('points nothing at a data key or at a collection with no schema', async () => {
    const index = createReferenceIndex(await sampleSchemaOf());
    index.rebuild([
      { key: 'data:src/config/theme.json', value: { author: 'ana-torres' } },
      { key: 'unknown/x', value: { author: 'ana-torres' } },
    ]);
    expect(index.referrersOf('authors/ana-torres')).toEqual([]);
  });

  it('does not treat an image field as a reference', async () => {
    const index = createReferenceIndex(await sampleSchemaOf());
    index.rebuild([
      { key: 'authors/marco-rossi', value: { avatar: 'ana-torres' } },
    ]);
    expect(index.referrersOf('authors/ana-torres')).toEqual([]);
  });
});
