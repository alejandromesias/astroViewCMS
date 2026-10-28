import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { contentImportRewrite, dataModuleSource, dataModules, isRewritten, rewriteContentImports } from './plugins.ts';

const srcDir = path.resolve('/site/src');
const shimFile = path.resolve('/tool/src/overlay/content-shim.ts');
const shim = shimFile.replaceAll('\\', '/');

describe('rewriteContentImports', () => {
  it('rewrites static, side-effect and dynamic imports, single or double quoted', () => {
    const code = [
      'import { getCollection } from "astro:content";',
      "import { getEntry } from 'astro:content';",
      'import "astro:content";',
      'const m = await import("astro:content");',
      'export { render } from "astro:content";',
    ].join('\n');
    const out = rewriteContentImports(code, shim);
    expect(out).not.toContain('astro:content');
    expect(out.match(new RegExp(shim.replaceAll('/', '\\/'), 'g'))).toHaveLength(5);
  });

  it('leaves other imports and strings that only mention it alone', () => {
    const code = 'import x from "astro:assets";\nconst s = "astro:content is a module";';
    expect(rewriteContentImports(code, shim)).toBe(code);
  });
});

describe('isRewritten (D8)', () => {
  it.each([
    'pages/index.astro',
    'layouts/Post.tsx',
    'lib/contentParser.astro', // helper modules too, not only pages and components
    'lib/helpers.ts',
    'lib/legacy.js',
    'components/Card.jsx',
    'content/pages/elements.mdx',
  ])('rewrites %s', (file) => expect(isRewritten(path.join(srcDir, file), srcDir)).toBe(true));

  it.each(['content.config.ts', 'content.config.mjs'])('skips %s', (file) => {
    expect(isRewritten(path.join(srcDir, file), srcDir)).toBe(false);
  });

  it('skips modules outside src/ and files that are not code', () => {
    expect(isRewritten(path.resolve('/site/node_modules/pkg/index.js'), srcDir)).toBe(false);
    expect(isRewritten(path.resolve('/site/astro.config.mjs'), srcDir)).toBe(false);
    expect(isRewritten(path.join(srcDir, 'styles/main.css'), srcDir)).toBe(false);
  });
});

