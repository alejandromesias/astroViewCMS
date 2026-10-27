import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'astro/zod';
import { afterAll, describe, expect, it } from 'vitest';
import { findContentConfig, loadCmsCollections } from './config-bundle.ts';

const root = path.resolve(import.meta.dirname, '../../test/fixtures/schema-site');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-pass-'));
afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

const toJson = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as any;

describe('findContentConfig', () => {
  it('finds src/content.config.ts', () => {
    expect(findContentConfig(root)).toBe(path.join(root, 'src', 'content.config.ts'));
  });

  it('returns undefined when the site has none', () => {
    expect(findContentConfig(outDir)).toBeUndefined();
  });
});

describe('loadCmsCollections (flavor 1)', () => {
  // Bundled once: the same bundle answers every test below.
  const collections = findContentConfig(root)
    ? loadCmsCollections(root, findContentConfig(root)!, path.join(outDir, 'flavor1.mjs'))
    : Promise.reject(new Error('no config'));

  it('resolves the "@/" alias from tsconfig.json and shared helpers (D3 TBD)', async () => {
    const { posts } = await collections;
    const json = toJson(posts.schema!);
    expect(json.properties.slug.pattern).toBe('^[a-z0-9-]+$');
  });

  it('records each collection loader', async () => {
    const { authors, quotes } = await collections;
    expect(authors.loader).toEqual({ kind: 'glob', pattern: '**/*.json', base: 'src/content/authors' });
    expect(quotes.loader).toEqual({ kind: 'file', pattern: 'src/content/quotes.json' });
  });

  it('calls schema functions and marks image() fields', async () => {
    const { authors } = await collections;
    expect(toJson(authors.schema!).properties.avatar).toEqual({ type: 'string', cms: 'image' });
  });

  it('marks reference() fields, also inside arrays of a discriminated union', async () => {
    const { posts } = await collections;
    const json = toJson(posts.schema!);
    expect(json.properties.author).toEqual({ type: 'string', cms: 'reference', collection: 'authors' });
    const quoteBlock = json.properties.blocks.items.oneOf.find((b: any) => b.properties.type.const === 'quote');
    expect(quoteBlock.properties.items.items).toEqual({ type: 'string', cms: 'reference', collection: 'quotes' });
  });

  it('exports a discriminated union as oneOf', async () => {
    const { posts } = await collections;
    expect(toJson(posts.schema!).properties.blocks.items.oneOf).toHaveLength(2);
  });
});
