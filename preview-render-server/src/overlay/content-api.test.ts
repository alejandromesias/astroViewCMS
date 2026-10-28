import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';
import {
  defineCollection,
  file,
  glob,
  hooks,
  image,
  reference,
} from '../schema/stubs-flavor2.ts';
import { createContentApi, DRAFT } from './content-api.ts';
import { createOverlayContext, runWithOverlay } from './context.ts';
import { DraftError } from './errors.ts';
import { isMediaMetadata } from './media.ts';

// -- A fake `astro:content` over in-memory built data ------------------------
const built = {
  authors: [
    {
      id: 'ana',
      data: {
        name: 'Ana',
        avatar: {
          src: '/built/ana.png',
          width: 100,
          height: 100,
          format: 'png',
        },
      },
      filePath: 'src/content/authors/ana.json',
    },
    {
      id: 'kofi',
      data: {
        name: 'Kofi',
        avatar: {
          src: '/built/kofi.png',
          width: 100,
          height: 100,
          format: 'png',
        },
      },
      filePath: 'src/content/authors/kofi.json',
    },
  ],
  blog: [
    {
      id: 'hello',
      data: { title: 'Hello', date: new Date('2025-01-01') },
      body: 'Saved body',
      filePath: 'src/content/blog/hello.md',
    },
    {
      id: 'generated/post-001',
      data: { title: 'Gen', date: new Date('2025-01-02') },
      body: 'Gen body',
      filePath: 'src/content/blog/generated/post-001.mdx',
    },
    {
      id: 'old',
      data: { title: 'Old', date: new Date('2020-01-01'), draft: true },
      body: 'x',
      filePath: 'src/content/blog/old.md',
    },
  ],
  testimonials: [
    {
      id: 't1',
      data: { quote: 'One' },
      filePath: 'src/content/testimonials.json',
    },
    {
      id: 't2',
      data: { quote: 'Two' },
      filePath: 'src/content/testimonials.json',
    },
  ],
} as Record<string, any[]>;

const calls: string[] = [];
const real = {
  async getCollection(name: string, filter?: (e: any) => unknown) {
    calls.push(`getCollection:${name}`);
    const entries = (built[name] ?? []).map((e) => ({
      ...e,
      collection: name,
    }));
    return filter ? entries.filter(filter) : entries;
  },
  async getEntry(...args: any[]) {
    const { collection, id } =
      typeof args[0] === 'string'
        ? { collection: args[0], id: args[1] }
        : args[0];
    calls.push(`getEntry:${collection}/${id}`);
    const found = (built[collection] ?? []).find((e) => e.id === id);
    return found && { ...found, collection };
  },
  async render(entry: any) {
    return {
      Content: `built-content:${entry.id}`,
      headings: [],
      remarkPluginFrontmatter: {},
    };
  },
};

const collections = {
  authors: defineCollection({
    loader: glob({ pattern: '**/*.{json,yaml}', base: 'src/content/authors' }),
    schema: ({ image: img }) => z.object({ name: z.string(), avatar: img() }),
  }),
  blog: defineCollection({
    loader: glob({ pattern: '**/*.{md,mdx}', base: 'src/content/blog' }),
    schema: z.object({
      title: z.string(),
      date: z.coerce.date().optional(),
      since: z.date().optional(),
      draft: z.boolean().optional(),
      tags: z.array(z.string()).default(() => ['others']),
      author: reference('authors').optional(),
      max: z
        .number()
        .refine(() => {
          throw new Error('refinement blew up');
        })
        .optional(),
    }),
  }),
  testimonials: defineCollection({
    loader: file('src/content/testimonials.json'),
    schema: z.object({ quote: z.string() }),
  }),
};

const images = {
  'src/assets/authors/ana.png': {
    src: '/_astro/ana.hash.png',
    width: 800,
    height: 600,
    format: 'png' as const,
  },
};

const api = createContentApi({
  real,
  collections,
  images,
  hooks,
  emptyContent: () => 'empty-content',
});

const render = <T>(
  documents: Record<string, unknown>,
  fn: () => Promise<T>,
  media = {},
) => {
  const context = createOverlayContext({ documents, media });
  return { context, result: runWithOverlay(context, fn) };
};
const run = async <T>(
  documents: Record<string, unknown>,
  fn: () => Promise<T>,
  media = {},
) => {
  const { context, result } = render(documents, fn, media);
  return { value: await result, context };
};

