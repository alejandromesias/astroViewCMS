import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { revisionOf } from 'preview-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bundleOf,
  documentOf,
  MEDIA_CONFIG,
  saveContext,
} from '../../test/helpers/save-context.ts';
import {
  removeWorkingCopies,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import type { Bundle } from '../bundle/read.ts';
import type { SaveChange } from './body.ts';
import type { SaveContext } from './context.ts';
import { rewriteStagedImages } from './images.ts';
import { mediaMapOf } from './validate.ts';

const ORIGIN = 'http://cms.localhost:4400';
const PREFIX = `${ORIGIN}/media/staging/`;
const FOLDER = MEDIA_CONFIG.folder;
const AUTHOR_FILE = 'src/content/authors/ana.json';
const SHARED_FILE = 'src/content/testimonials.json';
const POST_FILE = 'src/content/posts/first.md';

afterEach(removeWorkingCopies);

const IMAGE = { type: 'string', cms: 'image' };

function collections(): Bundle['collections'] {
  return new Map([
    [
      'authors',
      {
        loader: {
          kind: 'glob',
          pattern: '**/*.{json,yaml}',
          base: 'src/content/authors',
        },
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            avatar: IMAGE,
            note: { type: 'string' },
            gallery: { type: 'array', items: IMAGE },
          },
        },
      },
    ],
    [
      'testimonials',
      {
        loader: { kind: 'file', pattern: SHARED_FILE },
        schema: { type: 'object', properties: { photo: IMAGE } },
      },
    ],
    [
      'posts',
      {
        loader: {
          kind: 'glob',
          pattern: '**/*.{md,mdx}',
          base: 'src/content/posts',
        },
        schema: { type: 'object', properties: { cover: IMAGE } },
      },
    ],
  ]);
}

/** A site folder with one staged image per entry of `images` (name to bytes), and media.json listing them. */
async function siteWith(
  images: Record<string, string>,
  files: Record<string, string> = {},
): Promise<{
  folder: string;
  url: (name: string) => string;
  id: (name: string) => string;
}> {
  const folder = await tempWorkingCopy(files);
  const ids = new Map<string, string>();
  const media: Record<string, unknown> = {};
  for (const [name, bytes] of Object.entries(images)) {
    const id = createHash('sha256').update(bytes).digest('hex');
    ids.set(name, id);
    media[id] = { width: 2, height: 3, format: 'png' };
    await mkdir(join(folder, 'staging'), { recursive: true });
    await writeFile(join(folder, 'staging', `${id}.png`), bytes);
  }
  await writeFile(join(folder, 'media.json'), JSON.stringify(media));
  const id = (name: string): string => ids.get(name) ?? 'unknown';
  return { folder, id, url: (name) => `${PREFIX}${id(name)}.png` };
}

function ctxOf(
  folder: string,
  changes: SaveChange[],
  overrides: Partial<SaveContext> = {},
): SaveContext {
  return saveContext({
    siteFolder: folder,
    changes,
    bundle: bundleOf([], collections()),
    documents: bundleOf([
      documentOf('authors/ana', { file: AUTHOR_FILE }),
      documentOf('testimonials/ana', {
        file: SHARED_FILE,
        entryKey: 'ana',
      }),
      documentOf('posts/first', { file: POST_FILE, format: 'md' }),
    ]).documents,
    media: {
      stagingDir: join(folder, 'staging'),
      mediaFile: join(folder, 'media.json'),
      cmsOrigin: ORIGIN,
    },
    ...overrides,
  });
}

const update = (document: string, data: unknown): SaveChange => ({
  document,
  baseRevision: 'r',
  deleted: false,
  data,
});
const create = (document: string, data: unknown): SaveChange => ({
  document,
  baseRevision: null,
  deleted: false,
  data,
});

const nameOf = (id: string): string => `${FOLDER}/${id.slice(0, 16)}.png`;

