import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from 'es-module-lexer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cssDirectiveTargets,
  importSpecifiers,
  readAliases,
  resolveSpecifier,
  scanProject,
  stripJsonComments,
} from './import-scan.ts';

const root = path.resolve(import.meta.dirname, '../../test/fixtures/scan-site');

describe('cssDirectiveTargets', () => {
  it('returns @plugin and @config targets, ignoring comments', () => {
    const css = '@plugin "./a.mjs";\n@config \'../b.js\';\n/* @plugin "./c.mjs"; */\n@import "x.css";';
    expect(cssDirectiveTargets(css)).toEqual(['./a.mjs', '../b.js']);
  });
});

describe('stripJsonComments', () => {
  it('removes comments and trailing commas but not what looks like one inside a string', () => {
    const text = '{ /* a */ "include": ["**/*.ts"], // b\n "x": "http://y", }';
    expect(JSON.parse(stripJsonComments(text))).toEqual({ include: ['**/*.ts'], x: 'http://y' });
  });
});

describe('importSpecifiers', () => {
  beforeAll(() => init);

  it('reads JavaScript with es-module-lexer, including import attributes and dynamic imports', () => {
    const source = "import a from './a.json' with { type: 'json' };\nexport * from './b.js';\nawait import('./c.mjs');";
    expect(importSpecifiers('x.mjs', source)).toEqual(['./a.json', './b.js', './c.mjs']);
  });

  it('matches import statements in files that are not plain JavaScript', () => {
    const source = "---\nimport menu from '@/config/menu.json';\nimport type { P } from './types.ts';\n---\n<p>from 'not-an-import'</p>";
    expect(importSpecifiers('x.astro', source)).toContain('@/config/menu.json');
    expect(importSpecifiers('x.astro', source)).toContain('./types.ts');
  });
});

describe('resolveSpecifier', () => {
  const aliases = readAliases(root);
  const from = path.join(root, 'src/layouts/Header.astro');

  it('reads tsconfig paths despite comments and trailing commas', () => {
    expect(aliases.map((a) => a.prefix)).toEqual(['@/components/', '@/']);
  });

  it('resolves relative paths and aliases, the longest alias first', () => {
    expect(resolveSpecifier('../config/config.json', from, aliases, root)).toBe(path.join(root, 'src/config/config.json'));
    expect(resolveSpecifier('@/config/menu.json', from, aliases, root)).toBe(path.join(root, 'src/config/menu.json'));
    expect(resolveSpecifier('@/components/Header.astro', from, aliases, root)).toBe(from);
  });

  it('adds extensions and index files', () => {
    expect(resolveSpecifier('../plugin/helper', from, aliases, root)).toBe(path.join(root, 'src/plugin/helper.js'));
  });

  it('ignores packages and missing files', () => {
    expect(resolveSpecifier('astro/config', from, aliases, root)).toBeUndefined();
    expect(resolveSpecifier('@/nope.json', from, aliases, root)).toBeUndefined();
  });
});

describe('scanProject', () => {
  it('flags JSON imported by astro.config and, through a CSS @plugin, by Tailwind plugins', async () => {
    const { buildTimeFiles } = await scanProject(root);
    expect(buildTimeFiles).toEqual(['src/config/config.json', 'src/config/theme.json']);
  });

  it('lists every JSON that site code imports, and nothing else', async () => {
    const { dataModules } = await scanProject(root);
    expect(dataModules).toEqual(['src/config/config.json', 'src/config/menu.json', 'src/config/theme.json']);
  });

  it('returns nothing for a site without src/', async () => {
    expect(await scanProject(path.join(root, 'src/data'))).toEqual({ buildTimeFiles: [], dataModules: [] });
  });
});