describe('contentImportRewrite plugin', () => {
  const make = () => {
    const warn = vi.fn();
    const plugin = contentImportRewrite({ srcDir, shimFile });
    const transform = (code: string, id: string) =>
      (plugin.transform as unknown as (this: object, code: string, id: string) => { code: string } | undefined).call({ warn }, code, id);
    return { plugin, transform, warn };
  };
  const code = 'import { getEntry } from "astro:content";';

  it('runs after the other plugins, so it sees compiled .astro and .mdx', () => {
    expect(make().plugin.enforce).toBe('post');
  });

  it('rewrites modules under src/, including query variants of the same file', () => {
    const { transform } = make();
    expect(transform(code, path.join(srcDir, 'pages/index.astro'))!.code).toContain(shim);
    expect(transform(code, `${path.join(srcDir, 'lib/x.ts')}?v=1`)!.code).toContain(shim);
  });

  it('does not touch the content config or the shim itself, and does not warn about them', () => {
    const { transform, warn } = make();
    expect(transform(code, path.join(srcDir, 'content.config.ts'))).toBeUndefined();
    expect(transform(code, shimFile)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores code that does not mention astro:content and virtual modules', () => {
    const { transform, warn } = make();
    expect(transform('const a = 1;', path.join(srcDir, 'a.ts'))).toBeUndefined();
    expect(transform(code, '\0virtual:something')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once about a module outside src/ that reads astro:content, but not about Astro itself', () => {
    const { transform, warn } = make();
    const pkg = path.resolve('/site/node_modules/some-cms-widgets/index.js');
    expect(transform(code, pkg)).toBeUndefined();
    transform(code, pkg);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/outside src\/.*won't be overlaid/);
    transform(code, path.resolve('/site/node_modules/astro/dist/content/runtime.js'));
    transform(code, path.resolve('/site/.astro/content-modules.mjs'));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('dataModuleSource', () => {
  const proxyFile = 'C:\\tool\\src\\overlay\\data-proxy.ts';

  it('proxies the default export and each object-valued named export, others stay as built', () => {
    const source = dataModuleSource({ nav_button: { label: 'Go' }, title: 'T', list: [1], 'not-valid': {}, default: {} }, 'data:src/c.json', proxyFile);
    expect(source).toContain('import { proxyData } from "C:/tool/src/overlay/data-proxy.ts";');
    expect(source).toContain('export default (typeof built === \'object\' && built !== null) ? proxyData("data:src/c.json", built) : built;');
    expect(source).toContain('export const nav_button = proxyData("data:src/c.json", built["nav_button"], "nav_button");');
    expect(source).toContain('export const list = proxyData("data:src/c.json", built["list"], "list");');
    expect(source).toContain('export const title = built["title"];'); // the limit: primitives
    expect(source).not.toContain('export const not-valid');
    expect(source).not.toContain('export const default');
  });

  it('an array file only has a default export', () => {
    const source = dataModuleSource([1, 2], 'data:src/l.json', proxyFile);
    expect(source).not.toContain('export const');
  });

  it('is valid JavaScript that works', async () => {
    const source = dataModuleSource({ a: { b: 1 } }, 'data:src/c.json', proxyFile).replace(/^import .*$/m, 'const proxyData = (_k, v) => v;');
    const url = `data:text/javascript,${encodeURIComponent(source)}`;
    const mod = await import(/* @vite-ignore */ url);
    expect(mod.default.a.b).toBe(1);
    expect(mod.a.b).toBe(1);
  });
});

describe('dataModules plugin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-modules-'));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/config'), { recursive: true });
  const menu = path.join(root, 'src/config/menu.json');
  const other = path.join(root, 'src/config/other.json');
  fs.writeFileSync(menu, JSON.stringify({ main: [] }));
  fs.writeFileSync(other, '{}');

  const plugin = dataModules({ root, srcDir: path.join(root, 'src'), files: [menu], proxyFile: '/tool/data-proxy.ts' });
  const resolveId = plugin.resolveId as unknown as (this: object, ...args: unknown[]) => Promise<unknown>;
  const load = plugin.load as unknown as (id: string) => string | undefined;
  const context = { resolve: vi.fn(async (source: string) => ({ id: path.join(root, 'src/config', path.basename(source)) })) };
  const importer = path.join(root, 'src/layouts/Header.astro');

  it('handles an imported data module under a name that Vite\'s own JSON plugin ignores', async () => {
    const id = (await resolveId.call(context, '@/config/menu.json', importer, {})) as string;
    expect(id.startsWith('\0preview-data:')).toBe(true);
    expect(id.endsWith('.json')).toBe(false);
    const source = load(id)!;
    expect(source).toContain('proxyData("data:src/config/menu.json", built)');
  });

  it('ignores JSON that is not a data module, imports from outside src/, and non-JSON', async () => {
    expect(await resolveId.call(context, '@/config/other.json', importer, {})).toBeUndefined();
    expect(await resolveId.call(context, '@/config/menu.json', path.join(root, 'astro.config.mjs'), {})).toBeUndefined();
    expect(await resolveId.call(context, './x.ts', importer, {})).toBeUndefined();
    expect(load('/plain/file.json')).toBeUndefined();
  });
});

// -- Mutation-testing additions ----------------------------------------------
describe('rewriteContentImports: spacing and quoting', () => {
  it.each([
    'import x from"astro:content";',
    'import x   from   "astro:content";',
    'import"astro:content";',
    'import\t"astro:content";',
    'const m = import  (  "astro:content");',
    'const m = import("astro:content");',
  ])('rewrites %j', (code) => {
    expect(rewriteContentImports(code, shim)).toBe(code.replace('astro:content', shim));
  });

  it.each([
    'import x from "astro:content\';', // mismatched quotes
    'import x from `astro:content`;',
    'import x xfrom "astro:content";', // not the keyword `from`
    'const importer = "astro:content";',
  ])('leaves %j alone', (code) => {
    expect(rewriteContentImports(code, shim)).toBe(code);
  });

  it('writes the shim path as a JSON string', () => {
    expect(rewriteContentImports('import x from "astro:content";', 'C:\\a "b"\\shim.ts')).toBe('import x from "C:\\\\a \\"b\\"\\\\shim.ts";');
  });
});

describe('isRewritten: the content config name', () => {
  it.each(['content.config.ts', 'content.config.js'])('skips %s', (file) => {
    expect(isRewritten(path.join(srcDir, file), srcDir)).toBe(false);
  });

  it.each(['my.content.config.ts', 'content.config.tsx', 'content.configs.ts', 'content-config.ts'])('rewrites %s', (file) => {
    expect(isRewritten(path.join(srcDir, file), srcDir)).toBe(true);
  });

  it('does not rewrite the content config of a sub folder only by its folder name', () => {
    expect(isRewritten(path.join(srcDir, 'content.config.ts/helper.ts'), srcDir)).toBe(true);
  });

  it('a sibling folder that merely starts with the same name is outside src/', () => {
    expect(isRewritten(path.resolve('/site/src-other/a.ts'), srcDir)).toBe(false);
    expect(isRewritten(srcDir, srcDir)).toBe(false); // the folder itself has no code extension
  });
});

describe('contentImportRewrite: details', () => {
  const run = (code: string, id: string) => {
    const warn = vi.fn();
    const plugin = contentImportRewrite({ srcDir, shimFile });
    const transform = plugin.transform as unknown as (this: object, code: string, id: string) => { code: string; map: null } | undefined;
    return { result: transform.call({ warn }, code, id), warn };
  };

  it('is named for the plugin list', () => {
    expect(contentImportRewrite({ srcDir, shimFile }).name).toBe('preview-render-server:content-import-rewrite');
  });

  it('returns the rewritten code with no source map', () => {
    const { result } = run('import { a } from "astro:content";', path.join(srcDir, 'a.ts'));
    expect(result).toEqual({ code: `import { a } from ${JSON.stringify(shim)};`, map: null });
  });

  it('returns nothing for a src module that only mentions astro:content in a string', () => {
    expect(run('const s = "astro:content";', path.join(srcDir, 'a.ts')).result).toBeUndefined();
  });

  it('does not warn about modules outside src/ that never mention astro:content', () => {
    expect(run('const a = 1;', path.resolve('/site/node_modules/pkg/index.js')).warn).not.toHaveBeenCalled();
  });

  it('skips virtual modules even inside src/ paths', () => {
    expect(run('import x from "astro:content";', `\0${path.join(srcDir, 'a.ts')}`).result).toBeUndefined();
  });

  it('recognises the shim however its path is written', () => {
    const { result, warn } = run('import x from "astro:content";', shim);
    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(run('import x from "astro:content";', shim.toUpperCase()).warn).not.toHaveBeenCalled();
  });

  it('warns with the file name, and a query does not make it a different file', () => {
    const pkg = path.resolve('/site/node_modules/some-widgets/index.js');
    const warn = vi.fn();
    const plugin = contentImportRewrite({ srcDir, shimFile });
    const transform = plugin.transform as unknown as (this: object, code: string, id: string) => unknown;
    transform.call({ warn }, 'import x from "astro:content";', `${pkg}?v=1`);
    transform.call({ warn }, 'import x from "astro:content";', `${pkg}?v=2`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(pkg);
  });
});

describe('dataModuleSource: names and values', () => {
  const proxyFile = '/tool/data-proxy.ts';
  const exportsOf = (built: unknown) => dataModuleSource(built, 'data:k', proxyFile).split('\n').slice(3);

  // Every word that cannot be a binding name in a module must be skipped, or the
  // generated module does not even parse and the whole preview breaks.
  const reserved = [
    'default', 'class', 'function', 'var', 'let', 'const', 'import', 'export', 'new', 'delete', 'if', 'else', 'return', 'switch',
    'case', 'for', 'while', 'do', 'break', 'continue', 'typeof', 'void', 'null', 'true', 'false', 'this', 'super', 'in', 'try',
    'catch', 'throw', 'with', 'yield', 'await', 'enum', 'implements', 'interface', 'package', 'private', 'protected', 'public',
    'static', 'eval', 'arguments', 'debugger', 'instanceof', 'extends',
  ];

  it.each(reserved)('skips the key %s', (word) => {
    expect(exportsOf({ [word]: 1, ok: 2 })).toEqual(['export const ok = built["ok"];']);
  });

  it('generates a module that parses for every one of those keys', async () => {
    const built = Object.fromEntries(reserved.map((word) => [word, 1]));
    const source = dataModuleSource(built, 'data:k', proxyFile).replace(/^import .*$/m, 'const proxyData = (_k, v) => v;');
    const mod = await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`);
    expect(mod.default).toEqual(built);
  });

  it.each(['$ok', '_ok', 'a1', 'camelCase'])('exports the valid name %s', (name) => {
    expect(exportsOf({ [name]: 1 })).toEqual([`export const ${name} = built["${name}"];`]);
  });

  it.each(['1a', 'a-b', 'a b', 'é', ''])('skips the invalid name %j', (name) => {
    expect(exportsOf({ [name]: 1 })).toEqual([]);
  });

  it('null and primitive files have a default export only, and null stays null', () => {
    for (const built of [null, 'text', 5, true]) {
      const lines = dataModuleSource(built, 'data:k', proxyFile).split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toBe(`const built = ${JSON.stringify(built)};`);
    }
  });

  it('a null value stays as built, not proxied', () => {
    expect(exportsOf({ a: null })).toEqual(['export const a = built["a"];']);
  });

  it('an array file has only a default export, even when its items are objects', () => {
    expect(exportsOf([{ a: 1 }])).toEqual([]);
  });

  it('a Windows proxy path is written with forward slashes', () => {
    expect(dataModuleSource({}, 'k', 'C:\\t\\p.ts').split('\n')[0]).toBe('import { proxyData } from "C:/t/p.ts";');
  });
});

describe('dataModules plugin: details', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-modules-d-'));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/config'), { recursive: true });
  const menu = path.join(root, 'src/config/menu.json');
  fs.writeFileSync(menu, JSON.stringify({ main: [1] }));
  const plugin = dataModules({ root, srcDir: path.join(root, 'src'), files: [menu], proxyFile: '/tool/data-proxy.ts' });
  const resolveId = plugin.resolveId as unknown as (this: object, ...args: unknown[]) => Promise<unknown>;
  const load = plugin.load as unknown as (id: string) => string | undefined;
  const importer = path.join(root, 'src/layouts/Header.astro');
  const contextFor = (id: string) => ({ resolve: vi.fn(async () => ({ id })) });

  it('is named, and runs before the other plugins', () => {
    expect(plugin.name).toBe('preview-render-server:data-modules');
    expect(plugin.enforce).toBe('pre');
  });

  it('asks Vite to resolve the import without calling itself again, passing its options on', async () => {
    const context = contextFor(menu);
    await resolveId.call(context, '@/config/menu.json', importer, { custom: { a: 1 } });
    expect(context.resolve).toHaveBeenCalledWith('@/config/menu.json', importer, { custom: { a: 1 }, skipSelf: true });
  });

  it.each([
    ['no importer', 'x.json', undefined],
    ['not a .json import', './x.ts', importer],
    ['an import that merely contains .json', './x.json.ts', importer],
    ['a virtual importer', 'x.json', '\0virtual'],
    ['an importer outside src/', 'x.json', path.join(root, 'other/a.astro')],
  ])('does not even resolve: %s', async (_name, source, from) => {
    const context = contextFor(menu);
    expect(await resolveId.call(context, source, from, {})).toBeUndefined();
    expect(context.resolve).not.toHaveBeenCalled();
  });

  it('gives up when Vite cannot resolve the import', async () => {
    const context = { resolve: vi.fn(async () => null) };
    expect(await resolveId.call(context, 'x.json', importer, {})).toBeUndefined();
  });

  it('accepts an importer with a query, and a resolved id with a query', async () => {
    const id = (await resolveId.call(contextFor(`${menu}?import`), 'x.json', `${importer}?astro&type=script`, {})) as string;
    expect(id).toBe(`\0preview-data:${path.normalize(menu)}.js`);
  });

  it('matches the data files regardless of case and slash style', async () => {
    const id = await resolveId.call(contextFor(menu.replaceAll('\\', '/').toUpperCase()), 'x.json', importer, {});
    expect(id).toEqual(expect.stringContaining('\0preview-data:'));
  });

  it('loads the file the id names and keys it by its path from the root', () => {
    const source = load(`\0preview-data:${menu}.js`)!;
    expect(source).toContain('proxyData("data:src/config/menu.json", built)');
    expect(source).toContain('const built = {"main":[1]};');
    expect(source).toContain('export const main = proxyData("data:src/config/menu.json", built["main"], "main");');
  });
});