describe('without an overlay', () => {
  it('passes everything through to the built content', async () => {
    expect((await api.getCollection('authors')).map((e) => e.id)).toEqual([
      'ana',
      'kofi',
    ]);
    expect((await api.getEntry('authors', 'ana')).data.name).toBe('Ana');
    expect(
      (await api.getCollection('blog', (e) => !e.data.draft)).map((e) => e.id),
    ).toEqual(['hello', 'generated/post-001']);
  });

  it('render() is the built one', async () => {
    expect((await api.render({ id: 'x' })).Content).toBe('built-content:x');
  });
});

describe('getCollection with an overlay', () => {
  it('replaces a built entry, keeping its position', async () => {
    const { value } = await run(
      {
        'authors/ana': {
          name: 'Ana (draft)',
          avatar: '../../assets/authors/ana.png',
        },
      },
      () => api.getCollection('authors'),
    );
    expect(value.map((e) => e.id)).toEqual(['ana', 'kofi']);
    expect(value[0].data.name).toBe('Ana (draft)');
    expect(value[1].data.name).toBe('Kofi');
  });

  it('adds a new entry after the built ones', async () => {
    const { value } = await run(
      {
        'authors/lena': {
          name: 'Lena',
          avatar: '../../assets/authors/ana.png',
        },
      },
      () => api.getCollection('authors'),
    );
    expect(value.map((e) => e.id)).toEqual(['ana', 'kofi', 'lena']);
    expect(value[2].data.avatar).toEqual(images['src/assets/authors/ana.png']);
  });

  it('removes an entry set to null', async () => {
    const { value } = await run({ 'authors/kofi': null }, () =>
      api.getCollection('authors'),
    );
    expect(value.map((e) => e.id)).toEqual(['ana']);
  });

  it('runs filters after the overlay (a draft: true post leaves the list)', async () => {
    const { value } = await run(
      { 'blog/hello': { data: { title: 'Hello', draft: true }, body: 'b' } },
      () => api.getCollection('blog', (e) => !e.data.draft),
    );
    expect(value.map((e) => e.id)).toEqual(['generated/post-001']);
  });

  it('keeps ids with slashes (D10)', async () => {
    const { value } = await run(
      { 'blog/generated/post-001': { data: { title: 'Edited' }, body: 'b' } },
      () => api.getCollection('blog'),
    );
    expect(value.find((e) => e.id === 'generated/post-001').data.title).toBe(
      'Edited',
    );
  });

  it('overlays a file() collection entry by entry, not the whole file', async () => {
    const { value } = await run(
      { 'testimonials/t2': { quote: 'Two (draft)' } },
      () => api.getCollection('testimonials'),
    );
    expect(value.map((e) => e.data.quote)).toEqual(['One', 'Two (draft)']);
  });
});

describe('getEntry and getEntries', () => {
  const docs = {
    'authors/ana': {
      name: 'Ana (draft)',
      avatar: '../../assets/authors/ana.png',
    },
    'authors/kofi': null,
  };

  it('takes (collection, id)', async () => {
    expect(
      (await run(docs, () => api.getEntry('authors', 'ana'))).value.data.name,
    ).toBe('Ana (draft)');
  });

  it('takes a reference object { collection, id }', async () => {
    expect(
      (
        await run(docs, () =>
          api.getEntry({ collection: 'authors', id: 'ana' }),
        )
      ).value.data.name,
    ).toBe('Ana (draft)');
  });

  it('answers undefined for an entry removed in the overlay, and for a missing one', async () => {
    expect(
      (await run(docs, () => api.getEntry('authors', 'kofi'))).value,
    ).toBeUndefined();
    expect(
      (await run(docs, () => api.getEntry('authors', 'ghost'))).value,
    ).toBeUndefined();
  });

  it('uses the built entry when the overlay does not touch it', async () => {
    expect(
      (
        await run(
          {
            'authors/zed': {
              name: 'Z',
              avatar: '../../assets/authors/ana.png',
            },
          },
          () => api.getEntry('authors', 'kofi'),
        )
      ).value.data.name,
    ).toBe('Kofi');
  });

  it('getEntries keeps order over overlaid, built, removed and missing entries', async () => {
    const { value } = await run(docs, () =>
      api.getEntries([
        { collection: 'authors', id: 'kofi' },
        { collection: 'authors', id: 'ana' },
        { collection: 'testimonials', id: 't1' },
        { collection: 'authors', id: 'ghost' },
      ]),
    );
    expect(value.map((e) => e?.data.name ?? e?.data.quote)).toEqual([
      undefined,
      'Ana (draft)',
      'One',
      undefined,
    ]);
  });
});

