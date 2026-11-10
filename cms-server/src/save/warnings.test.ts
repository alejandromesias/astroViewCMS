import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { silentLog } from '../../test/helpers/repo.ts';
import {
  bundleOf,
  documentOf,
  saveContext,
} from '../../test/helpers/save-context.ts';
import type { Bundle, DocumentEntry } from '../bundle/read.ts';
import type { SaveChange } from './body.ts';
import type { SaveContext } from './context.ts';
import { collectWarnings } from './warnings.ts';

const POSTS_FILE = 'src/content/posts/first.md';
const PAGE_FILE = 'src/content/pages/about.json';
const WARNING = 'public-image-missing';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => removeTestRoot(folder)));
});

// The collections of the test bundle: `posts` (Markdown, with an image() field `cover`), `pages` (JSON), and
// `authors`, which has no schema.
function collections(): Bundle['collections'] {
  return new Map([
    [
      'posts',
      {
        loader: {
          kind: 'glob',
          pattern: '**/*.{md,mdx}',
          base: 'src/content/posts',
        },
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            hero: { type: 'string' },
            cover: { type: 'string', cms: 'image' },
          },
        },
      },
    ],
    [
      'pages',
      {
        loader: {
          kind: 'glob',
          pattern: '**/*.json',
          base: 'src/content/pages',
        },
        schema: { type: 'object', properties: { body: { type: 'string' } } },
      },
    ],
    [
      'authors',
      {
        loader: {
          kind: 'glob',
          pattern: '**/*.json',
          base: 'src/content/authors',
        },
      },
    ],
  ]);
}

// The collections of `posts` with a `$ref` that names no `$defs` entry, so that walkMarkers throws.
function brokenCollections(): Bundle['collections'] {
  return new Map([
    [
      'posts',
      {
        loader: {
          kind: 'glob',
          pattern: '**/*.{md,mdx}',
          base: 'src/content/posts',
        },
        schema: {
          type: 'object',
          properties: { hero: { $ref: '#/$defs/missing' } },
        },
      },
    ],
  ]);
}

