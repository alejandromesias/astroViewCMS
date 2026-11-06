import { describe, expect, it } from 'vitest';
import { FIXTURE_BUNDLE } from '../../test/helpers/bundle.ts';
import { readBundle } from '../bundle/read.ts';
import {
  collectionOf,
  documentKey,
  formatOfExtension,
  formatOfPath,
  globIdOf,
  relativeToBase,
  slugOf,
} from './paths.ts';

// The expected ids are what Astro 7's `getContentEntryIdAndSlug` gives for the same file names (checked on 2026-11-03).
describe('globIdOf', () => {
  it.each([
    ['My Post.md', 'my-post'],
    ['blog/index.md', 'blog'],
    ['index.md', 'index'],
    ['x/index.md', 'x'],
    ['a/index/index.md', 'a/index'],
    ['blog/indexes.md', 'blog/indexes'],
    ['a/My Post.md', 'a/my-post'],
    ['Über Café.md', 'über-café'],
    ['-index.md', '-index'],
    ['a/b/c.mdx', 'a/b/c'],
    ['x.test.md', 'xtest'],
    ['a.b/c.d.md', 'ab/cd'],
    ['Hello_World.md', 'hello_world'],
    ['p1.5.md', 'p15'],
  ])('gives %s the id %s', (path, id) => {
    expect(globIdOf(path, undefined)).toBe(id);
  });

  it.each([
    ['a truthy slug', 'custom-slug', 'custom-slug'],
    ['a number slug, as text', 42, '42'],
    ['an empty slug, which is ignored', '', 'my-post'],
    ['a zero slug, which is ignored', 0, 'my-post'],
    ['a null slug, which is ignored', null, 'my-post'],
  ])('uses %s', (_name, slug, id) => {
    expect(globIdOf('My Post.md', slug)).toBe(id);
  });

  it('keeps the case of a slug and does not slug it again', () => {
    expect(globIdOf('x.md', 'Keep Case')).toBe('Keep Case');
  });
});

describe('formatOfExtension', () => {
  it.each([
    ['json', 'json'],
    ['md', 'md'],
    ['mdx', 'mdx'],
    ['yaml', 'yaml'],
    ['yml', 'yaml'],
    ['toml', 'toml'],
    ['txt', undefined],
    ['MD', undefined],
    ['', undefined],
  ])('reads the extension %j as %s', (extension, format) => {
    expect(formatOfExtension(extension)).toBe(format);
  });
});

describe('formatOfPath', () => {
  it('gives a file with no known extension the format other', () => {
    expect(formatOfPath('src/content/blog/a.txt')).toBe('other');
    expect(formatOfPath('src/content/blog/README')).toBe('other');
    expect(formatOfPath('src/content/blog/a.md')).toBe('md');
  });
});

describe('relativeToBase', () => {
  it.each([
    ['no base', undefined, 'src/a.md', 'src/a.md'],
    ['a base of the site folder', '.', 'src/a.md', 'src/a.md'],
    [
      'a base with a trailing slash',
      'src/content/blog/',
      'src/content/blog/a.md',
      'a.md',
    ],
    [
      'a base with a ./ prefix',
      './src/content/blog',
      'src/content/blog/x/a.md',
      'x/a.md',
    ],
    [
      'a sibling with the same start',
      'src/content/blog',
      'src/content/blog-old/a.md',
      undefined,
    ],
    [
      'a file outside the base',
      'src/content/blog',
      'src/content/a.md',
      undefined,
    ],
  ])('handles %s', (_name, base, path, relative) => {
    expect(relativeToBase(base, path)).toBe(relative);
  });
});

describe('collectionOf', () => {
  it.each([
    ['blog/a', 'blog'],
    ['blog/x/y', 'blog'],
    ['data:src/config/config.json', 'data:src'],
    ['nodash', undefined],
  ])('reads the collection of %s', (key, collection) => {
    expect(collectionOf(key)).toBe(collection);
  });
});

