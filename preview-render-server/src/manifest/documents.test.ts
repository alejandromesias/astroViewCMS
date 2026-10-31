import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'devalue';
import { describe, expect, it } from 'vitest';
import type { DataStore } from './documents.ts';
import { readDataStore, shapeDocuments } from './documents.ts';

const store: DataStore = new Map([
  [
    'authors',
    new Map([['ana', { id: 'ana', filePath: 'src/content/authors/ana.json' }]]),
  ],
  [
    'blog',
    new Map([
      [
        'generated/post-001',
        {
          id: 'generated/post-001',
          filePath: 'src/content/blog/generated/post-001.mdx',
        },
      ],
      ['hello', { id: 'hello', filePath: 'src\\content\\blog\\hello.md' }],
    ]),
  ],
  [
    'testimonials',
    new Map([
      ['t-ana', { id: 't-ana', filePath: 'src/content/testimonials.json' }],
      ['t-kofi', { id: 't-kofi', filePath: 'src/content/testimonials.json' }],
    ]),
  ],
  ['custom', new Map([['x', { id: 'x' }]])],
]);

const scan = {
  buildTimeFiles: ['src/config/config.json', 'src/config/theme.json'],
  dataModules: [
    'src/config/config.json',
    'src/config/menu.json',
    'src/config/theme.json',
  ],
};
const loaderKinds = { testimonials: 'file' as const, authors: 'glob' as const };

const documents = shapeDocuments({
  store,
  loaderKinds,
  scan,
  buildTimeFields: {
    'data:src/config/config.json': ['site.base_url', 'site.base_path'],
  },
});
const byKey = (key: string) => documents.find((d) => d.key === key);

describe('shapeDocuments: content entries', () => {
  it('keys are collection/id, and the id keeps its slashes (D10)', () => {
    expect(byKey('blog/generated/post-001')).toEqual({
      key: 'blog/generated/post-001',
      file: 'src/content/blog/generated/post-001.mdx',
      format: 'mdx',
      buildTime: false,
    });
  });

  it('records the file that holds the document, with forward slashes (D5)', () => {
    expect(byKey('blog/hello')).toMatchObject({
      file: 'src/content/blog/hello.md',
      format: 'md',
    });
    expect(byKey('authors/ana')).toMatchObject({
      file: 'src/content/authors/ana.json',
      format: 'json',
    });
  });

  it('file() loader documents share a file and carry their key inside it', () => {
    expect(byKey('testimonials/t-ana')).toMatchObject({
      file: 'src/content/testimonials.json',
      entryKey: 't-ana',
    });
    expect(byKey('testimonials/t-kofi')).toMatchObject({
      file: 'src/content/testimonials.json',
      entryKey: 't-kofi',
    });
    expect(byKey('authors/ana')).not.toHaveProperty('entryKey');
  });

  it('formats follow the extension; only TOML and unknown ones are not editable (D13)', () => {
    const shaped = shapeDocuments({
      store: new Map([
        [
          'misc',
          new Map([
            ['a', { id: 'a', filePath: 'src/content/misc/a.yaml' }],
            ['b', { id: 'b', filePath: 'src/content/misc/b.yml' }],
            ['c', { id: 'c', filePath: 'src/content/misc/c.toml' }],
          ]),
        ],
      ]),
      loaderKinds: {},
      scan: { buildTimeFiles: [], dataModules: [] },
    });
    expect(shaped.map((d) => [d.format, d.editable])).toEqual([
      ['yaml', undefined],
      ['yaml', undefined],
      ['toml', false],
    ]);
  });

  it('a read-only collection is not editable, whatever its format; a near-miss name is (site config)', () => {
    const shaped = shapeDocuments({
      store: new Map([
        [
          'fixtures',
          new Map([
            [
              'define-vars',
              {
                id: 'define-vars',
                filePath: 'src/content/fixtures/define-vars.json',
              },
            ],
          ]),
        ],
        [
          'fixtures-notes',
          new Map([
            ['n', { id: 'n', filePath: 'src/content/fixtures-notes/n.json' }],
          ]),
        ],
        [
          'fixturesx',
          new Map([
            ['m', { id: 'm', filePath: 'src/content/fixturesx/m.yaml' }],
          ]),
        ],
      ]),
      loaderKinds: {},
      scan: { buildTimeFiles: [], dataModules: [] },
      readOnlyCollections: ['fixtures'],
    });
    expect(shaped.map((d) => [d.key, d.editable])).toEqual([
      ['fixtures/define-vars', false],
      ['fixtures-notes/n', undefined],
      ['fixturesx/m', undefined],
    ]);
  });

  it('keeps entries from loaders that read no file, without a file', () => {
    expect(byKey('custom/x')).toEqual({
      key: 'custom/x',
      format: 'other',
      editable: false,
      buildTime: false,
    });
  });
});

describe('shapeDocuments: data modules and build-time flags (D1)', () => {
  it('adds every imported JSON as data:<path>', () => {
    expect(
      documents.filter((d) => d.key.startsWith('data:')).map((d) => d.key),
    ).toEqual([
      'data:src/config/config.json',
      'data:src/config/menu.json',
      'data:src/config/theme.json',
    ]);
  });

  it('a scanned file with a field list is build-time for those fields only', () => {
    expect(byKey('data:src/config/config.json')).toMatchObject({
      buildTime: true,
      buildTimeFields: ['site.base_url', 'site.base_path'],
    });
  });

  it('a scanned file without a list counts as all build-time', () => {
    expect(byKey('data:src/config/theme.json')).toMatchObject({
      buildTime: true,
      buildTimeFields: ['*'],
    });
  });

  it('a data module no build code reads is not build-time', () => {
    expect(byKey('data:src/config/menu.json')).toEqual({
      key: 'data:src/config/menu.json',
      file: 'src/config/menu.json',
      format: 'json',
      buildTime: false,
    });
  });

  it('buildTimeFields flags a file the scan missed, and a content entry', () => {
    const flagged = shapeDocuments({
      store,
      loaderKinds,
      scan: { buildTimeFiles: [], dataModules: [] },
      buildTimeFields: {
        'data:src/config/read-with-fs.json': ['*'],
        'authors/ana': ['name'],
      },
    });
    expect(
      flagged.find((d) => d.key === 'data:src/config/read-with-fs.json'),
    ).toMatchObject({
      file: 'src/config/read-with-fs.json',
      buildTime: true,
    });
    expect(flagged.find((d) => d.key === 'authors/ana')).toMatchObject({
      buildTime: true,
      buildTimeFields: ['name'],
    });
  });
});

describe('readDataStore', () => {
  it('is empty for a site without content collections', () => {
    expect(readDataStore(path.join(os.tmpdir(), 'no-such-site')).size).toBe(0);
  });

  it("reads Astro's devalue file and leaves out its bookkeeping collection", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-store-'));
    const written = new Map<string, unknown>([
      [
        'authors',
        new Map([
          ['ana', { id: 'ana', filePath: 'src/content/authors/ana.json' }],
        ]),
      ],
      ['meta::meta', new Map([['astro-config-digest', 'abc']])],
    ]);
    fs.writeFileSync(
      path.join(cacheDir, 'data-store.json'),
      stringify(written),
    );
    const read = readDataStore(cacheDir);
    expect([...read.keys()]).toEqual(['authors']);
    expect(read.get('authors')!.get('ana')!.filePath).toBe(
      'src/content/authors/ana.json',
    );
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });
});