describe('rewriteStagedImages', () => {
  it('rewrites the image of an updated document to a path relative to its file, and lists the copy', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const sent = update('authors/ana', { name: 'Ana', avatar: site.url('a') });
    const ctx = ctxOf(site.folder, [sent]);
    const before = ctx.changes;

    expect(await rewriteStagedImages(ctx)).toBeUndefined();

    expect(ctx.changes).not.toBe(before);
    expect(ctx.changes).toStrictEqual([
      update('authors/ana', {
        name: 'Ana',
        avatar: `../../assets/uploads/${site.id('a').slice(0, 16)}.png`,
      }),
    ]);
    expect(sent.data).toStrictEqual({ name: 'Ana', avatar: site.url('a') });
    expect(ctx.copies).toStrictEqual([
      {
        from: join(site.folder, 'staging', `${site.id('a')}.png`),
        to: nameOf(site.id('a')),
      },
    ]);
  });

  it('rewrites the image of a created document, relative to the file planWrite would pick', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const ctx = ctxOf(site.folder, [
      create('authors/lee', { avatar: site.url('a') }),
    ]);
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.changes[0]?.data).toStrictEqual({
      avatar: `../../assets/uploads/${site.id('a').slice(0, 16)}.png`,
    });
  });

  it('rewrites an entry of a shared file relative to the shared file, and an image inside an array', async () => {
    const site = await siteWith({ a: 'bytes a', b: 'bytes b' });
    const ctx = ctxOf(site.folder, [
      update('testimonials/ana', { photo: site.url('a') }),
      update('authors/ana', { gallery: ['./kept.png', site.url('b')] }),
    ]);
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.changes.map((change) => change.data)).toStrictEqual([
      { photo: `../assets/uploads/${site.id('a').slice(0, 16)}.png` },
      {
        gallery: [
          './kept.png',
          `../../assets/uploads/${site.id('b').slice(0, 16)}.png`,
        ],
      },
    ]);
  });

  it('rewrites the image of a created entry of a shared file', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const ctx = ctxOf(site.folder, [
      create('testimonials/lee', { photo: site.url('a') }),
    ]);
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.changes[0]?.data).toStrictEqual({
      photo: `../assets/uploads/${site.id('a').slice(0, 16)}.png`,
    });
  });

  it('rewrites an image in the frontmatter of a Markdown document, and leaves the body alone', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const ctx = ctxOf(site.folder, [
      update('posts/first', {
        data: { cover: site.url('a') },
        body: `see ${site.url('a')}`,
      }),
    ]);
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.changes[0]?.data).toStrictEqual({
      data: { cover: `../../assets/uploads/${site.id('a').slice(0, 16)}.png` },
      body: `see ${site.url('a')}`,
    });
  });

  it('keeps a dot-named folder below the file as ./.name, not a bare .name', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const ctx = ctxOf(site.folder, [
      update('authors/ana', { avatar: site.url('a') }),
    ]);
    Object.assign(ctx, {
      config: {
        collections: {},
        media: { folder: 'src/content/authors/.assets' },
      },
    });
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.changes[0]?.data).toStrictEqual({
      avatar: `./.assets/${site.id('a').slice(0, 16)}.png`,
    });
  });

  it('names a ref in the media folder of the file as ./name', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const ctx = ctxOf(site.folder, [
      update('authors/ana', { avatar: site.url('a') }),
    ]);
    // The same folder as the document's file: the ref has no `..`.
    Object.assign(ctx, {
      config: {
        collections: {},
        media: { folder: 'src/content/authors' },
      },
    });
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.changes[0]?.data).toStrictEqual({
      avatar: `./${site.id('a').slice(0, 16)}.png`,
    });
  });

  it('copies one image used by two documents once', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const ctx = ctxOf(site.folder, [
      update('authors/ana', { avatar: site.url('a') }),
      update('testimonials/ana', { photo: site.url('a') }),
    ]);
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.copies).toHaveLength(1);
    expect(ctx.changes.map((change) => change.data)).toStrictEqual([
      { avatar: `../../assets/uploads/${site.id('a').slice(0, 16)}.png` },
      { photo: `../assets/uploads/${site.id('a').slice(0, 16)}.png` },
    ]);
  });

  it('sends the same value again to the same path, and leaves a relative value and the other strings alone', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const data = {
      avatar: site.url('a'),
      note: site.url('a'),
    };
    const first = ctxOf(site.folder, [update('authors/ana', data)]);
    const second = ctxOf(site.folder, [update('authors/ana', data)]);
    await rewriteStagedImages(first);
    await rewriteStagedImages(second);
    expect(first.changes).toStrictEqual(second.changes);
    // `note` is a plain string field: a staging URL there stays (D22).
    expect(first.changes[0]?.data).toStrictEqual({
      avatar: `../../assets/uploads/${site.id('a').slice(0, 16)}.png`,
      note: site.url('a'),
    });
    const relative = ctxOf(site.folder, [
      update('authors/ana', { avatar: '../../assets/uploads/x.png' }),
    ]);
    const kept = relative.changes;
    expect(await rewriteStagedImages(relative)).toBeUndefined();
    expect(relative.changes[0]).toBe(kept[0]);
    expect(relative.copies).toStrictEqual([]);
  });

  it('leaves a delete, a data: document and a document with no schema alone', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const ctx = ctxOf(site.folder, [
      { document: 'authors/ana', baseRevision: 'r', deleted: true },
      update('data:site', { avatar: site.url('a') }),
      update('nowhere/x', { avatar: site.url('a') }),
    ]);
    const sent = ctx.changes;
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.changes).toStrictEqual(sent);
    expect(ctx.copies).toStrictEqual([]);
  });

  it('leaves a change alone when the planner will refuse it (no collection, an unknown update)', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const sent = [
      create('lonely', { avatar: site.url('a') }),
      update('authors/unknown', { avatar: site.url('a') }),
    ];
    const ctx = ctxOf(site.folder, sent);
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.changes).toStrictEqual(sent);
    expect(ctx.copies).toStrictEqual([]);
  });

  it('reuses an existing file with the same bytes and plans no copy', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const target = nameOf(site.id('a'));
    await mkdir(join(site.folder, dirname(target)), { recursive: true });
    await writeFile(join(site.folder, target), 'bytes a');
    const ctx = ctxOf(site.folder, [
      update('authors/ana', { avatar: site.url('a') }),
    ]);
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.copies).toStrictEqual([]);
    expect(ctx.changes[0]?.data).toStrictEqual({
      avatar: `../../assets/uploads/${site.id('a').slice(0, 16)}.png`,
    });
  });

  it('answers 422 media-collision, and changes nothing, when the name holds other bytes', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const target = nameOf(site.id('a'));
    await mkdir(join(site.folder, dirname(target)), { recursive: true });
    await writeFile(join(site.folder, target), 'other bytes');
    const sent = [update('authors/ana', { gallery: ['x.png', site.url('a')] })];
    const ctx = ctxOf(site.folder, sent);
    expect(await rewriteStagedImages(ctx)).toStrictEqual({
      status: 422,
      body: {
        error: 'invalid',
        errors: [
          {
            key: 'authors/ana',
            path: ['gallery', 1],
            message: `Another image is already saved as "${target}". Pick a different image.`,
            code: 'media-collision',
          },
        ],
      },
    });
    expect(ctx.changes).toBe(sent);
    expect(ctx.copies).toStrictEqual([]);
  });

  it('answers 422 media-collision for two staged images that take one name in a save', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const prefix = site.id('a').slice(0, 16);
    const otherId = `${prefix}${'0'.repeat(48)}`;
    await writeFile(
      join(site.folder, 'media.json'),
      JSON.stringify({
        [site.id('a')]: { width: 2, height: 3, format: 'png' },
        [otherId]: { width: 2, height: 3, format: 'png' },
      }),
    );
    await writeFile(join(site.folder, 'staging', `${otherId}.png`), 'bytes z');
    const ctx = ctxOf(site.folder, [
      update('authors/ana', {
        gallery: [site.url('a'), `${PREFIX}${otherId}.png`],
      }),
    ]);
    const stop = await rewriteStagedImages(ctx);
    expect(stop?.status).toBe(422);
    expect(stop?.body).toMatchObject({
      errors: [{ path: ['gallery', 1], code: 'media-collision' }],
    });
  });

  it.each([
    [
      'a staging file that is gone',
      (id: string) => `${PREFIX}${id}.png`,
      'gone',
    ],
    [
      'an id that media.json does not know',
      () => `${PREFIX}${'f'.repeat(64)}.png`,
      'ok',
    ],
    ['a name that is not a staged name', () => `${PREFIX}../x.png`, 'ok'],
    ['a name with a query', (id: string) => `${PREFIX}${id}.png?x=1`, 'ok'],
  ])(
    'answers 422 staged-image-missing for %s',
    async (_label, urlOf, state) => {
      const site = await siteWith({ a: 'bytes a' });
      if (state === 'gone') {
        await rm(join(site.folder, 'staging', `${site.id('a')}.png`));
      }
      const sent = [create('authors/lee', { avatar: urlOf(site.id('a')) })];
      const ctx = ctxOf(site.folder, sent);
      expect(await rewriteStagedImages(ctx)).toStrictEqual({
        status: 422,
        body: {
          error: 'invalid',
          errors: [
            {
              key: 'authors/lee',
              path: ['avatar'],
              message:
                'The uploaded image is not available any more. Upload it again.',
              code: 'staged-image-missing',
            },
          ],
        },
      });
      expect(ctx.changes).toBe(sent);
    },
  );

  it('reports every refused image, not only the first', async () => {
    const site = await siteWith({});
    const ctx = ctxOf(site.folder, [
      update('authors/ana', { avatar: `${PREFIX}${'a'.repeat(64)}.png` }),
      update('testimonials/ana', { photo: `${PREFIX}${'b'.repeat(64)}.png` }),
    ]);
    const stop = await rewriteStagedImages(ctx);
    expect(stop?.body).toMatchObject({
      errors: [
        { key: 'authors/ana', path: ['avatar'] },
        { key: 'testimonials/ana', path: ['photo'] },
      ],
    });
  });

  it('keeps a key named __proto__ as an own key of the rewritten value', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const data: unknown = JSON.parse(
      `{"__proto__":{"polluted":true},"avatar":"${site.url('a')}"}`,
    );
    const ctx = ctxOf(site.folder, [update('authors/ana', data)]);
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    const rewritten = ctx.changes[0]?.data;
    expect(Object.keys(rewritten as object)).toStrictEqual([
      '__proto__',
      'avatar',
    ]);
    expect(Object.getPrototypeOf(rewritten)).toBe(Object.prototype);
  });

  it('logs and skips a document whose schema cannot be walked', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const broken: Bundle['collections'] = new Map([
      [
        'authors',
        {
          loader: {
            kind: 'glob',
            pattern: '**/*.json',
            base: 'src/content/authors',
          },
          schema: { $ref: '#/$defs/missing' },
        },
      ],
    ]);
    const sent = [update('authors/ana', { avatar: site.url('a') })];
    const ctx = ctxOf(site.folder, sent, {
      bundle: bundleOf([], broken),
      log,
    });
    expect(await rewriteStagedImages(ctx)).toBeUndefined();
    expect(ctx.changes).toStrictEqual(sent);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[1]).toMatchObject({
      document: 'authors/ana',
    });
  });

  it('gives a ref that the renderer finds in mediaMapOf, from the media folder and the holding file', async () => {
    const site = await siteWith({ a: 'bytes a' });
    const ctx = ctxOf(site.folder, [
      update('authors/ana', { avatar: site.url('a') }),
    ]);
    await rewriteStagedImages(ctx);
    const data = ctx.changes[0]?.data as { avatar: string } | undefined;
    const ref = data?.avatar ?? '';
    const map = await mediaMapOf(ctx.media, FOLDER, ctx.log);
    // The renderer's rule: the project path is the ref joined to the folder of the parsing file.
    const found = map[posix.join(posix.dirname(AUTHOR_FILE), ref)];
    expect(found?.width).toBe(2);
    expect(found?.url).toBe(site.url('a'));
  });

  it('names the copy by revisionOf of its bytes, the hash that images.json records', async () => {
    const bytes = 'the bytes of an avatar';
    const site = await siteWith({ avatar: bytes });
    const ctx = ctxOf(site.folder, [
      update('authors/ana', { avatar: site.url('avatar') }),
    ]);

    await rewriteStagedImages(ctx);

    expect(revisionOf(bytes)).toBe(site.id('avatar').slice(0, 16));
    expect(ctx.copies.map((copy) => copy.to)).toEqual([
      `${FOLDER}/${revisionOf(bytes)}.png`,
    ]);
  });
});
