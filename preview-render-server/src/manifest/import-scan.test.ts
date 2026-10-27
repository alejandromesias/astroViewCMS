import path from 'node:path';
import { init } from 'es-module-lexer';
import { beforeAll, describe, expect, it } from 'vitest';
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
