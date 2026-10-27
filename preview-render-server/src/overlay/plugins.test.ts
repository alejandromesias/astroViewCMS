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
    expect(warn.mock.calls[0][0]).toMatch(/outside src\/.*won't be overlaid/);
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
