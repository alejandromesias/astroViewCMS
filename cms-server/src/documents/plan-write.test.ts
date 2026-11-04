import type { CollectionSchemaJson } from 'preview-contract';
import { describe, expect, it } from 'vitest';
import type { DocumentEntry } from '../bundle/read.ts';
import { type PlanContext, planWrite, type WriteChange } from './plan-write.ts';

const TESTIMONIALS = 'src/content/testimonials.json';
const STATS = 'src/content/stats.yaml';

/** A context over `files` (path to text): a path that is not in `files` is missing. */
function ctxOf(
  files: Record<string, string>,
  documents: readonly DocumentEntry[] = [],
  collections: Record<string, CollectionSchemaJson> = {},
  config: PlanContext['config'] = { collections: {} },
): PlanContext {
  const texts = new Map(Object.entries(files));
  return {
    readText: async (path) => texts.get(path) ?? null,
    documents: new Map(
      documents.map((d): [string, DocumentEntry] => [d.key, d]),
    ),
    collections: new Map(Object.entries(collections)),
    config,
  };
}

/** A document record, with the fields a test does not vary filled in. */
function docOf(
  fields: Pick<DocumentEntry, 'key' | 'format'> & Partial<DocumentEntry>,
): DocumentEntry {
  return { buildTime: false, revision: 'r1', ...fields };
}

/** The collection of a file() loader over one shared file. */
function fileLoader(pattern: string): CollectionSchemaJson {
  return { loader: { kind: 'file', pattern } };
}

/** The collection of a glob loader. */
function globLoader(pattern: string, base: string): CollectionSchemaJson {
  return { loader: { kind: 'glob', pattern, base } };
}

