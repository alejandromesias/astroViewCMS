import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'devalue';
import { revisionOf, revisionOfEntry } from 'preview-contract';
import { afterEach, describe, expect, it } from 'vitest';
import type { DataStore, LoaderKinds } from './documents.ts';
import { readDataStore, shapeDocuments, withRevisions } from './documents.ts';

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

// Shaped per call, not once at module level: a call made outside a test is not
// linked to any test in Stryker's per-test coverage (TESTING-RECOMMENDATIONS 1).
const shapeSite = () =>
  shapeDocuments({
    store,
    loaderKinds,
    scan,
    buildTimeFields: {
      'data:src/config/config.json': ['site.base_url', 'site.base_path'],
    },
  });
const byKey = (key: string) => shapeSite().find((d) => d.key === key);

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
            ['d', { id: 'd', filePath: 'src/content/misc/d.csv' }],
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
      ['other', false],
    ]);
  });

  it('lists the entries of a collection by id, whatever order the store holds them', () => {
    const shaped = shapeDocuments({
      store: new Map([
        [
          'zeta',
          new Map([
            ['b', { id: 'b' }],
            ['a', { id: 'a' }],
          ]),
        ],
      ]),
      loaderKinds: {},
      scan: { buildTimeFiles: [], dataModules: [] },
    });
    expect(shaped.map((d) => d.key)).toEqual(['zeta/a', 'zeta/b']);
  });

  it.each([
    ['src/a.json', 'json'],
    ['src/a.JSON', 'json'],
    ['src/a.md', 'md'],
    ['src/a.markdown', 'md'],
    ['src/a.MD', 'md'],
    ['src/a.mdx', 'mdx'],
    ['src/a.yaml', 'yaml'],
    ['src/a.yml', 'yaml'],
    ['src/a.toml', 'toml'],
    ['src/a.csv', 'other'],
    ['src/a', 'other'],
    ['src.d/a', 'other'],
  ])('formats %s as %s (D13)', (filePath, format) => {
    const shaped = shapeDocuments({
      store: new Map([['misc', new Map([['a', { id: 'a', filePath }]])]]),
      loaderKinds: {},
      scan: { buildTimeFiles: [], dataModules: [] },
    });
    expect(shaped.map((d) => d.format)).toEqual([format]);
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

  it('D15: a collection without a loader contributes no documents', () => {
    // `notes` has no loader, so loaderKinds holds it as undefined (see
    // integration.ts) and Astro writes no store entries for it.
    const shaped = shapeDocuments({
      store,
      loaderKinds: { ...loaderKinds, notes: undefined },
      scan,
    });
    expect(shaped.map((d) => d.key)).toEqual([
      'authors/ana',
      'blog/generated/post-001',
      'blog/hello',
      'custom/x',
      'testimonials/t-ana',
      'testimonials/t-kofi',
      'data:src/config/config.json',
      'data:src/config/menu.json',
      'data:src/config/theme.json',
    ]);
  });
});