// A working copy with `files` (relative path to text, or a folder when the text is null), in a folder of its own.
async function siteWith(files: Record<string, string | null>): Promise<string> {
  const folder = await makeTestRoot();
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    const target = join(folder, path);
    if (text === null) {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  return folder;
}

// A save context over the test bundle and `folder`. `stored` holds the values before the save, by key.
function ctxOf(
  folder: string,
  changes: SaveChange[],
  options: {
    readonly stored?: [string, unknown][];
    readonly collections?: Bundle['collections'];
    readonly log?: SaveContext['log'];
    readonly warnings?: SaveContext['warnings'];
    readonly documents?: readonly DocumentEntry[];
    readonly config?: SaveContext['config'];
  } = {},
): SaveContext {
  const bundle = bundleOf(
    [
      documentOf('posts/first', { file: POSTS_FILE, format: 'md' }),
      documentOf('pages/about', { file: PAGE_FILE, format: 'json' }),
      ...(options.documents ?? []),
    ],
    options.collections ?? collections(),
  );
  return saveContext({
    bundle,
    siteFolder: folder,
    documents: new Map(bundle.documents),
    changes,
    stored: new Map(options.stored ?? []),
    log: options.log ?? silentLog(),
    warnings: options.warnings ?? [],
    config: options.config ?? { collections: {} },
  });
}

// The change that updates `document` to `data`, and the change that creates it.
function updateOf(document: string, data: unknown): SaveChange {
  return { document, baseRevision: 'rev', deleted: false, data };
}
function createOf(document: string, data: unknown): SaveChange {
  return { document, baseRevision: null, deleted: false, data };
}

// A Markdown value: its `data` (the fields the stage checks) and its `body`.
function markdown(
  data: Record<string, unknown>,
  body = '',
): { data: Record<string, unknown>; body: string } {
  return { data, body };
}

describe('collectWarnings', () => {
  it('lets a present image under public/ pass', async () => {
    const folder = await siteWith({ 'public/images/hero.png': 'png' });
    const ctx = ctxOf(folder, [
      updateOf('posts/first', markdown({ hero: '/images/hero.png' })),
    ]);

    await expect(collectWarnings(ctx)).resolves.toBeUndefined();

    expect(ctx.warnings).toEqual([]);
  });

  it('warns for a changed string whose image is missing, and names its field path', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(
      folder,
      [updateOf('posts/first', markdown({ hero: '/images/gone.png' }))],
      { stored: [['posts/first', markdown({ hero: '/images/old.png' })]] },
    );

    await expect(collectWarnings(ctx)).resolves.toBeUndefined();

    expect(ctx.warnings).toEqual([
      { key: 'posts/first', path: ['hero'], code: WARNING },
    ]);
  });

  it('does not warn for a string that the stored value already had', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(
      folder,
      [updateOf('posts/first', markdown({ hero: '/images/gone.png' }))],
      { stored: [['posts/first', markdown({ hero: '/images/gone.png' })]] },
    );

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([]);
  });

  it('checks every string of a created document, in document order', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(folder, [
      createOf(
        'posts/new-post',
        markdown({ hero: '/images/a.png', title: '/images/b.webp' }),
      ),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'posts/new-post', path: ['hero'], code: WARNING },
      { key: 'posts/new-post', path: ['title'], code: WARNING },
    ]);
  });

  it('never checks the body of a Markdown document', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(folder, [
      createOf('posts/new-post', markdown({ title: 'Hi' }, '/images/gone.png')),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([]);
  });

  it('skips an image() field, and still checks the string next to it', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(folder, [
      updateOf(
        'posts/first',
        markdown({ cover: '/images/gone.png', hero: '/images/gone.png' }),
      ),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'posts/first', path: ['hero'], code: WARNING },
    ]);
  });

  it('checks every string of a data: document, which has no schema', async () => {
    const folder = await siteWith({ 'public/images/ok.webp': 'webp' });
    const ctx = ctxOf(folder, [
      createOf('data:src/site.json', {
        logo: '/logo.svg',
        links: ['/images/ok.webp', 'https://example.test/x.png', 'text'],
      }),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'data:src/site.json', path: ['logo'], code: WARNING },
    ]);
  });

  it('checks the strings of a JSON collection, nested items included', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(
      folder,
      [updateOf('pages/about', { body: '/images/gone.jpg' })],
      { stored: [['pages/about', { body: 'Hello' }]] },
    );

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'pages/about', path: ['body'], code: WARNING },
    ]);
  });

  it('skips a document whose collection has no schema', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(folder, [
      createOf('authors/ana', { avatar: '/images/gone.png' }),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([]);
  });

  it('keeps a key named __proto__ as a field', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(folder, [
      createOf(
        'data:src/site.json',
        JSON.parse('{"__proto__":"/images/gone.png"}'),
      ),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'data:src/site.json', path: ['__proto__'], code: WARNING },
    ]);
  });

  it.each(['/../x.png', '/images/../../x.png', '/%2e%2e/x.png', '/..%5Cx.png'])(
    'warns for %s, which climbs out of public/, though the file exists beside it',
    async (text) => {
      const folder = await siteWith({ 'x.png': 'outside' });
      const ctx = ctxOf(folder, [
        updateOf('posts/first', markdown({ hero: text })),
      ]);

      await collectWarnings(ctx);

      expect(ctx.warnings).toEqual([
        { key: 'posts/first', path: ['hero'], code: WARNING },
      ]);
    },
  );

  it.each([
    'images/hero.png',
    '//cdn.example.test/hero.png',
    '/images\\hero.png',
    '/about',
    '/about?format=png',
    '/images/hero.png.txt',
    '/images/png',
    '/images/hero.pngx',
    'see /images/hero.png',
    'https://example.test/hero.png',
  ])('does not treat %s as an image path', async (text) => {
    const folder = await siteWith({});
    const ctx = ctxOf(folder, [
      updateOf('posts/first', markdown({ hero: text })),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([]);
  });

  it('checks a path by its file once the query and the hash are cut', async () => {
    const folder = await siteWith({ 'public/images/hero.png': 'png' });
    const ctx = ctxOf(folder, [
      updateOf(
        'posts/first',
        markdown({
          hero: '/images/hero.png?v=2',
          title: '/images/gone.png#top',
        }),
      ),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'posts/first', path: ['title'], code: WARNING },
    ]);
  });

  it('matches the image extension without regard to case', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(folder, [
      updateOf('posts/first', markdown({ hero: '/images/GONE.PNG' })),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'posts/first', path: ['hero'], code: WARNING },
    ]);
  });

  it('finds a percent-encoded name by its decoded file', async () => {
    const folder = await siteWith({ 'public/images/my pic.png': 'png' });
    const ctx = ctxOf(folder, [
      updateOf(
        'posts/first',
        markdown({
          hero: '/images/my%20pic.png',
          title: '/images/my%20gone.png',
        }),
      ),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'posts/first', path: ['title'], code: WARNING },
    ]);
  });

  it('keeps a name that is not valid percent-encoding as a literal name', async () => {
    const folder = await siteWith({ 'public/images/100%.png': 'png' });
    const ctx = ctxOf(folder, [
      updateOf('posts/first', markdown({ hero: '/images/100%.png' })),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([]);
  });

  it('warns for an image name that is a folder, not a file', async () => {
    const folder = await siteWith({ 'public/images/dir.png': null });
    const ctx = ctxOf(folder, [
      updateOf('posts/first', markdown({ hero: '/images/dir.png' })),
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'posts/first', path: ['hero'], code: WARNING },
    ]);
  });

  it('logs and skips a document whose schema cannot be walked, and still passes', async () => {
    const folder = await siteWith({});
    const warn = vi.fn();
    const ctx = ctxOf(
      folder,
      [updateOf('posts/first', markdown({ hero: '/images/gone.png' }))],
      { collections: brokenCollections(), log: { ...silentLog(), warn } },
    );

    await expect(collectWarnings(ctx)).resolves.toBeUndefined();

    expect(ctx.warnings).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'the image check of a document is skipped: its schema cannot be walked',
      { document: 'posts/first', reason: 'unresolved $ref "#/$defs/missing"' },
    );
  });

  it('does not check a deleted change, even when it carries a value', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(folder, [
      {
        document: 'posts/first',
        baseRevision: 'rev',
        deleted: true,
        data: markdown({ hero: '/images/gone.png' }),
      },
    ]);

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([]);
  });

  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico'])(
    'warns for a missing .%s image',
    async (extension) => {
      const folder = await siteWith({});
      const ctx = ctxOf(folder, [
        updateOf(
          'posts/first',
          markdown({ hero: `/images/gone.${extension}` }),
        ),
      ]);

      await collectWarnings(ctx);

      expect(ctx.warnings).toEqual([
        { key: 'posts/first', path: ['hero'], code: WARNING },
      ]);
    },
  );

  it('checks a file() entry as its raw value, not as Markdown data', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(
      folder,
      [updateOf('posts/entry', { hero: '/images/gone.png' })],
      {
        documents: [
          documentOf('posts/entry', {
            file: 'src/content/posts/shared.md',
            format: 'md',
            entryKey: 'entry',
          }),
        ],
      },
    );

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'posts/entry', path: ['hero'], code: WARNING },
    ]);
  });

  it('checks the data of an .mdx document, and never its body', async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(
      folder,
      [
        updateOf(
          'posts/notes',
          markdown({ hero: '/images/gone.png' }, '/images/gone.png'),
        ),
      ],
      {
        documents: [
          documentOf('posts/notes', {
            file: 'src/content/posts/notes.mdx',
            format: 'mdx',
          }),
        ],
      },
    );

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'posts/notes', path: ['hero'], code: WARNING },
    ]);
  });

  it("reads a create's format from the collection's newEntryFormat", async () => {
    const folder = await siteWith({});
    const ctx = ctxOf(
      folder,
      [createOf('posts/new-post', { hero: '/images/gone.png' })],
      { config: { collections: { posts: { newEntryFormat: 'json' } } } },
    );

    await collectWarnings(ctx);

    expect(ctx.warnings).toEqual([
      { key: 'posts/new-post', path: ['hero'], code: WARNING },
    ]);
  });

  it('appends to the warnings already in the context', async () => {
    const folder = await siteWith({});
    const earlier = { key: 'other/doc', path: ['a'], code: 'other' };
    const ctx = ctxOf(
      folder,
      [updateOf('posts/first', markdown({ hero: '/images/gone.png' }))],
      { warnings: [earlier] },
    );

    await expect(collectWarnings(ctx)).resolves.toBeUndefined();

    expect(ctx.warnings).toEqual([
      earlier,
      { key: 'posts/first', path: ['hero'], code: WARNING },
    ]);
  });
});