describe('planWrite: file() collections', () => {
  it('adds an entry to testimonials.json', async () => {
    const ctx = ctxOf(
      { [TESTIMONIALS]: '[\n  { "id": "ana", "quote": "Great" }\n]\n' },
      [],
      { testimonials: fileLoader(TESTIMONIALS) },
    );
    const ops = await planWrite(
      [
        {
          op: 'create',
          collection: 'testimonials',
          id: 'ben',
          value: { quote: 'Fine' },
        },
      ],
      ctx,
    );
    expect(ops).toEqual([
      {
        op: 'write',
        path: TESTIMONIALS,
        text: '[\n  {\n    "id": "ana",\n    "quote": "Great"\n  },\n  {\n    "id": "ben",\n    "quote": "Fine"\n  }\n]\n',
      },
    ]);
  });

  it('adds an entry to stats.yaml', async () => {
    const ctx = ctxOf({ [STATS]: '- id: a\n  value: 1\n' }, [], {
      stats: fileLoader(STATS),
    });
    const ops = await planWrite(
      [{ op: 'create', collection: 'stats', id: 'b', value: { value: 2 } }],
      ctx,
    );
    expect(ops).toEqual([
      {
        op: 'write',
        path: STATS,
        text: '- id: a\n  value: 1\n- id: b\n  value: 2\n',
      },
    ]);
  });

  it('applies two changes to one shared file in one save, in order', async () => {
    const ctx = ctxOf(
      { [TESTIMONIALS]: '[\n  { "id": "ana", "quote": "Great" }\n]\n' },
      [
        docOf({
          key: 'testimonials/ana',
          file: TESTIMONIALS,
          format: 'json',
          entryKey: 'ana',
        }),
      ],
      { testimonials: fileLoader(TESTIMONIALS) },
    );
    const changes: WriteChange[] = [
      {
        op: 'create',
        collection: 'testimonials',
        id: 'ben',
        value: { quote: 'Fine' },
      },
      { op: 'delete', key: 'testimonials/ana' },
    ];
    const ops = await planWrite(changes, ctx);
    expect(ops).toEqual([
      {
        op: 'write',
        path: TESTIMONIALS,
        text: '[\n  {\n    "id": "ben",\n    "quote": "Fine"\n  }\n]\n',
      },
    ]);
  });

  it('keeps the file when its last entry is deleted', async () => {
    const ctx = ctxOf(
      { [TESTIMONIALS]: '[\n  { "id": "ana", "quote": "Great" }\n]\n' },
      [
        docOf({
          key: 'testimonials/ana',
          file: TESTIMONIALS,
          format: 'json',
          entryKey: 'ana',
        }),
      ],
      { testimonials: fileLoader(TESTIMONIALS) },
    );
    const ops = await planWrite(
      [{ op: 'delete', key: 'testimonials/ana' }],
      ctx,
    );
    expect(ops).toEqual([{ op: 'write', path: TESTIMONIALS, text: '[]\n' }]);
  });

  it('updates a file() entry in place', async () => {
    const ctx = ctxOf(
      { [STATS]: '- id: a\n  value: 1\n' },
      [
        docOf({
          key: 'stats/a',
          file: STATS,
          format: 'yaml',
          entryKey: 'a',
        }),
      ],
      { stats: fileLoader(STATS) },
    );
    const ops = await planWrite(
      [{ op: 'update', key: 'stats/a', value: { id: 'a', value: 5 } }],
      ctx,
    );
    expect(ops).toEqual([
      { op: 'write', path: STATS, text: '- id: a\n  value: 5\n' },
    ]);
  });

  it('refuses a create whose entry already exists (exists)', async () => {
    const ctx = ctxOf({ [STATS]: '- id: a\n  value: 1\n' }, [], {
      stats: fileLoader(STATS),
    });
    await expect(
      planWrite(
        [{ op: 'create', collection: 'stats', id: 'a', value: { value: 9 } }],
        ctx,
      ),
    ).rejects.toMatchObject({
      name: 'WritePlanError',
      code: 'exists',
      key: 'stats/a',
      message: 'An entry with the id "a" already exists',
    });
  });

  it('refuses a create when the shared file is missing (file-missing)', async () => {
    const ctx = ctxOf({}, [], { stats: fileLoader(STATS) });
    await expect(
      planWrite(
        [{ op: 'create', collection: 'stats', id: 'a', value: { value: 9 } }],
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'file-missing',
      key: 'stats/a',
      file: STATS,
      message: `The file "${STATS}" is missing`,
    });
  });

  it('refuses a create into a file() loader whose file has no codec (unwritable)', async () => {
    const ctx = ctxOf({ 'src/content/x.toml': 'a = 1\n' }, [], {
      x: fileLoader('src/content/x.toml'),
    });
    await expect(
      planWrite([{ op: 'create', collection: 'x', id: 'b', value: {} }], ctx),
    ).rejects.toMatchObject({
      code: 'unwritable',
      key: 'x/b',
      message: 'The file "src/content/x.toml" has no format the CMS can write',
    });
  });

  it('turns a CodecError into an unwritable refusal with the file and position', async () => {
    const ctx = ctxOf({ [STATS]: '- id: a\n  value: [\n' }, [], {
      stats: fileLoader(STATS),
    });
    await expect(
      planWrite(
        [{ op: 'create', collection: 'stats', id: 'b', value: { value: 2 } }],
        ctx,
      ),
    ).rejects.toMatchObject({
      name: 'WritePlanError',
      code: 'unwritable',
      key: 'stats/b',
      file: STATS,
      line: 3,
      column: 1,
    });
  });
});

