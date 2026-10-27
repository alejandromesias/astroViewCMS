import path from 'node:path';
import { z } from 'astro/zod';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schemaStubs, STUB_QUERY, STUBS } from './config-bundle.ts';
import { defineCollection, file, glob, hooks, image, reference } from './stubs-flavor2.ts';
import type { CollectionInfo } from './stubs-flavor2.ts';

const defaults = { ...hooks };
afterEach(() => Object.assign(hooks, defaults));

const png = { src: '/_astro/a.hash.png', width: 1200, height: 800, format: 'png' };

describe('image() (flavor 2)', () => {
  it('turns a known path into its metadata', () => {
    hooks.resolveImage = (p) => (p === '../a.png' ? png : undefined);
    expect(image().parse('../a.png')).toEqual(png);
  });

  it('fails the field when the path resolves to nothing', () => {
    expect(() => image().parse('../missing.png')).toThrow(/image not found: \.\.\/missing\.png/);
  });

  it('lets refinements see real metadata', () => {
    hooks.resolveImage = () => png;
    const wide = image().refine((meta) => (meta as unknown as typeof png).width >= 1080);
    expect(wide.parse('a.png')).toEqual(png);
    hooks.resolveImage = () => ({ ...png, width: 400 });
    expect(() => wide.parse('a.png')).toThrow();
  });

  it('keeps the marker for the editor', () => {
    expect(z.globalRegistry.get(image())).toEqual({ cms: 'image' });
  });
});

describe('reference() (flavor 2)', () => {
  it('turns a string or an { id } into { collection, id }', () => {
    expect(reference('authors').parse('ana')).toEqual({ collection: 'authors', id: 'ana' });
    expect(reference('authors').parse({ id: 'ana' })).toEqual({ collection: 'authors', id: 'ana' });
  });

  it('checks that the target exists (overlay null counts as missing)', () => {
    hooks.referenceExists = (collection, id) => collection === 'authors' && id === 'ana';
    expect(reference('authors').parse('ana').id).toBe('ana');
    expect(() => reference('authors').parse('ghost')).toThrow(/authors\/ghost does not exist/);
  });
});

describe('defineCollection and loaders (flavor 2)', () => {
  it('records the loader and calls schema functions with image()', () => {
    const collection = defineCollection({
      loader: glob({ pattern: ['**/*.json', '**/*.md'], base: 'src/content/a' }),
      schema: ({ image: img }) => z.object({ avatar: img() }),
    });
    expect(collection.loader).toEqual({ kind: 'glob', pattern: '**/*.json,**/*.md', base: 'src/content/a' });
    hooks.resolveImage = () => png;
    expect(collection.schema!.parse({ avatar: 'x.png' })).toEqual({ avatar: png });
  });

  it('records a file() loader and accepts a plain schema', () => {
    const collection = defineCollection({ loader: file('src/content/q.json'), schema: z.object({ text: z.string() }) });
    expect(collection.loader).toEqual({ kind: 'file', pattern: 'src/content/q.json' });
  });
});

// The same content config, compiled by Vite (as in the preview build) with the
// plugin that swaps in the flavor 2 stubs. "@" is aliased here because Astro
// adds the tsconfig aliases in a real build.
describe('content config through Vite with the flavor 2 stubs', () => {
  const root = path.resolve(import.meta.dirname, '../../test/fixtures/schema-site');
  const configFile = path.join(root, 'src/content.config.ts');
  let server: ViteDevServer;
  let collections: Record<string, CollectionInfo>;
  // The stubs as Vite loaded them: a separate instance from this file's import.
  let viteHooks: typeof hooks;

  beforeAll(async () => {
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true, watch: null },
      resolve: { alias: { '@': path.join(root, 'src') } },
      plugins: [schemaStubs(configFile, STUBS[2], STUB_QUERY) as never],
    });
    viteHooks = ((await server.ssrLoadModule(STUBS[2])) as { hooks: typeof hooks }).hooks;
    collections = ((await server.ssrLoadModule(`${configFile}?${STUB_QUERY}`)) as { collections: Record<string, CollectionInfo> }).collections;
  });
  afterAll(() => server.close());

  it('exposes the collections with their loaders', () => {
    expect(Object.keys(collections)).toEqual(['authors', 'quotes', 'posts']);
    expect(collections.quotes.loader).toEqual({ kind: 'file', pattern: 'src/content/quotes.json' });
  });

  it('parses a draft: shared helpers run, references are checked, images resolve', () => {
    viteHooks.resolveImage = () => png;
    viteHooks.referenceExists = (collection, id) => id !== 'ghost';
    const post = (author: string, slug = 'my-post') => ({
      slug,
      author,
      blocks: [{ type: 'quote', items: ['q1'] }],
    });
    const parsed = collections.posts.schema!.parse(post('ana')) as { author: unknown; blocks: { items: unknown[] }[] };
    expect(parsed.author).toEqual({ collection: 'authors', id: 'ana' });
    expect(parsed.blocks[0].items).toEqual([{ collection: 'quotes', id: 'q1' }]);
    expect(() => collections.posts.schema!.parse(post('ghost'))).toThrow(/authors\/ghost/);
    expect(() => collections.posts.schema!.parse(post('ana', 'Bad Slug'))).toThrow();
    expect(collections.authors.schema!.parse({ name: 'Ana', avatar: 'a.png' })).toEqual({ name: 'Ana', avatar: png });
  });
});