describe('shapeDocuments: data modules and build-time flags (D1)', () => {
  it('adds every imported JSON as data:<path>', () => {
    expect(
      shapeSite()
        .filter((d) => d.key.startsWith('data:'))
        .map((d) => d.key),
    ).toEqual([
      'data:src/config/config.json',
      'data:src/config/menu.json',
      'data:src/config/theme.json',
    ]);
  });

  it('lists the data modules by path, whatever order the scan finds them', () => {
    const shaped = shapeDocuments({
      store: new Map(),
      loaderKinds: {},
      scan: {
        buildTimeFiles: [],
        dataModules: ['src/config/theme.json', 'src/config/menu.json'],
      },
    });
    expect(shaped.map((d) => d.key)).toEqual([
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

describe('withRevisions (WORKPLAN 2.0c)', () => {
  // Site folders made per test, removed afterwards.
  const folders: string[] = [];
  const siteWith = (files: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revisions-'));
    folders.push(root);
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    return root;
  };
  afterEach(() => {
    for (const folder of folders.splice(0))
      fs.rmSync(folder, { recursive: true, force: true });
  });

  /** A store with two entries of one shared testimonials.json file. */
  const testimonialsStore = (ana: unknown, kofi: unknown): DataStore =>
    new Map([
      [
        'testimonials',
        new Map([
          [
            't-ana',
            {
              id: 't-ana',
              filePath: 'src/content/testimonials.json',
              data: ana,
            },
          ],
          [
            't-kofi',
            {
              id: 't-kofi',
              filePath: 'src/content/testimonials.json',
              data: kofi,
            },
          ],
        ]),
      ],
    ]);

  /** Each document's revision, by key, for a store read from `root`. */
  const revisionsOf = (
    root: string,
    store: DataStore,
    loaderKinds: LoaderKinds = { testimonials: 'file' },
  ) =>
    Object.fromEntries(
      withRevisions(
        shapeDocuments({
          store,
          loaderKinds,
          scan: { buildTimeFiles: [], dataModules: [] },
        }),
        store,
        root,
      ).map((document): [string, string] => [document.key, document.revision]),
    );

  it('hashes a document with a file of its own by the bytes of that file', () => {
    const root = siteWith({
      'src/content/blog/hello.md': '# Hello\n',
      'src/config/config.json': '{"title":"Site"}',
    });
    const store: DataStore = new Map([
      [
        'blog',
        new Map([
          ['hello', { id: 'hello', filePath: 'src/content/blog/hello.md' }],
        ]),
      ],
    ]);
    const documents = withRevisions(
      shapeDocuments({
        store,
        loaderKinds: {},
        scan: {
          buildTimeFiles: [],
          dataModules: ['src/config/config.json'],
        },
      }),
      store,
      root,
    );
    expect(documents.map((d) => [d.key, d.revision])).toEqual([
      ['blog/hello', revisionOf('# Hello\n')],
      ['data:src/config/config.json', revisionOf('{"title":"Site"}')],
    ]);
  });

  it('gives a file() entry the hash of its own data, not of the shared file', () => {
    const root = siteWith({
      'src/content/testimonials.json':
        '[{"id":"t-ana","name":"Ana","quote":"Great"},{"id":"t-kofi","name":"Kofi","quote":"Good"}]',
    });
    const ana = { name: 'Ana', quote: 'Great' };
    const revisions = revisionsOf(
      root,
      testimonialsStore(ana, { name: 'Kofi', quote: 'Good' }),
    );
    expect(revisions['testimonials/t-ana']).toBe(revisionOfEntry(ana));
    expect(revisions['testimonials/t-ana']).not.toBe(
      revisions['testimonials/t-kofi'],
    );
  });

  it('keeps every revision when the shared file is only reformatted', () => {
    const root = siteWith({
      'src/content/testimonials.json':
        '[{"id":"t-ana","name":"Ana","quote":"Great"},{"id":"t-kofi","name":"Kofi","quote":"Good"}]',
    });
    const ana = { name: 'Ana', quote: 'Great' };
    const kofi = { name: 'Kofi', quote: 'Good' };
    const before = revisionsOf(root, testimonialsStore(ana, kofi));
    fs.writeFileSync(
      path.join(root, 'src/content/testimonials.json'),
      '[\n  {\n    "quote": "Great",\n    "id": "t-ana",\n    "name": "Ana"\n  },\n  {"id": "t-kofi", "name": "Kofi", "quote": "Good"}\n]\n',
    );
    expect(revisionsOf(root, testimonialsStore(ana, kofi))).toEqual(before);
  });

  it('moves only the revision of the entry whose value in the file changed', () => {
    const kofi = '{"id":"t-kofi","name":"Kofi","quote":"Good"}';
    const root = siteWith({
      'src/content/testimonials.json': `[{"id":"t-ana","name":"Ana","quote":"Great"},${kofi}]`,
    });
    const before = revisionsOf(root, testimonialsStore({}, {}));
    fs.writeFileSync(
      path.join(root, 'src/content/testimonials.json'),
      `[{"id":"t-ana","name":"Ana","quote":"Excellent"},${kofi}]`,
    );
    const after = revisionsOf(root, testimonialsStore({}, {}));
    expect(after['testimonials/t-ana']).not.toBe(before['testimonials/t-ana']);
    expect(after['testimonials/t-kofi']).toBe(before['testimonials/t-kofi']);
  });

  it('takes a file() entry from the file, not from the store data', () => {
    // The store's data has a default the file lacks, as a schema would add it.
    const root = siteWith({
      'src/content/testimonials.json':
        '[{"id":"t-ana","name":"Ana","quote":"Great"}]',
    });
    const withDefault = { name: 'Ana', quote: 'Great', role: 'Guest' };
    const revisions = revisionsOf(
      root,
      new Map([
        [
          'testimonials',
          new Map([
            [
              't-ana',
              {
                id: 't-ana',
                filePath: 'src/content/testimonials.json',
                data: withDefault,
              },
            ],
          ]),
        ],
      ]),
    );
    expect(revisions['testimonials/t-ana']).toBe(
      revisionOfEntry({ name: 'Ana', quote: 'Great' }),
    );
  });

  it('hashes an unquoted YAML date as a Date, as Astro reads it', () => {
    const root = siteWith({
      'src/content/stats.yaml': '- id: editors\n  since: 2026-09-01\n',
    });
    const store: DataStore = new Map([
      [
        'stats',
        new Map([
          [
            'editors',
            { id: 'editors', filePath: 'src/content/stats.yaml', data: {} },
          ],
        ]),
      ],
    ]);
    const [document] = withRevisions(
      shapeDocuments({
        store,
        loaderKinds: { stats: 'file' },
        scan: { buildTimeFiles: [], dataModules: [] },
      }),
      store,
      root,
    );
    expect(document?.revision).toBe(
      revisionOfEntry({ since: new Date('2026-09-01T00:00:00Z') }),
    );
  });

  it('throws naming the entry when the shared file does not hold it', () => {
    const root = siteWith({
      'src/content/testimonials.json': '[{"id":"t-kofi","name":"Kofi"}]',
    });
    expect(() => revisionsOf(root, testimonialsStore({}, {}))).toThrow(
      "src/content/testimonials.json has no entry 't-ana'",
    );
  });

  it('hashes a document with no file by its store data', () => {
    const store: DataStore = new Map([
      ['custom', new Map([['x', { id: 'x', data: { title: 'Plain' } }]])],
    ]);
    const [document] = withRevisions(
      shapeDocuments({
        store,
        loaderKinds: {},
        scan: { buildTimeFiles: [], dataModules: [] },
      }),
      store,
      siteWith({}),
    );
    expect(document?.revision).toBe(revisionOf('{"title":"Plain"}'));
  });

  it('fails in the hash, not in the lookup, for a document with no file whose entry is not in the store', () => {
    expect(() =>
      withRevisions(
        [{ key: 'custom/gone', format: 'other', buildTime: false }],
        new Map(),
        siteWith({}),
      ),
    ).toThrow(/The "data" argument must be of type string/);
  });

  it('hashes an object-keyed file entry with its id, since the key is the id', () => {
    const root = siteWith({
      'src/content/settings.json':
        '{"site":{"id":"site","name":"Ana"},"other":{"name":"Kofi"}}',
    });
    const store: DataStore = new Map([
      [
        'settings',
        new Map([
          [
            'site',
            { id: 'site', filePath: 'src/content/settings.json', data: {} },
          ],
        ]),
      ],
    ]);
    expect(revisionsOf(root, store, { settings: 'file' })).toEqual({
      'settings/site': revisionOf('{"id":"site","name":"Ana"}'),
    });
  });

  it('does not take an inherited property as an object-keyed entry', () => {
    const root = siteWith({
      'src/content/settings.json': '{"site":{"name":"Ana"}}',
    });
    const store: DataStore = new Map([
      [
        'settings',
        new Map([
          [
            'toString',
            {
              id: 'toString',
              filePath: 'src/content/settings.json',
              data: {},
            },
          ],
        ]),
      ],
    ]);
    expect(() => revisionsOf(root, store, { settings: 'file' })).toThrow(
      "src/content/settings.json has no entry 'toString'",
    );
  });

  it('expands a YAML merge key in an object-keyed file, as Astro does', () => {
    const root = siteWith({
      'src/content/stats.yaml':
        'base: &base\n  color: red\nitem:\n  <<: *base\n  size: 2\n',
    });
    const store: DataStore = new Map([
      [
        'stats',
        new Map([
          [
            'item',
            { id: 'item', filePath: 'src/content/stats.yaml', data: {} },
          ],
        ]),
      ],
    ]);
    expect(revisionsOf(root, store, { stats: 'file' })).toEqual({
      'stats/item': revisionOf('{"color":"red","size":2}'),
    });
  });

  it.each(['yml', 'yaml'])('reads a .%s file() entry as YAML', (extension) => {
    const root = siteWith({
      [`src/content/stats.${extension}`]:
        '- id: editors\n  since: 2026-09-01\n',
    });
    const store: DataStore = new Map([
      [
        'stats',
        new Map([
          [
            'editors',
            {
              id: 'editors',
              filePath: `src/content/stats.${extension}`,
              data: {},
            },
          ],
        ]),
      ],
    ]);
    expect(revisionsOf(root, store, { stats: 'file' })).toEqual({
      'stats/editors': revisionOfEntry({
        since: new Date('2026-09-01T00:00:00Z'),
      }),
    });
  });

  it('refuses a file() entry in a format it does not read', () => {
    const root = siteWith({ 'src/content/site.toml': 'title = "Ana"\n' });
    const store: DataStore = new Map([
      [
        'site',
        new Map([
          ['main', { id: 'main', filePath: 'src/content/site.toml', data: {} }],
        ]),
      ],
    ]);
    expect(() => revisionsOf(root, store, { site: 'file' })).toThrow(
      'src/content/site.toml: a file() entry must be JSON or YAML',
    );
  });

  it('finds the array entry past items that are not objects or have no id', () => {
    const root = siteWith({
      'src/content/testimonials.json':
        '[null, "note", 5, {"name":"Nobody"}, {"id":"t-kofi","name":"Kofi"}, {"id":"t-ana","name":"Ana"}]',
    });
    const store: DataStore = new Map([
      [
        'testimonials',
        new Map([
          [
            't-ana',
            {
              id: 't-ana',
              filePath: 'src/content/testimonials.json',
              data: {},
            },
          ],
        ]),
      ],
    ]);
    expect(revisionsOf(root, store)).toEqual({
      'testimonials/t-ana': revisionOf('{"name":"Ana"}'),
    });
  });

  it('finds an array entry by its slug when its id is null', () => {
    const root = siteWith({
      'src/content/testimonials.json':
        '[{"id":null,"slug":"about","name":"About"}]',
    });
    const store: DataStore = new Map([
      [
        'testimonials',
        new Map([
          [
            'about',
            {
              id: 'about',
              filePath: 'src/content/testimonials.json',
              data: {},
            },
          ],
        ]),
      ],
    ]);
    expect(revisionsOf(root, store)).toEqual({
      'testimonials/about': revisionOf('{"id":null,"name":"About"}'),
    });
  });

  it.each([
    ['[{"name":"Ana"}]', 'undefined'],
    ['[{"id":null,"name":"Ana"}]', 'null'],
    ['[{"slug":null,"name":"Ana"}]', 'null'],
  ])('does not take %s as the entry %s', (text, entryId) => {
    const root = siteWith({ 'src/content/testimonials.json': text });
    const store: DataStore = new Map([
      [
        'testimonials',
        new Map([
          [
            entryId,
            {
              id: entryId,
              filePath: 'src/content/testimonials.json',
              data: {},
            },
          ],
        ]),
      ],
    ]);
    expect(() => revisionsOf(root, store)).toThrow(
      `src/content/testimonials.json has no entry '${entryId}'`,
    );
  });

  it.each([
    ['settings.json', 'null'],
    ['settings.yaml', ''],
    ['settings.yaml', 'null\n'],
  ])('says the entry is missing when the whole %s file is %j', (file, text) => {
    const root = siteWith({ [`src/content/${file}`]: text });
    const store: DataStore = new Map([
      [
        'settings',
        new Map([
          [
            'site',
            {
              id: 'site',
              filePath: `src/content/${file}`,
              data: {},
            },
          ],
        ]),
      ],
    ]);
    expect(() => revisionsOf(root, store, { settings: 'file' })).toThrow(
      `src/content/${file} has no entry 'site'`,
    );
  });

  it('reports a YAML syntax error instead of hashing a partial document', () => {
    const root = siteWith({ 'src/content/settings.yaml': 'site: [1, 2\n' });
    const store: DataStore = new Map([
      [
        'settings',
        new Map([
          [
            'site',
            {
              id: 'site',
              filePath: 'src/content/settings.yaml',
              data: {},
            },
          ],
        ]),
      ],
    ]);
    expect(() => revisionsOf(root, store, { settings: 'file' })).toThrow(
      'Flow sequence in block collection must be sufficiently indented',
    );
  });
});