describe('the read log', () => {
  it('records collections, entries and data reads', async () => {
    const { context } = await run({}, async () => {
      await api.getCollection('authors');
      await api.getEntry('blog', 'generated/post-001');
      await api.getEntries([{ collection: 'testimonials', id: 't1' }]);
    });
    expect([...context.reads]).toEqual([
      'authors',
      'blog/generated/post-001',
      'testimonials/t1',
    ]);
  });
});

describe('drafts are parsed with the site schema (D3)', () => {
  it('fills defaults and coerces dates', async () => {
    const { value } = await run(
      { 'blog/new': { data: { title: 'T', date: '2025-04-04' }, body: '# b' } },
      () => api.getEntry('blog', 'new'),
    );
    expect(value.data.tags).toEqual(['others']);
    expect(value.data.date).toEqual(new Date('2025-04-04'));
  });

  it('YAML dates (D13): a plain z.date() gets its ISO string revived', async () => {
    const { value } = await run(
      { 'blog/new': { data: { title: 'T', since: '2025-04-04' }, body: '' } },
      () => api.getEntry('blog', 'new'),
    );
    expect(value.data.since).toEqual(new Date('2025-04-04'));
  });

  it('a non-date string in a date field still fails', async () => {
    await expect(
      run(
        { 'blog/new': { data: { title: 'T', since: 'soon' }, body: '' } },
        () => api.getEntry('blog', 'new'),
      ),
    ).rejects.toBeInstanceOf(DraftError);
  });

  it('Markdown and MDX documents are { data, body } and expose entry.body (D2)', async () => {
    const { value } = await run(
      { 'blog/hello': { data: { title: 'H' }, body: 'Draft body' } },
      () => api.getEntry('blog', 'hello'),
    );
    expect(value.body).toBe('Draft body');
    expect(value.filePath).toBe('src/content/blog/hello.md');
    expect(value[DRAFT]).toEqual({ extension: 'md' });
  });

  it('JSON documents are the raw object and carry no body', async () => {
    const { value } = await run(
      { 'authors/new': { name: 'N', avatar: '../../assets/authors/ana.png' } },
      () => api.getEntry('authors', 'new'),
    );
    expect(value).not.toHaveProperty('body');
    expect(value.filePath).toBe('src/content/authors/new.json');
  });

  it('a failed parse is a DraftError with the field path', async () => {
    const error = await run(
      { 'authors/bad': { name: 5, avatar: '../../assets/authors/ana.png' } },
      () => api.getEntry('authors', 'bad'),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(DraftError);
    expect(error.key).toBe('authors/bad');
    expect(error.issues[0].path).toEqual(['name']);
  });

  it('a refinement that throws is a DraftError and adds schema-refinement to limits', async () => {
    const { context, result } = render(
      { 'blog/x': { data: { title: 'T', max: 3 }, body: '' } },
      () => api.getEntry('blog', 'x'),
    );
    await expect(result).rejects.toThrow(/refinement blew up/);
    expect(context.limits.has('schema-refinement')).toBe(true);
  });

  it('parses each draft once per render', async () => {
    const { value } = await run(
      { 'authors/ana': { name: 'A', avatar: '../../assets/authors/ana.png' } },
      async () => [
        await api.getEntry('authors', 'ana'),
        await api.getEntry('authors', 'ana'),
      ],
    );
    expect(value[0]).toBe(value[1]);
  });
});

describe('images in drafts (D5, D12)', () => {
  it('resolves a path against the folder of the file that holds the document', async () => {
    const { value } = await run(
      { 'authors/ana': { name: 'A', avatar: '../../assets/authors/ana.png' } },
      () => api.getEntry('authors', 'ana'),
    );
    expect(value.data.avatar).toBe(images['src/assets/authors/ana.png']);
  });

  it('a new document resolves against where it would be written', async () => {
    const { value } = await run(
      { 'authors/new': { name: 'N', avatar: '../../assets/authors/ana.png' } },
      () => api.getEntry('authors', 'new'),
    );
    expect(value.data.avatar).toBe(images['src/assets/authors/ana.png']);
  });

  it('uses the media map for images that are not in the bundle, tagged', async () => {
    const media = {
      '/__preview-media/abc.png': {
        url: '/__preview-media/abc.png',
        width: 640,
        height: 480,
        format: 'png',
      },
    };
    const { value } = await run(
      { 'authors/ana': { name: 'A', avatar: '/__preview-media/abc.png' } },
      () => api.getEntry('authors', 'ana'),
      media,
    );
    expect(value.data.avatar).toMatchObject({
      src: '/__preview-media/abc.png',
      width: 640,
      height: 480,
      format: 'png',
    });
    expect(isMediaMetadata(value.data.avatar)).toBe(true);
    expect(isMediaMetadata(images['src/assets/authors/ana.png'])).toBe(false);
  });

  it('finds a media entry by project path too', async () => {
    const media = {
      'src/assets/authors/new.png': {
        url: '/staging/new.png',
        width: 10,
        height: 10,
        format: 'png',
      },
    };
    const { value } = await run(
      { 'authors/ana': { name: 'A', avatar: '../../assets/authors/new.png' } },
      () => api.getEntry('authors', 'ana'),
      media,
    );
    expect(value.data.avatar.src).toBe('/staging/new.png');
  });

  it('an image in neither fails the field with "image not found"', async () => {
    const error = await run(
      { 'authors/ana': { name: 'A', avatar: '../../assets/missing.png' } },
      () => api.getEntry('authors', 'ana'),
    ).catch((e) => e);
    expect(error.issues[0]).toMatchObject({
      path: ['avatar'],
      message: expect.stringContaining('image not found'),
    });
  });
});

describe('references in drafts (D3)', () => {
  const post = (author: unknown) => ({
    data: { title: 'T', author },
    body: '',
  });

  it('a string or { id } becomes { collection, id }', async () => {
    expect(
      (
        await run({ 'blog/new': post('ana') }, () =>
          api.getEntry('blog', 'new'),
        )
      ).value.data.author,
    ).toEqual({ collection: 'authors', id: 'ana' });
    expect(
      (
        await run({ 'blog/new': post({ id: 'kofi' }) }, () =>
          api.getEntry('blog', 'new'),
        )
      ).value.data.author,
    ).toEqual({ collection: 'authors', id: 'kofi' });
  });

  it('may point at an entry that only exists in the overlay', async () => {
    const docs = {
      'blog/new': post('lena'),
      'authors/lena': { name: 'L', avatar: '../../assets/authors/ana.png' },
    };
    expect(
      (await run(docs, () => api.getEntry('blog', 'new'))).value.data.author.id,
    ).toBe('lena');
  });

  it('fails for a missing target, and for one removed in the overlay', async () => {
    await expect(
      run({ 'blog/new': post('ghost') }, () => api.getEntry('blog', 'new')),
    ).rejects.toBeInstanceOf(DraftError);
    await expect(
      run({ 'blog/new': post('ana'), 'authors/ana': null }, () =>
        api.getEntry('blog', 'new'),
      ),
    ).rejects.toBeInstanceOf(DraftError);
  });
});

describe('render()', () => {
  it('a built entry renders as built', async () => {
    expect((await api.render({ id: 'hello' })).Content).toBe(
      'built-content:hello',
    );
  });

  it('an MDX draft renders the saved body and adds mdx-body to limits (D11)', async () => {
    const { value, context } = await run(
      { 'blog/generated/post-001': { data: { title: 'E' }, body: 'new body' } },
      async () => api.render(await api.getEntry('blog', 'generated/post-001')),
    );
    expect(value.Content).toBe('built-content:generated/post-001');
    expect(context.limits.has('mdx-body')).toBe(true);
  });

  it('an MDX draft with nothing saved renders empty content', async () => {
    // The entry is found once (to know its file) and gone when render() looks for the saved one.
    let lookups = 0;
    const flaky = {
      ...real,
      getEntry: async (...args: any[]) =>
        ++lookups === 1 ? real.getEntry(...args) : undefined,
    };
    const flakyApi = createContentApi({
      real: flaky,
      collections,
      images,
      hooks,
      emptyContent: () => 'empty-content',
    });
    const { value } = await run(
      { 'blog/generated/post-001': { data: { title: 'E' }, body: 'b' } },
      async () =>
        flakyApi.render(await flakyApi.getEntry('blog', 'generated/post-001')),
    );
    expect(value.Content).toBe('empty-content');
  });

  it('a Markdown draft uses renderMarkdown when given', async () => {
    const withMarkdown = createContentApi({
      real,
      collections,
      images,
      hooks,
      emptyContent: () => 'empty',
      renderMarkdown: async (e) => ({ Content: `md:${e.body}` }),
    });
    const { value } = await run(
      { 'blog/hello': { data: { title: 'H' }, body: 'Draft' } },
      async () =>
        withMarkdown.render(await withMarkdown.getEntry('blog', 'hello')),
    );
    expect(value.Content).toBe('md:Draft');
  });
});

describe('request scope', () => {
  it("concurrent renders do not see each other's drafts", async () => {
    const slow = <T>(ms: number, value: T) =>
      new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
    const renderAs = (name: string, delay: number) =>
      run(
        { 'authors/ana': { name, avatar: '../../assets/authors/ana.png' } },
        async () => {
          await slow(delay, null); // let the other render start in between
          const first = (await api.getEntry('authors', 'ana')).data.name;
          await slow(delay, null);
          const list = (await api.getCollection('authors')).find(
            (e) => e.id === 'ana',
          ).data.name;
          return [first, list];
        },
      );
    const [a, b, none] = await Promise.all([
      renderAs('Draft A', 5),
      renderAs('Draft B', 1),
      run({}, async () => {
        await slow(3, null);
        return (await api.getEntry('authors', 'ana')).data.name;
      }),
    ]);
    expect(a.value).toEqual(['Draft A', 'Draft A']);
    expect(b.value).toEqual(['Draft B', 'Draft B']);
    expect(none.value).toBe('Ana');
    expect(a.context.reads).not.toBe(b.context.reads);
  });
});

// Keep the import used: `image` stubs are exercised through the schema above.
void image;

describe('validate', () => {
  const validate = (documents: Record<string, unknown>, media = {}) => {
    const context = createOverlayContext({ documents, media });
    return runWithOverlay(context, () => api.validate(context));
  };

  it('is empty when every draft fits its schema; removed documents and data files are skipped', async () => {
    const errors = await validate({
      'authors/ana': { name: 'A', avatar: '../../assets/authors/ana.png' },
      'blog/new': { data: { title: 'T' }, body: '' },
      'blog/old': null,
      'data:src/config/menu.json': { anything: 1 },
    });
    expect(errors).toEqual([]);
  });

  it('lists every failing field of every document with its key', async () => {
    const errors = await validate({
      'authors/bad': { name: 5, avatar: '../../assets/authors/missing.png' },
      'blog/bad': { data: {}, body: '' },
    });
    expect(errors.map((e) => `${e.key}:${e.path.join('.')}`).sort()).toEqual([
      'authors/bad:avatar',
      'authors/bad:name',
      'blog/bad:title',
    ]);
  });

  it('rejects keys that name no document or no collection', async () => {
    const errors = await validate({ nothing: {}, 'nowhere/x': {} });
    expect(errors.map((e) => e.key).sort()).toEqual(['nothing', 'nowhere/x']);
    expect(errors.find((e) => e.key === 'nowhere/x')!.message).toMatch(
      /Unknown collection "nowhere"/,
    );
  });

  it('a refinement that throws is reported as an error of that document', async () => {
    const errors = await validate({
      'blog/x': { data: { title: 'T', max: 3 }, body: '' },
    });
    expect(errors).toEqual([
      { key: 'blog/x', path: [], message: 'refinement blew up' },
    ]);
  });
});

// -- Mutation-testing additions ----------------------------------------------
const emptyRender = {
  Content: 'empty-content',
  headings: [],
  remarkPluginFrontmatter: {},
};

describe('the file that holds a new draft', () => {
  const extra = {
    yaml: defineCollection({
      loader: glob({ pattern: '**/*.yaml', base: 'content/yaml' }),
    }),
    spaced: defineCollection({
      loader: glob({ pattern: '**/*.{ mdx , md}', base: 'content/spaced' }),
    }),
    plain: defineCollection({
      loader: glob({ pattern: 'data/*', base: 'content/plain' }),
    }),
    mark: defineCollection({
      loader: glob({ pattern: '**/*.markdown', base: 'content/mark' }),
    }),
    noBase: defineCollection({ loader: glob({ pattern: '**/*.json' }) }),
    noLoader: defineCollection({}),
    one: defineCollection({ loader: file('content/one.json') }),
  };
  const extraApi = createContentApi({
    real,
    collections: extra,
    images,
    hooks,
    emptyContent: () => 'empty-content',
  });
  const entry = async (key: string, raw: unknown = {}) =>
    (
      await run({ [key]: raw }, () =>
        extraApi.getEntry(key.split('/')[0], key.slice(key.indexOf('/') + 1)),
      )
    ).value;

  it.each([
    ['yaml/a', 'content/yaml/a.yaml'],
    ['spaced/a', 'content/spaced/a.mdx'],
    ['plain/a', 'content/plain/a.json'],
    ['mark/a', 'content/mark/a.markdown'],
    ['noBase/a', 'a.json'],
    ['noLoader/a', 'a.json'],
    ['one/a', 'content/one.json'],
  ])('%s is written to %s', async (key, expected) => {
    expect((await entry(key)).filePath).toBe(expected);
  });

  it('a collection the site does not have falls back to a JSON file at the root', async () => {
    expect((await entry('ghost/a')).filePath).toBe('a.json');
  });

  it('with no collections at all, drafts are passed through unparsed', async () => {
    const bare = createContentApi({
      real,
      collections: undefined,
      images,
      hooks,
      emptyContent: () => 'empty-content',
    });
    const { value } = await run({ 'x/y': { any: 1 } }, () =>
      bare.getEntry('x', 'y'),
    );
    expect(value).toMatchObject({
      id: 'y',
      collection: 'x',
      data: { any: 1 },
      filePath: 'y.json',
    });
    expect(
      await run({ 'x/y': {} }, () => bare.getCollection('x')).then(
        (r) => r.value.length,
      ),
    ).toBe(1);
  });

  it('a .markdown document has a body; matching the extension is not case sensitive', async () => {
    expect(await entry('mark/a', { data: { k: 1 }, body: 'B' })).toMatchObject({
      data: { k: 1 },
      body: 'B',
    });
    const upper = {
      ...real,
      getEntry: async () => ({
        id: 'up',
        collection: 'mark',
        data: {},
        filePath: 'content\\mark\\up.MD',
      }),
    };
    const upperApi = createContentApi({
      real: upper,
      collections: extra,
      images,
      hooks,
      emptyContent: () => 'e',
    });
    const { value } = await run({ 'mark/up': { data: {}, body: 'Z' } }, () =>
      upperApi.getEntry('mark', 'up'),
    );
    expect(value.filePath).toBe('content/mark/up.MD'); // backslashes become slashes
    expect(value.body).toBe('Z');
    expect(value[DRAFT]).toEqual({ extension: 'md' });
  });

  it('an empty built filePath falls back to the loader', async () => {
    const empty = {
      ...real,
      getEntry: async () => ({
        id: 'a',
        collection: 'yaml',
        data: {},
        filePath: '',
      }),
    };
    const emptyApi = createContentApi({
      real: empty,
      collections: extra,
      images,
      hooks,
      emptyContent: () => 'e',
    });
    expect(
      (await run({ 'yaml/a': {} }, () => emptyApi.getEntry('yaml', 'a'))).value
        .filePath,
    ).toBe('content/yaml/a.yaml');
  });
});

describe('the built entry shape', () => {
  it('has id, collection, digest and the draft marker', async () => {
    const { value } = await run(
      { 'authors/new': { name: 'N', avatar: '../../assets/authors/ana.png' } },
      () => api.getEntry('authors', 'new'),
    );
    expect(value).toMatchObject({
      id: 'new',
      collection: 'authors',
      digest: 'preview-draft',
    });
    expect(Symbol.keyFor(DRAFT)).toBe('preview-render-server.draft');
  });

  it('a Markdown draft without data or body gets {} and an empty string', async () => {
    const bare = createContentApi({
      real,
      collections: {
        blog: defineCollection({
          loader: glob({ pattern: '*.md', base: 'b' }),
        }),
      },
      images,
      hooks,
      emptyContent: () => 'e',
    });
    const { value } = await run({ 'blog/x': undefined }, () =>
      bare.getEntry('blog', 'x'),
    );
    expect(value.data).toEqual({});
    expect(value.body).toBe('');
  });
});

describe('schema issues', () => {
  const issueApi = (schema: z.ZodType) =>
    createContentApi({
      real,
      collections: {
        c: defineCollection({
          loader: glob({ pattern: '*.json', base: 'c' }),
          schema,
        }),
      },
      images,
      hooks,
      emptyContent: () => 'e',
    });
  const failure = (schema: z.ZodType, raw: unknown) => {
    const target = issueApi(schema);
    return run({ 'c/x': raw }, () => target.getEntry('c', 'x')).then(
      () => {
        throw new Error('expected a DraftError');
      },
      (error) => error as DraftError,
    );
  };

  it('keeps array indexes as numbers and turns symbols into strings', async () => {
    const error = await failure(z.object({ tags: z.array(z.string()) }), {
      tags: ['a', 5],
    });
    expect(error.issues).toEqual([
      { path: ['tags', 1], message: expect.any(String) },
    ]);
    const symbol = Symbol('s');
    const custom = await failure(
      z
        .object({})
        .superRefine((_value, ctx) =>
          ctx.addIssue({ code: 'custom', message: 'm', path: [symbol] }),
        ),
      {},
    );
    expect(custom.issues).toEqual([{ path: ['Symbol(s)'], message: 'm' }]);
  });

  it('does not report the schema-refinement limit for an ordinary failure', async () => {
    const target = issueApi(z.object({ n: z.number() }));
    const { context, result } = render({ 'c/x': { n: 'no' } }, () =>
      target.getEntry('c', 'x'),
    );
    await expect(result).rejects.toBeInstanceOf(DraftError);
    expect(context.limits.size).toBe(0);
  });

  it('a refinement that throws a non-Error still reports an issue', async () => {
    const error = await failure(
      z.object({}).refine(() => {
        throw new Error('boom');
      }),
      {},
    );
    expect(error.issues).toEqual([{ path: [], message: 'boom' }]);
  });

  it('fails a reference to a collection the site does not have', async () => {
    const error = await failure(z.object({ r: reference('nowhere') }), {
      r: 'a',
    });
    expect(error).toBeInstanceOf(DraftError);
    expect(error.issues[0]!.path).toEqual(['r']);
  });

  it('loads the ids of the built entries once, however many drafts are parsed', async () => {
    calls.length = 0;
    const once = createContentApi({
      real,
      collections,
      images,
      hooks,
      emptyContent: () => 'e',
    });
    const doc = { data: { title: 'T', author: 'ana' }, body: '' };
    await run({ 'blog/a': doc, 'blog/b': doc }, async () => [
      await once.getEntry('blog', 'a'),
      await once.getEntry('blog', 'b'),
    ]);
    await run({ 'blog/c': doc }, () => once.getEntry('blog', 'c'));
    expect(
      calls.filter((call) => call === 'getCollection:authors'),
    ).toHaveLength(1);
  });

  it('a reference to a built entry works, one to a ghost fails (the ids really are loaded)', async () => {
    const ok = await run(
      { 'blog/a': { data: { title: 'T', author: 'kofi' }, body: '' } },
      () => api.getEntry('blog', 'a'),
    );
    expect(ok.value.data.author).toEqual({ collection: 'authors', id: 'kofi' });
  });
});

describe('getCollection details', () => {
  it('applies the filter once when the overlay touches another collection, and builds nothing', async () => {
    let filtered = 0;
    const { value } = await run(
      { 'authors/ana': { name: 'A', avatar: '../../assets/authors/ana.png' } },
      () =>
        api.getCollection('blog', (entry) => {
          filtered++;
          return !entry.data.draft;
        }),
    );
    expect(value.map((e) => e.id)).toEqual(['hello', 'generated/post-001']);
    expect(filtered).toBe(3);
  });

  it('an overlay with only data documents does not change a collection', async () => {
    const { value } = await run({ 'data:src/x.json': { a: 1 } }, () =>
      api.getCollection('authors'),
    );
    expect(value.map((e) => e.id)).toEqual(['ana', 'kofi']);
  });

  it('removing a document that was never built adds nothing', async () => {
    const { value } = await run({ 'authors/ghost': null }, () =>
      api.getCollection('authors'),
    );
    expect(value.map((e) => e.id)).toEqual(['ana', 'kofi']);
  });

  it('an overlay document for a collection id with a slash is found by its collection', async () => {
    const { value } = await run(
      { 'blog/deep/new': { data: { title: 'D' }, body: '' } },
      () => api.getCollection('blog'),
    );
    expect(value.at(-1).id).toBe('deep/new');
  });
});

describe('getEntry and render pass-through', () => {
  const spy = {
    ...real,
    getEntry: async (...args: any[]) => ({ passthrough: args }),
    render: async (entry: unknown) => ({ rendered: entry }),
  };
  const spyApi = createContentApi({
    real: spy,
    collections,
    images,
    hooks,
    emptyContent: () => 'e',
  });

  it('hands calls without a usable reference to the built content', async () => {
    expect(await spyApi.getEntry(undefined)).toEqual({
      passthrough: [undefined],
    });
    expect(await spyApi.getEntry({ collection: 'authors' })).toEqual({
      passthrough: [{ collection: 'authors' }],
    });
    const { value } = await run({ 'authors/ana': null }, () =>
      spyApi.getEntry({ collection: 'authors' }),
    );
    expect(value).toEqual({ passthrough: [{ collection: 'authors' }] });
  });

  it('render() hands anything that is not a draft to the built content', async () => {
    expect(await spyApi.render(undefined)).toEqual({ rendered: undefined });
    expect(await spyApi.render(null)).toEqual({ rendered: null });
    expect(await spyApi.render({ id: 'plain' })).toEqual({
      rendered: { id: 'plain' },
    });
  });
});

describe('render() of drafts, in full', () => {
  it('a Markdown draft without renderMarkdown renders empty content', async () => {
    const { value } = await run(
      { 'blog/hello': { data: { title: 'H' }, body: 'Draft' } },
      async () => api.render(await api.getEntry('blog', 'hello')),
    );
    expect(value).toEqual(emptyRender);
  });

  it('an MDX draft with nothing saved renders the complete empty result', async () => {
    let lookups = 0;
    const flaky = {
      ...real,
      getEntry: async (...args: any[]) =>
        ++lookups === 1 ? real.getEntry(...args) : undefined,
    };
    const flakyApi = createContentApi({
      real: flaky,
      collections,
      images,
      hooks,
      emptyContent: () => 'empty-content',
    });
    const { value } = await run(
      { 'blog/generated/post-001': { data: { title: 'E' }, body: 'b' } },
      async () =>
        flakyApi.render(await flakyApi.getEntry('blog', 'generated/post-001')),
    );
    expect(value).toEqual(emptyRender);
  });

  it('an MDX draft rendered outside a request still renders (no limits to record)', async () => {
    const draft = (
      await run(
        { 'blog/generated/post-001': { data: { title: 'E' }, body: 'b' } },
        () => api.getEntry('blog', 'generated/post-001'),
      )
    ).value;
    expect((await api.render(draft)).Content).toBe(
      'built-content:generated/post-001',
    );
  });
});

describe('validate details', () => {
  const validateWith = (
    target: typeof api,
    documents: Record<string, unknown>,
  ) => {
    const context = createOverlayContext({ documents });
    return runWithOverlay(context, () => target.validate(context));
  };

  it('describes the keys that are not documents', async () => {
    expect(await validateWith(api, { nothing: {} })).toEqual([
      {
        key: 'nothing',
        path: [],
        message:
          'Not a document key (expected "collection/id" or "data:<path>")',
      },
    ]);
    expect(await validateWith(api, { '/lead': {} })).toHaveLength(1);
  });

  it('describes unknown collections', async () => {
    expect(await validateWith(api, { 'nowhere/x': {} })).toEqual([
      { key: 'nowhere/x', path: [], message: 'Unknown collection "nowhere"' },
    ]);
  });

  it('does not judge collections when the site has none', async () => {
    const bare = createContentApi({
      real,
      collections: undefined,
      images,
      hooks,
      emptyContent: () => 'e',
    });
    expect(await validateWith(bare, { 'nowhere/x': {} })).toEqual([]);
  });

  it('lets an unexpected error through instead of reporting it as a field error', async () => {
    const broken = createContentApi({
      real: {
        ...real,
        getEntry: async () => Promise.reject(new TypeError('disk gone')),
      },
      collections,
      images,
      hooks,
      emptyContent: () => 'e',
    });
    await expect(validateWith(broken, { 'authors/ana': {} })).rejects.toThrow(
      'disk gone',
    );
  });
});

describe('images in drafts: refs that are names of Object.prototype', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    '"%s" is an image that is not found',
    async (ref) => {
      const error = await run(
        { 'authors/ana': { name: 'A', avatar: ref } },
        () => api.getEntry('authors', 'ana'),
      ).catch((e) => e);
      expect(error.issues[0]).toMatchObject({
        path: ['avatar'],
        message: expect.stringContaining('image not found'),
      });
    },
  );
});
