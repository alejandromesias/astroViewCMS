import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'astro/zod';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { findContentConfig, loadCmsCollections, schemaStubs } from './config-bundle.ts';

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

// -- Mutation-testing additions ----------------------------------------------
// The plugin's hooks are called directly, with a fake `this.resolve`, so every
// branch is reachable without a real build.
describe('schemaStubs', () => {
  const configFile = path.resolve('/site/src/content.config.ts');
  const stubFile = path.resolve('/tool/schema/stubs-flavor2.ts');
  const stubUrl = JSON.stringify(stubFile.replaceAll('\\', '/'));
  const zodFile = path.resolve('/site/node_modules/astro/zod.js');

  type Hooks = {
    transform(this: object, code: string, id: string): string | undefined;
    resolveId(this: object, source: string, importer: string | undefined, options: object): Promise<unknown>;
  };
  const make = (query?: string) => schemaStubs(configFile, stubFile, query) as unknown as Hooks & { name: string; enforce: string };
  const resolver = (result: unknown) => ({ resolve: vi.fn(async () => result) });
  const q = 'preview-cms-schema';
  const rewrite = (code: string) => code.replace(/astro:content|astro\/loaders/, stubFile.replaceAll('\\', '/'));

  it('has a name and runs before other plugins', () => {
    const plugin = make();
    expect(plugin.name).toBe('preview-render-server:schema-stubs');
    expect(plugin.enforce).toBe('pre');
  });

  describe('transform without a query (flavor 1: a standalone bundle)', () => {
    const plugin = make();
    const local = path.resolve('/site/src/schemas.ts');

    it.each([
      ['import { defineCollection } from "astro:content";', `import { defineCollection } from ${stubUrl};`],
      ["import { glob } from 'astro/loaders';", `import { glob } from ${stubUrl};`],
      ['import{glob}from"astro/loaders";', `import{glob}from${stubUrl};`],
      ['import x from   "astro:content"', `import x from   ${stubUrl}`],
    ])('rewrites %j', (code, expected) => {
      expect(plugin.transform.call({}, code, local)).toBe(expected);
    });

    it('rewrites every import in a file, and only those of the two modules', () => {
      const code = 'import a from "astro:content";\nimport b from "astro/loaders";\nimport c from "astro/zod";\nimport d from "./d.ts";';
      expect(plugin.transform.call({}, code, local)).toBe(`import a from ${stubUrl};\nimport b from ${stubUrl};\nimport c from "astro/zod";\nimport d from "./d.ts";`);
    });

    it.each([
      'import a from "astro:content\';',
      'import a from `astro:content`;',
      'import a xfrom "astro:content";',
    ])('leaves %j alone', (code) => {
      expect(plugin.transform.call({}, code, local)).toBe(code);
    });

    it('rewrites any local file, whatever its extension', () => {
      expect(plugin.transform.call({}, 'import a from "astro:content"', path.resolve('/site/src/x.vue'))).toContain(stubFile.replaceAll('\\', '/'));
    });

    it.each([
      ['a file in node_modules', path.resolve('/site/node_modules/pkg/index.js')],
      ['a virtual module', '\0virtual:x'],
      ['the stub itself', stubFile],
      ['the stub in another spelling', stubFile.replaceAll('\\', '/').toUpperCase()],
    ])('does not touch %s', (_name, id) => {
      expect(plugin.transform.call({}, 'import a from "astro:content"', id)).toBeUndefined();
    });
  });

  describe(`transform with a query (flavor 2: inside the Astro build)`, () => {
    const plugin = make(q);
    const code = 'import { z } from "astro:content";';

    it.each(['x.ts', 'x.mts', 'x.cts', 'x.js', 'x.mjs', 'x.cjs', 'x.tsx', 'x.jsx'])('rewrites %s?query', (file) => {
      expect(plugin.transform.call({}, code, `${path.resolve('/site/src', file)}?${q}`)).toBe(rewrite(code).replace(/"[^"]*"/, stubUrl));
    });

    it.each([
      ['a file without the query', path.resolve('/site/src/x.ts')],
      ['another query', `${path.resolve('/site/src/x.ts')}?other`],
      ['the query in the middle', `${path.resolve('/site/src/x.ts')}?${q}&raw`],
      ['a style', `${path.resolve('/site/src/x.css')}?${q}`],
      ['a json file', `${path.resolve('/site/src/x.json')}?${q}`],
      ['a file named like code with a different ending', `${path.resolve('/site/src/x.tsb')}?${q}`],
      ['a file ending with sx but not jsx or tsx', `${path.resolve('/site/src/x.asx')}?${q}`],
      ['a node_modules file', `${path.resolve('/site/node_modules/p/i.js')}?${q}`],
      ['a virtual module', `\0v?${q}`],
    ])('does not touch %s', (_name, id) => {
      expect(plugin.transform.call({}, code, id)).toBeUndefined();
    });
  });

  describe('resolveId', () => {
    it('does nothing for an entry module (no importer)', async () => {
      const context = resolver({ id: 'x' });
      expect(await make().resolveId.call(context, 'astro/zod', undefined, {})).toBeUndefined();
      expect(context.resolve).not.toHaveBeenCalled();
    });

    it('resolves astro/zod for the stub from the site config, so schemas use the site Zod', async () => {
      const context = resolver({ id: zodFile });
      const options = { kind: 'import-statement' };
      expect(await make().resolveId.call(context, 'astro/zod', stubFile, options)).toEqual({ id: zodFile });
      expect(context.resolve).toHaveBeenCalledWith('astro/zod', configFile, { ...options, skipSelf: true });
    });

    it('recognises the stub as importer however its path is written, with or without a query', async () => {
      const context = resolver({ id: zodFile });
      expect(await make().resolveId.call(context, 'astro/zod', `${stubFile.replaceAll('\\', '/').toUpperCase()}?x`, {})).toEqual({ id: zodFile });
    });

    it('says nothing when astro/zod cannot be resolved', async () => {
      expect(await make().resolveId.call(resolver(null), 'astro/zod', stubFile, {})).toBeUndefined();
    });

    it.each([
      ['another module asking for astro/zod', 'astro/zod', path.resolve('/site/src/other.ts')],
      ['the stub asking for another module', 'zod', stubFile],
    ])('leaves alone %s', async (_name, source, importer) => {
      const context = resolver({ id: zodFile });
      expect(await make().resolveId.call(context, source, importer, {})).toBeUndefined();
      expect(context.resolve).not.toHaveBeenCalled();
    });

    describe('flavor 2: the local imports of the config carry the query', () => {
      const plugin = make(q);
      const importer = `${configFile}?${q}`;
      const helper = path.resolve('/site/src/schemas/helpers.ts');

      it('resolves the import and adds the query', async () => {
        const context = resolver({ id: `${helper}?v=3`, external: false });
        expect(await plugin.resolveId.call(context, './schemas/helpers', importer, { kind: 'import-statement' })).toEqual({
          id: `${helper}?${q}`,
          external: false,
        });
        expect(context.resolve).toHaveBeenCalledWith('./schemas/helpers', importer, { kind: 'import-statement', skipSelf: true });
      });

      it.each([
        ['an external module', { id: 'zod', external: true }],
        ['a node_modules file', { id: path.resolve('/site/node_modules/zod/index.js'), external: false }],
        ['a virtual module', { id: '\0virtual', external: false }],
        ['a file that is not code', { id: path.resolve('/site/src/data.json'), external: false }],
        ['the stub itself', { id: stubFile, external: false }],
      ])('hands back %s as it is', async (_name, resolved) => {
        expect(await plugin.resolveId.call(resolver(resolved), 'x', importer, {})).toBe(resolved);
      });

      it('says nothing when the import cannot be resolved', async () => {
        expect(await plugin.resolveId.call(resolver(null), 'x', importer, {})).toBeUndefined();
      });

      it('leaves imports of modules without the query alone', async () => {
        const context = resolver({ id: helper });
        expect(await plugin.resolveId.call(context, './x', path.resolve('/site/src/page.astro'), {})).toBeUndefined();
        expect(context.resolve).not.toHaveBeenCalled();
      });

      it('without a query (flavor 1) an importer ending in "?undefined" is not special', async () => {
        const context = resolver({ id: helper });
        expect(await make().resolveId.call(context, './x', `${configFile}?undefined`, {})).toBeUndefined();
        expect(context.resolve).not.toHaveBeenCalled();
      });
    });
  });
});

describe('findContentConfig: names', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'config-names-'));
  afterAll(() => fs.rmSync(site, { recursive: true, force: true }));
  fs.mkdirSync(path.join(site, 'src'));

  it.each(['content.config.mjs', 'content.config.js', 'content.config.mts'])('finds %s', (name) => {
    const dir = fs.mkdtempSync(path.join(site, 'site-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', name), '');
    expect(findContentConfig(dir)).toBe(path.join(dir, 'src', name));
  });

  it('prefers content.config.ts when there are several', () => {
    const dir = fs.mkdtempSync(path.join(site, 'both-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'content.config.js'), '');
    fs.writeFileSync(path.join(dir, 'src', 'content.config.ts'), '');
    expect(findContentConfig(dir)).toBe(path.join(dir, 'src', 'content.config.ts'));
  });

  it('only looks in src/', () => {
    fs.writeFileSync(path.join(site, 'content.config.ts'), '');
    expect(findContentConfig(site)).toBeUndefined();
  });
});