describe('planWrite: glob collections', () => {
  const HOME = 'src/content/homepage';

  it('writes a homepage create whose id matches the pattern (-index.md)', async () => {
    const ctx = ctxOf({}, [], {
      homepage: globLoader('**/-*.{md,mdx}', HOME),
    });
    const ops = await planWrite(
      [
        {
          op: 'create',
          collection: 'homepage',
          id: '-index',
          value: { data: { title: 'Hi' }, body: 'Text\n' },
        },
      ],
      ctx,
    );
    expect(ops).toEqual([
      {
        op: 'write',
        path: `${HOME}/-index.md`,
        text: '---\ntitle: Hi\n---\nText\n',
      },
    ]);
  });

  it('refuses a homepage create whose id does not match the pattern (index.md)', async () => {
    const ctx = ctxOf({}, [], {
      homepage: globLoader('**/-*.{md,mdx}', HOME),
    });
    await expect(
      planWrite(
        [
          {
            op: 'create',
            collection: 'homepage',
            id: 'index',
            value: { data: {}, body: 'Text\n' },
          },
        ],
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'pattern-mismatch',
      key: 'homepage/index',
      message: '"index.md" does not match the loader pattern "**/-*.{md,mdx}"',
    });
  });

  it('writes a Markdown create from an empty file: only the body when there is no data', async () => {
    const ctx = ctxOf({}, [], {
      blog: globLoader('**/*.{md,mdx}', 'src/content/blog'),
    });
    const ops = await planWrite(
      [
        {
          op: 'create',
          collection: 'blog',
          id: 'hello',
          value: { data: {}, body: 'Text\n' },
        },
      ],
      ctx,
    );
    expect(ops).toEqual([
      { op: 'write', path: 'src/content/blog/hello.md', text: 'Text\n' },
    ]);
  });

  it('writes an id with slashes as a nested file', async () => {
    const ctx = ctxOf({}, [], {
      blog: globLoader('**/*.md', 'src/content/blog'),
    });
    const ops = await planWrite(
      [
        {
          op: 'create',
          collection: 'blog',
          id: 'guides/intro',
          value: { data: {}, body: '' },
        },
      ],
      ctx,
    );
    expect(ops).toEqual([
      { op: 'write', path: 'src/content/blog/guides/intro.md', text: '' },
    ]);
  });

  it('uses newEntryFormat over the pattern extension in a mixed JSON and YAML collection', async () => {
    const pattern = '**/*.{json,yaml}';
    const base = 'src/content/items';
    const ctx = ctxOf(
      {
        [`${base}/a.json`]: '{\n  "name": "a"\n}\n',
        [`${base}/b.yaml`]: 'name: b\n',
      },
      [
        docOf({ key: 'items/a', file: `${base}/a.json`, format: 'json' }),
        docOf({ key: 'items/b', file: `${base}/b.yaml`, format: 'yaml' }),
      ],
      { items: globLoader(pattern, base) },
      { collections: { items: { newEntryFormat: 'yaml' } } },
    );
    const ops = await planWrite(
      [{ op: 'create', collection: 'items', id: 'c', value: { name: 'c' } }],
      ctx,
    );
    expect(ops).toEqual([
      { op: 'write', path: `${base}/c.yaml`, text: 'name: c\n' },
    ]);
  });

  it('writes a JSON create by the first extension when no newEntryFormat is set', async () => {
    const ctx = ctxOf({}, [], {
      items: globLoader('**/*.{json,yaml}', 'src/content/items'),
    });
    const ops = await planWrite(
      [{ op: 'create', collection: 'items', id: 'd', value: { name: 'd' } }],
      ctx,
    );
    expect(ops).toEqual([
      {
        op: 'write',
        path: 'src/content/items/d.json',
        text: '{\n  "name": "d"\n}\n',
      },
    ]);
  });

  it('refuses a glob create whose file already exists (exists)', async () => {
    const ctx = ctxOf({ 'src/content/blog/hello.md': 'old\n' }, [], {
      blog: globLoader('**/*.md', 'src/content/blog'),
    });
    await expect(
      planWrite(
        [
          {
            op: 'create',
            collection: 'blog',
            id: 'hello',
            value: { data: {}, body: 'x' },
          },
        ],
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'exists',
      key: 'blog/hello',
      file: 'src/content/blog/hello.md',
    });
  });

  it('refuses a glob create when the pattern names no extension (unwritable)', async () => {
    const ctx = ctxOf({}, [], { misc: globLoader('**/*', 'src/content/misc') });
    await expect(
      planWrite(
        [{ op: 'create', collection: 'misc', id: 'a', value: {} }],
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'unwritable',
      key: 'misc/a',
      message: 'No format the CMS can write for the collection "misc"',
    });
  });

  it('deletes a document that is a file of its own', async () => {
    const ctx = ctxOf(
      { 'src/content/blog/hello.md': '---\ntitle: Hi\n---\nText\n' },
      [
        docOf({
          key: 'blog/hello',
          file: 'src/content/blog/hello.md',
          format: 'md',
        }),
      ],
      { blog: globLoader('**/*.md', 'src/content/blog') },
    );
    const ops = await planWrite([{ op: 'delete', key: 'blog/hello' }], ctx);
    expect(ops).toEqual([{ op: 'delete', path: 'src/content/blog/hello.md' }]);
  });

  it('updates a whole-file document with its codec', async () => {
    const ctx = ctxOf(
      { 'src/content/blog/hello.md': '---\ntitle: Hi\n---\nText\n' },
      [
        docOf({
          key: 'blog/hello',
          file: 'src/content/blog/hello.md',
          format: 'md',
        }),
      ],
      { blog: globLoader('**/*.md', 'src/content/blog') },
    );
    const ops = await planWrite(
      [
        {
          op: 'update',
          key: 'blog/hello',
          value: { data: { title: 'Yo' }, body: 'Text\n' },
        },
      ],
      ctx,
    );
    expect(ops).toEqual([
      {
        op: 'write',
        path: 'src/content/blog/hello.md',
        text: '---\ntitle: Yo\n---\nText\n',
      },
    ]);
  });

  it('refuses a delete of a document whose file is missing (file-missing)', async () => {
    const ctx = ctxOf(
      {},
      [
        docOf({
          key: 'blog/hello',
          file: 'src/content/blog/hello.md',
          format: 'md',
        }),
      ],
      { blog: globLoader('**/*.md', 'src/content/blog') },
    );
    await expect(
      planWrite([{ op: 'delete', key: 'blog/hello' }], ctx),
    ).rejects.toMatchObject({ code: 'file-missing', key: 'blog/hello' });
  });
});