describe('documentKey', () => {
  it('joins the collection and the id with a slash', () => {
    expect(documentKey('authors', 'noor-haddad')).toBe('authors/noor-haddad');
  });

  it('keeps the slashes of an id (D10)', () => {
    expect(documentKey('blog', 'generated/post-001')).toBe(
      'blog/generated/post-001',
    );
    expect(collectionOf(documentKey('blog', 'generated/post-001'))).toBe(
      'blog',
    );
  });

  it('keeps a prototype name as an id', () => {
    expect(documentKey('authors', '__proto__')).toBe('authors/__proto__');
  });
});

describe('slugOf', () => {
  it('reads data.slug for Markdown and the top-level slug for the other formats', () => {
    expect(slugOf({ data: { slug: 'md-slug' }, body: '' }, 'md')).toBe(
      'md-slug',
    );
    expect(slugOf({ data: { slug: 'mdx-slug' }, body: '' }, 'mdx')).toBe(
      'mdx-slug',
    );
    expect(slugOf({ slug: 'json-slug' }, 'json')).toBe('json-slug');
    expect(slugOf({ slug: 'yaml-slug' }, 'yaml')).toBe('yaml-slug');
  });

  it('has no slug for a Markdown slug kept at the top, a non-object, or no slug', () => {
    expect(slugOf({ slug: 'top' }, 'md')).toBeUndefined();
    expect(slugOf('text', 'md')).toBeUndefined();
    expect(slugOf(['slug'], 'json')).toBeUndefined();
    expect(slugOf({ title: 'x' }, 'json')).toBeUndefined();
    expect(slugOf(null, 'json')).toBeUndefined();
    expect(slugOf(null, 'md')).toBeUndefined();
  });
});

describe('the keys of the fixture bundle', () => {
  // The fixture is a sample-site build. Each glob document's key is the id of its file under its collection's base.
  it('are the ids that globIdOf gives their files', async () => {
    const bundle = await readBundle(FIXTURE_BUNDLE, {
      bundleId: 'fixture-2026-11-03',
      siteCommit: '4523c67c55284f8bd3ae1b61caa6d5501ccc77ab',
      protocolVersion: 2,
      astroVersion: '7.4.2',
      builtAt: '2026-11-04T03:42:22.323Z',
    });
    const globDocuments = [...bundle.documents.values()].filter((document) => {
      const loader = bundle.collections.get(
        collectionOf(document.key) ?? '',
      )?.loader;
      return (
        document.entryKey === undefined &&
        document.file !== undefined &&
        loader?.kind === 'glob'
      );
    });
    expect(globDocuments.length).toBeGreaterThan(0);
    const built = globDocuments.map((document) => {
      const collection = collectionOf(document.key) ?? '';
      const base = bundle.collections.get(collection)?.loader?.base;
      const relative = relativeToBase(base, document.file ?? '');
      return `${collection}/${globIdOf(relative ?? '', undefined)}`;
    });
    expect(built).toEqual(globDocuments.map((document) => document.key));
  });

  it('are rebuilt by documentKey from their collection and their id (drift from the renderer)', async () => {
    // The renderer writes `${collection}/${entry.id}` (preview-render-server manifest/documents.ts); this checks that format.
    const bundle = await readBundle(FIXTURE_BUNDLE, {
      bundleId: 'fixture-2026-11-03',
      siteCommit: '4523c67c55284f8bd3ae1b61caa6d5501ccc77ab',
      protocolVersion: 2,
      astroVersion: '7.4.2',
      builtAt: '2026-11-04T03:42:22.323Z',
    });
    const keys = [...bundle.documents.keys()];
    expect(keys).toContain('testimonials/t-ana');
    for (const key of keys) {
      const collection = collectionOf(key) ?? '';
      expect(documentKey(collection, key.slice(collection.length + 1))).toBe(
        key,
      );
    }
  });
});