// -- Sites made on the fly ----------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-scan-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
let siteCount = 0;
/** Writes `files` (project-relative path -> text) into a new folder and returns it. */
function makeSite(files: Record<string, string>): string {
  const dir = path.join(tmp, `site${siteCount++}`);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

describe('importSpecifiers details', () => {
  beforeAll(() => init);

  it.each(['a.js', 'a.mjs', 'a.cjs'])('reads %s with the lexer, so strings and comments do not count', (file) => {
    const source = "// from 'in-comment'\nconst s = \"import 'in-string'\";\nimport real from 'real';";
    expect(importSpecifiers(file, source)).toEqual(['real']);
  });

  it.each(['a.ts', 'a.tsx', 'a.jsx', 'a.astro', 'a.mdx', 'a.mts'])('matches the text of %s instead', (file) => {
    expect(importSpecifiers(file, "// from 'in-comment'\nimport real from 'real';")).toEqual(['in-comment', 'real']);
  });

  it('skips dynamic imports with no literal specifier', () => {
    expect(importSpecifiers('a.js', "import(name);\nimport('./lit.js');")).toEqual(['./lit.js']);
  });

  it('falls back to matching when a .js file is not parseable', () => {
    expect(importSpecifiers('a.js', "import x from './x.json';\nconst e = <div />;")).toEqual(['./x.json']);
  });

  it('matches the usual import forms in TypeScript', () => {
    const source = [
      "import a from './a'",
      'import b from "./b"',
      "import './side-effect.css'",
      "import{ c }from'./c'",
      "export * from './d'",
      "const e = await import('./e');",
      "const f = import ( './f' );",
      "import type { G } from './g.ts'",
    ].join('\n');
    expect(importSpecifiers('a.ts', source)).toEqual(['./a', './b', './side-effect.css', './c', './d', './e', './f', './g.ts']);
  });

  it('does not match words that merely end in from or import', () => {
    expect(importSpecifiers('a.ts', "const xfrom 'no';\nconst ximport 'no';\nreimport 'no'")).toEqual([]);
  });

  it('needs a quoted specifier', () => {
    expect(importSpecifiers('a.ts', 'import x from foo;\nfrom ""\nimport("")')).toEqual([]);
  });
});

describe('stripJsonComments details', () => {
  it.each([
    ['a // c\nb', 'a \nb'],
    ['a // c', 'a \n'],
    ['a/* x */b', 'ab'],
    ['a/* x\ny */b', 'ab'],
    ['a/* x', 'a'],
    ['a/b', 'a/b'],
    ['a/', 'a/'],
    ['a / / b', 'a / / b'],
    ['a/*/b*/c', 'ac'],
    ['{"a": 1, // c\n"b": 2}', '{"a": 1, \n"b": 2}'],
  ])('%j gives %j', (text, expected) => {
    expect(stripJsonComments(text)).toBe(expected);
  });

  it('leaves comment-like text in strings, including after an escaped quote', () => {
    expect(stripJsonComments('"a//b" "c/*d*/e" "q\\"//x" // end')).toBe('"a//b" "c/*d*/e" "q\\"//x" \n');
  });

  it('keeps an unterminated string and a lone backslash at the end', () => {
    expect(stripJsonComments('x "abc')).toBe('x "abc');
    expect(stripJsonComments('"a\\')).toBe('"a\\');
  });

  it('removes trailing commas before } and ] only, with any space', () => {
    expect(stripJsonComments('{"a": [1, 2, ], "b": {"c": 1,\n}}')).toBe('{"a": [1, 2 ], "b": {"c": 1\n}}');
    expect(stripJsonComments('[1,2]')).toBe('[1,2]');
    expect(stripJsonComments('{"a": "x,}"}')).toBe('{"a": "x,}"}');
    expect(stripJsonComments('[1, 2]')).toBe('[1, 2]');
  });

  it('handles an empty text', () => {
    expect(stripJsonComments('')).toBe('');
  });
});

describe('readAliases details', () => {
  it('has none without a tsconfig, with broken JSON, or without paths', () => {
    expect(readAliases(makeSite({ 'x.txt': '' }))).toEqual([]);
    expect(readAliases(makeSite({ 'tsconfig.json': '{ not json' }))).toEqual([]);
    expect(readAliases(makeSite({ 'tsconfig.json': '{}' }))).toEqual([]);
    expect(readAliases(makeSite({ 'tsconfig.json': '{"compilerOptions": {}}' }))).toEqual([]);
    expect(readAliases(makeSite({ 'tsconfig.json': '{"compilerOptions": {"baseUrl": "."}}' }))).toEqual([]);
  });

  it('resolves targets against the root, or the baseUrl when there is one', () => {
    const dir = makeSite({ 'tsconfig.json': '{"compilerOptions": {"paths": {"@/*": ["./src/*"]}}}' });
    expect(readAliases(dir)).toEqual([{ prefix: '@/', wildcard: true, targets: [path.join(dir, 'src', '*')] }]);
    const withBase = makeSite({ 'tsconfig.json': '{"compilerOptions": {"baseUrl": "src", "paths": {"~/*": ["lib/*"]}}}' });
    expect(readAliases(withBase)[0]!.targets).toEqual([path.join(withBase, 'src', 'lib', '*')]);
  });

  it('tells wildcard patterns from exact ones, and strips only a final star', () => {
    const dir = makeSite({
      'tsconfig.json': '{"compilerOptions": {"paths": {"utils": ["a.ts", "b.ts"], "a*b/x*": ["c/*"], "*": ["d/*"]}}}',
    });
    expect(readAliases(dir)).toEqual([
      { prefix: 'utils', wildcard: false, targets: [path.join(dir, 'a.ts'), path.join(dir, 'b.ts')] },
      { prefix: 'a*b/x', wildcard: true, targets: [path.join(dir, 'c', '*')] },
      { prefix: '', wildcard: true, targets: [path.join(dir, 'd', '*')] },
    ]);
  });
});

describe('resolveSpecifier details', () => {
  const dir = makeSite({
    'tsconfig.json':
      '{"compilerOptions": {"paths": {"@/*": ["./src/*"], "exact": ["./src/lib/exact.ts"], "multi/*": ["./nowhere/*", "./src/second/*"]}}}',
    'src/pages/index.astro': '',
    'src/pages/helper.ts': '',
    'src/lib/exact.ts': '',
    'src/lib/both.ts': '',
    'src/lib/both.js': '',
    'src/lib/dir/index.ts': '',
    'src/lib/dir2/index.js': '',
    'src/lib/dir2/index.json': '',
    'src/lib/thing.json': '',
    'src/lib/thing.ts': '',
    'src/lib/folder.ts/index.js': '',
    'src/second/found.ts': '',
    'outside.ts': '',
    'src/node_modules/pkg/index.js': '',
  });
  const aliases = readAliases(dir);
  const from = path.join(dir, 'src/pages/index.astro');
  const at = (spec: string) => resolveSpecifier(spec, from, aliases, dir);
  const abs = (rel: string) => path.join(dir, rel);

  it('does not treat a bare word as a relative path', () => {
    expect(at('helper')).toBeUndefined();
    expect(at('helper.ts')).toBeUndefined();
  });

  it('resolves relative specifiers with an exact name, an extension or an index file', () => {
    expect(at('./helper.ts')).toBe(abs('src/pages/helper.ts'));
    expect(at('./helper')).toBe(abs('src/pages/helper.ts'));
    expect(at('../lib/dir')).toBe(abs('src/lib/dir/index.ts'));
    expect(at('../lib/dir2')).toBe(abs('src/lib/dir2/index.js'));
    expect(at('../lib/both')).toBe(abs('src/lib/both.ts'));
    expect(at('../lib/thing')).toBe(abs('src/lib/thing.ts'));
  });

  it('skips a folder with a file-like name and uses its index file', () => {
    expect(at('../lib/folder.ts')).toBe(abs('src/lib/folder.ts/index.js'));
  });

  it('refuses files outside the site and in node_modules', () => {
    expect(at('../../../outside.ts')).toBeUndefined();
    expect(at('../../outside')).toBe(abs('outside.ts'));
    expect(at('../node_modules/pkg')).toBeUndefined();
  });

  it('matches an exact alias only for the whole specifier', () => {
    expect(at('exact')).toBe(abs('src/lib/exact.ts'));
    expect(at('exact/more')).toBeUndefined();
    expect(at('exactly')).toBeUndefined();
  });

  it('fills the star of a wildcard alias, trying each target in order', () => {
    expect(at('@/lib/both')).toBe(abs('src/lib/both.ts'));
    expect(at('multi/found')).toBe(abs('src/second/found.ts'));
    expect(at('multi/missing')).toBeUndefined();
    expect(at('@/')).toBeUndefined();
  });

  it('ignores aliases whose prefix is not at the start', () => {
    expect(at('x@/lib/both')).toBeUndefined();
  });

  it('works without aliases', () => {
    expect(resolveSpecifier('@/lib/both', from, [], dir)).toBeUndefined();
  });
});

describe('scanProject details', () => {
  const json = '{}';

  it.each(['.astro', '.ts', '.mts', '.js', '.mjs', '.cjs', '.tsx', '.jsx', '.mdx'])('scans %s files for data modules', async (ext) => {
    const dir = makeSite({ [`src/code${ext}`]: "import d from './d.json';\n", 'src/d.json': json });
    expect((await scanProject(dir)).dataModules).toEqual(['src/d.json']);
  });

  it.each(['.md', '.txt', '.css', '.json', '.html'])('does not scan %s files', async (ext) => {
    const dir = makeSite({ [`src/code${ext}`]: "import d from './d.json';\n", 'src/d.json': json });
    expect((await scanProject(dir)).dataModules).toEqual([]);
  });

  it('keeps JSON outside src/ and in node_modules out', async () => {
    const dir = makeSite({
      'src/a.ts': "import x from '../outside.json'; import y from './node_modules/p/y.json'; import z from './in.json';",
      'outside.json': json,
      'src/node_modules/p/y.json': json,
      'src/in.json': json,
    });
    expect((await scanProject(dir)).dataModules).toEqual(['src/in.json']);
  });

  it('lists data modules sorted, with forward slashes, once each, also through aliases', async () => {
    const dir = makeSite({
      'tsconfig.json': '{"compilerOptions": {"paths": {"@/*": ["./src/*"]}}}',
      'src/z.ts': "import b from './data/b.json'; import a from '@/data/a.json';",
      'src/y.ts': "import b from './data/b.json';",
      'src/data/a.json': json,
      'src/data/b.json': json,
    });
    expect((await scanProject(dir)).dataModules).toEqual(['src/data/a.json', 'src/data/b.json']);
  });

  it.each(['mjs', 'js', 'ts', 'mts', 'cjs'])('follows astro.config.%s and what it imports', async (ext) => {
    const dir = makeSite({
      [`astro.config.${ext}`]: "import helper from './src/helper.js'; import top from './src/top.json';",
      'src/helper.js': "import deep from './deep/deep.js'; import own from './own.json';",
      'src/deep/deep.js': "import d from './d.json';",
      'src/top.json': json,
      'src/own.json': json,
      'src/deep/d.json': json,
      'src/other.json': json,
    });
    const scan = await scanProject(dir);
    expect(scan.buildTimeFiles).toEqual(['src/deep/d.json', 'src/own.json', 'src/top.json']);
    expect(scan.dataModules).toEqual(['src/deep/d.json', 'src/own.json', 'src/top.json']);
  });

  it('ignores a config with another name, and survives import cycles', async () => {
    const dir = makeSite({
      'astro.config.cts': "import x from './src/x.json';",
      'astro.config.mjs': "import a from './src/a.js';",
      'src/a.js': "import b from './b.js'; import d from './d.json';",
      'src/b.js': "import a from './a.js';",
      'src/x.json': json,
      'src/d.json': json,
    });
    expect((await scanProject(dir)).buildTimeFiles).toEqual(['src/d.json']);
  });

  it('does not count JSON that only page code imports as build-time', async () => {
    const dir = makeSite({ 'src/page.astro': "---\nimport d from './d.json';\n---", 'src/d.json': json });
    const scan = await scanProject(dir);
    expect(scan.buildTimeFiles).toEqual([]);
    expect(scan.dataModules).toEqual(['src/d.json']);
  });

  it('follows @plugin and @config in any stylesheet under src/, relative to the stylesheet', async () => {
    const dir = makeSite({
      'src/styles/deep/theme.css': '@plugin "../../tw/plugin.js";\n@config "./cfg.mjs";\n@plugin "some-package";\n@plugin "./missing.js";',
      'src/tw/plugin.js': "import d from './p.json';",
      'src/tw/p.json': json,
      'src/styles/deep/cfg.mjs': "import d from './c.json';",
      'src/styles/deep/c.json': json,
    });
    expect((await scanProject(dir)).buildTimeFiles).toEqual(['src/styles/deep/c.json', 'src/tw/p.json']);
  });

  it('reads directives only from .css files', async () => {
    const dir = makeSite({
      'src/theme.scss': '@plugin "./p.js";',
      'src/theme.css.txt': '@plugin "./p.js";',
      'src/p.js': "import d from './d.json';",
      'src/d.json': json,
    });
    expect((await scanProject(dir)).buildTimeFiles).toEqual([]);
  });

  it('returns empty lists for a site with nothing in it', async () => {
    expect(await scanProject(makeSite({ 'readme.md': '' }))).toEqual({ buildTimeFiles: [], dataModules: [] });
  });
});