describe('planWrite: refusals', () => {
  it.each([
    ['update', { op: 'update', key: 'blog/a', value: {} }],
    ['delete', { op: 'delete', key: 'blog/a' }],
  ] as const)(
    'refuses a %s of a read-only document (read-only)',
    async (_name, change) => {
      const ctx = ctxOf({ 'src/content/a.json': '{}' }, [
        docOf({
          key: 'blog/a',
          file: 'src/content/a.json',
          format: 'json',
          editable: false,
        }),
      ]);
      await expect(planWrite([change], ctx)).rejects.toMatchObject({
        code: 'read-only',
        key: 'blog/a',
        message: 'The document "blog/a" is read-only',
      });
    },
  );

  it('refuses a change when the working copy cannot be read (unreadable)', async () => {
    const ctx: PlanContext = {
      ...ctxOf({}, [
        docOf({ key: 'blog/a', file: 'src/content/a.json', format: 'json' }),
      ]),
      readText: async () => {
        throw new Error('EACCES');
      },
    };
    await expect(
      planWrite([{ op: 'update', key: 'blog/a', value: {} }], ctx),
    ).rejects.toMatchObject({
      code: 'unreadable',
      key: 'blog/a',
      file: 'src/content/a.json',
      message: 'The file "src/content/a.json" cannot be read',
    });
  });

  it.each([['../x'], ['/x'], ['a\\b'], ['a/../../x'], ['a//b'], ['']])(
    'refuses the id %j as a path outside the site (outside-site)',
    async (id) => {
      const ctx = ctxOf({}, [], {
        blog: globLoader('**/*.md', 'src/content/blog'),
      });
      await expect(
        planWrite(
          [
            {
              op: 'create',
              collection: 'blog',
              id,
              value: { data: {}, body: '' },
            },
          ],
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'outside-site', key: `blog/${id}` });
    },
  );

  it('refuses a document whose file leaves the site (outside-site)', async () => {
    const ctx = ctxOf({}, [
      docOf({ key: 'blog/a', file: '../secret.json', format: 'json' }),
    ]);
    await expect(
      planWrite([{ op: 'update', key: 'blog/a', value: {} }], ctx),
    ).rejects.toMatchObject({
      code: 'outside-site',
      key: 'blog/a',
      message: '"../secret.json" is outside the site',
    });
  });

  it('refuses a glob create whose base leaves the site (outside-site)', async () => {
    const ctx = ctxOf({}, [], { blog: globLoader('**/*.md', '../elsewhere') });
    await expect(
      planWrite(
        [
          {
            op: 'create',
            collection: 'blog',
            id: 'a',
            value: { data: {}, body: '' },
          },
        ],
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'outside-site', key: 'blog/a' });
  });

  it('refuses a file() loader whose file is outside the site (outside-site)', async () => {
    const ctx = ctxOf({}, [], { stats: fileLoader('../stats.yaml') });
    await expect(
      planWrite(
        [{ op: 'create', collection: 'stats', id: 'a', value: {} }],
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'outside-site',
      key: 'stats/a',
      message: '"../stats.yaml" is outside the site',
    });
  });

  it('refuses an update of a document whose file is missing (file-missing)', async () => {
    const ctx = ctxOf({}, [
      docOf({ key: 'blog/a', file: 'src/content/a.json', format: 'json' }),
    ]);
    await expect(
      planWrite([{ op: 'update', key: 'blog/a', value: {} }], ctx),
    ).rejects.toMatchObject({
      code: 'file-missing',
      key: 'blog/a',
      file: 'src/content/a.json',
    });
  });

  it.each([
    [
      'two updates of one key',
      [
        { op: 'update', key: 'blog/a', value: { data: {}, body: 'x' } },
        { op: 'update', key: 'blog/a', value: { data: {}, body: 'y' } },
      ],
    ],
    [
      'a delete and a create of one key',
      [
        { op: 'delete', key: 'blog/a' },
        {
          op: 'create',
          collection: 'blog',
          id: 'a',
          value: { data: {}, body: '' },
        },
      ],
    ],
  ] as const)(
    'refuses %s in one save (duplicate-key)',
    async (_name, changes) => {
      const ctx = ctxOf(
        { 'src/content/a.md': 'x' },
        [docOf({ key: 'blog/a', file: 'src/content/a.md', format: 'md' })],
        { blog: globLoader('**/*.md', 'src/content/blog') },
      );
      await expect(planWrite([...changes], ctx)).rejects.toMatchObject({
        code: 'duplicate-key',
        key: 'blog/a',
        message: 'More than one change to "blog/a" in one save',
      });
    },
  );

  it('refuses a create into a read-only collection (read-only)', async () => {
    const ctx = ctxOf({}, [], {
      fixtures: {
        ...globLoader('**/*.json', 'src/content/fixtures'),
        readOnly: true,
      },
    });
    await expect(
      planWrite(
        [{ op: 'create', collection: 'fixtures', id: 'a', value: {} }],
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'read-only',
      key: 'fixtures/a',
      message: 'The collection "fixtures" is read-only',
    });
  });

  it('refuses a create into a glob whose ids come from generateId (unwritable)', async () => {
    const ctx = ctxOf({}, [], {
      people: {
        loader: {
          kind: 'glob',
          pattern: '**/*.json',
          base: 'src/content/people',
          customId: true,
        },
      },
    });
    await expect(
      planWrite(
        [{ op: 'create', collection: 'people', id: 'ana', value: {} }],
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'unwritable',
      key: 'people/ana',
      message:
        'The id "ana" of "people" cannot be turned into a path: its ids come from generateId',
    });
  });

  it.each([
    ['a collection the bundle does not have', 'missing'],
    ['a collection with no loader', 'loaderless'],
    ['a key named __proto__', '__proto__'],
    ['a key named constructor', 'constructor'],
    ['a key named toString', 'toString'],
  ])('refuses a create into %s (unwritable)', async (_name, collection) => {
    const ctx = ctxOf({}, [], { loaderless: {} });
    await expect(
      planWrite([{ op: 'create', collection, id: 'a', value: {} }], ctx),
    ).rejects.toMatchObject({
      code: 'unwritable',
      key: `${collection}/a`,
    });
  });

  it('refuses an update of a key the bundle does not have (unwritable)', async () => {
    const ctx = ctxOf({});
    await expect(
      planWrite([{ op: 'update', key: 'blog/none', value: {} }], ctx),
    ).rejects.toMatchObject({
      code: 'unwritable',
      key: 'blog/none',
      message: 'There is no document "blog/none"',
    });
  });

  it('refuses an update of a document in a format with no codec (unwritable)', async () => {
    const ctx = ctxOf({ 'src/content/a.toml': 'a = 1\n' }, [
      docOf({ key: 'blog/a', file: 'src/content/a.toml', format: 'toml' }),
    ]);
    await expect(
      planWrite([{ op: 'update', key: 'blog/a', value: {} }], ctx),
    ).rejects.toMatchObject({
      code: 'unwritable',
      key: 'blog/a',
      message: 'The format "toml" cannot be written',
    });
  });

  it('refuses an update whose value the codec cannot write, with the position (unwritable)', async () => {
    const ctx = ctxOf({ 'src/content/a.json': '{ "a": 1,' }, [
      docOf({ key: 'blog/a', file: 'src/content/a.json', format: 'json' }),
    ]);
    await expect(
      planWrite([{ op: 'update', key: 'blog/a', value: { a: 2 } }], ctx),
    ).rejects.toMatchObject({
      code: 'unwritable',
      key: 'blog/a',
      file: 'src/content/a.json',
    });
  });
});
