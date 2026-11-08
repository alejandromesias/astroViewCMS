import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import {
  bundleOf,
  documentOf,
  saveContext,
} from '../../test/helpers/save-context.ts';
import type { Bundle, DocumentEntry } from '../bundle/read.ts';
import {
  type CollectionSchemaOf,
  createReferenceIndex,
  type ReferenceIndex,
} from '../references/reference-index.ts';
import type { SaveChange } from './body.ts';
import type { DeleteGuard, SaveContext } from './context.ts';
import {
  checkDeleteGuard,
  createDeleteGuard,
  updateIndexAfterCommit,
} from './delete-guard.ts';

const ANA = 'authors/ana-torres';
const ANA_FILE = 'src/content/authors/ana-torres.json';
const BLOG_1 = 'src/content/blog/blog-1.md';
const POST = '---\ntitle: Hello\nauthor: ana-torres\n---\nBody\n';
const CLEARED = '---\ntitle: Hello\n---\nBody\n';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => removeTestRoot(folder)));
});

// The collections of the test bundle: blog posts whose `author` names an author, and the authors (no schema). The blog
// loader's pattern is `pattern`, so a test can make creates Markdown or JSON.
function collections(pattern = '**/*.{md,mdx}'): Bundle['collections'] {
  return new Map([
    [
      'blog',
      {
        loader: { kind: 'glob', pattern, base: 'src/content/blog' },
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            author: {
              type: 'string',
              cms: 'reference',
              collection: 'authors',
            },
          },
        },
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

// A working copy of `files` (relative path to text), in a folder of its own.
async function workingCopy(files: Record<string, string>): Promise<string> {
  const folder = await makeTestRoot();
  folders.push(folder);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  return folder;
}

// A save context over `bundle` and `folder`, whose visible documents are the bundle's. Overrides replace any field.
function ctxOf(
  folder: string,
  bundle: Bundle,
  changes: SaveChange[],
  overrides: Partial<SaveContext> = {},
): SaveContext {
  return saveContext({
    bundle,
    siteFolder: folder,
    documents: new Map(bundle.documents),
    changes,
    ...overrides,
  });
}

// The change of a deletion, and the change that writes `data` to `document` (an update, or a create when it is new).
function deleteOf(document: string): SaveChange {
  return { document, baseRevision: 'rev', deleted: true };
}
function writeOf(document: string, data: unknown): SaveChange {
  return { document, baseRevision: 'rev', deleted: false, data };
}

// The documents of the common case: an author and a Markdown post that names her.
function authorAndPost(): DocumentEntry[] {
  return [
    documentOf(ANA, { file: ANA_FILE, format: 'json' }),
    documentOf('blog/blog-1', { file: BLOG_1, format: 'md' }),
  ];
}

// The 409 of the author Ana, blocked by `referrers`.
function blocked(referrers: string[], needsDeveloper = false) {
  return {
    status: 409,
    body: {
      error: 'referenced-by',
      document: ANA,
      referrers,
      ...(needsDeveloper ? { needsDeveloper: true } : {}),
    },
  };
}

describe('checkDeleteGuard', () => {
  it('lets a save that deletes nothing pass, and builds no index', async () => {
    const makeIndex = vi.fn(createReferenceIndex);
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const ctx = ctxOf(folder, bundle, [writeOf('blog/blog-1', {})], {
      guard: createDeleteGuard({ makeIndex }),
    });
    expect(await checkDeleteGuard(ctx)).toBeUndefined();
    expect(makeIndex).not.toHaveBeenCalled();
  });

  it('answers 409 with the posts that name a deleted author', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const ctx = ctxOf(folder, bundle, [deleteOf(ANA)]);
    expect(await checkDeleteGuard(ctx)).toStrictEqual(blocked(['blog/blog-1']));
  });

  it('lets a deletion pass when nothing points at the document', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: CLEARED,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const ctx = ctxOf(folder, bundle, [deleteOf(ANA)]);
    expect(await checkDeleteGuard(ctx)).toBeUndefined();
  });

  it('lets the save pass when the same changeset clears the field of the post', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const ctx = ctxOf(folder, bundle, [
      deleteOf(ANA),
      writeOf('blog/blog-1', { data: { title: 'Hello' }, body: 'Body\n' }),
    ]);
    expect(await checkDeleteGuard(ctx)).toBeUndefined();
  });

  it('lets the save pass when the same changeset deletes the post', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const ctx = ctxOf(folder, bundle, [deleteOf(ANA), deleteOf('blog/blog-1')]);
    expect(await checkDeleteGuard(ctx)).toBeUndefined();
  });

  it('still answers 409 for a post that the same changeset changes but that keeps naming the author', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const ctx = ctxOf(folder, bundle, [
      deleteOf(ANA),
      writeOf('blog/blog-1', {
        data: { title: 'Hello', author: 'ana-torres' },
        body: 'Edited\n',
      }),
    ]);
    expect(await checkDeleteGuard(ctx)).toStrictEqual(blocked(['blog/blog-1']));
  });

  it('answers 409 for a new post, created in the same save, that names the deleted author', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: CLEARED,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const ctx = ctxOf(folder, bundle, [
      deleteOf(ANA),
      writeOf('blog/blog-2', {
        data: { title: 'New', author: 'ana-torres' },
        body: 'New\n',
      }),
    ]);
    expect(await checkDeleteGuard(ctx)).toStrictEqual(blocked(['blog/blog-2']));
  });

  it.each([
    ['**/*.md', undefined, true],
    ['**/*.{md,mdx}', undefined, true],
    ['**/*.{json,md}', undefined, false],
    ['**/*.json', 'md', true],
    ['**/*', undefined, false],
    ['**/*md', undefined, false],
    ['**/*.{md,json}.txt', undefined, false],
  ] as const)(
    'reads a new post of pattern %s with newEntryFormat %s as Markdown: %s',
    async (pattern, configured, referenced) => {
      const folder = await workingCopy({ [ANA_FILE]: '{"name":"Ana"}\n' });
      const bundle = bundleOf(
        [documentOf(ANA, { file: ANA_FILE, format: 'json' })],
        collections(pattern),
      );
      const ctx = ctxOf(
        folder,
        bundle,
        [
          deleteOf(ANA),
          writeOf('blog/new', {
            data: { title: 'New', author: 'ana-torres' },
            body: 'New\n',
          }),
        ],
        {
          config: {
            collections:
              configured === undefined
                ? {}
                : { blog: { newEntryFormat: configured } },
          },
        },
      );
      expect(await checkDeleteGuard(ctx)).toStrictEqual(
        referenced ? blocked(['blog/new']) : undefined,
      );
    },
  );

  it('reads a new value of a file() collection raw, whatever the file is named', async () => {
    const folder = await workingCopy({ [ANA_FILE]: '{"name":"Ana"}\n' });
    const fileCollections: Bundle['collections'] = new Map([
      [
        'blog',
        {
          loader: { kind: 'file', pattern: 'src/content/blog.md' },
          schema: {
            type: 'object',
            properties: {
              author: {
                type: 'string',
                cms: 'reference',
                collection: 'authors',
              },
            },
          },
        },
      ],
    ]);
    const bundle = bundleOf(
      [documentOf(ANA, { file: ANA_FILE, format: 'json' })],
      fileCollections,
    );
    // The new entry is a raw value, as a file() entry is: its `author` is a top-level field. Read as Markdown, it would
    // be `{ data, body }`, and the author would not be found.
    const ctx = ctxOf(folder, bundle, [
      deleteOf(ANA),
      writeOf('blog/new', { author: 'ana-torres' }),
    ]);
    expect(await checkDeleteGuard(ctx)).toStrictEqual(blocked(['blog/new']));
  });

  it('answers 409 with needsDeveloper when a referrer is read-only', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(
      [
        documentOf(ANA, { file: ANA_FILE, format: 'json' }),
        documentOf('blog/blog-1', {
          file: BLOG_1,
          format: 'md',
          editable: false,
        }),
      ],
      collections(),
    );
    const ctx = ctxOf(folder, bundle, [deleteOf(ANA)]);
    expect(await checkDeleteGuard(ctx)).toStrictEqual(
      blocked(['blog/blog-1'], true),
    );
  });

  it('reports the first deleted key in sort order, with its referrers sorted', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      'src/content/authors/zoe-lee.json': '{"name":"Zoe"}\n',
      'src/content/blog/blog-1.md': POST,
      'src/content/blog/blog-2.md': POST.replace('ana-torres', 'zoe-lee'),
      'src/content/blog/blog-3.md': POST,
    });
    const bundle = bundleOf(
      [
        documentOf('blog/blog-3', {
          file: 'src/content/blog/blog-3.md',
          format: 'md',
        }),
        documentOf(ANA, { file: ANA_FILE, format: 'json' }),
        documentOf('authors/zoe-lee', {
          file: 'src/content/authors/zoe-lee.json',
          format: 'json',
        }),
        documentOf('blog/blog-1', { file: BLOG_1, format: 'md' }),
        documentOf('blog/blog-2', {
          file: 'src/content/blog/blog-2.md',
          format: 'md',
        }),
      ],
      collections(),
    );
    const ctx = ctxOf(folder, bundle, [
      deleteOf('authors/zoe-lee'),
      deleteOf(ANA),
    ]);
    expect(await checkDeleteGuard(ctx)).toStrictEqual({
      status: 409,
      body: {
        error: 'referenced-by',
        document: ANA,
        referrers: ['blog/blog-1', 'blog/blog-3'],
      },
    });
  });

  it('skips a document that cannot be parsed and logs it, and leaves out one with no codec silently', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      'src/content/blog/broken.json': '{ not json',
      'src/content/blog/notes.toml': 'title = "x"\n',
      [BLOG_1]: POST,
    });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const bundle = bundleOf(
      [
        documentOf(ANA, { file: ANA_FILE, format: 'json' }),
        documentOf('blog/broken', {
          file: 'src/content/blog/broken.json',
          format: 'json',
        }),
        documentOf('blog/notes', {
          file: 'src/content/blog/notes.toml',
          format: 'toml',
        }),
        // After the two unreadable documents: a later referrer must still be read.
        documentOf('blog/blog-1', { file: BLOG_1, format: 'md' }),
      ],
      collections(),
    );
    const ctx = ctxOf(folder, bundle, [deleteOf(ANA)], { log });
    expect(await checkDeleteGuard(ctx)).toStrictEqual(blocked(['blog/blog-1']));
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'a document is left out of the reference index: it cannot be read',
      { document: 'blog/broken' },
    );
  });

  it('answers a JSON 500 when the index cannot be built, and writes nothing', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const ctx = ctxOf(folder, bundle, [deleteOf(ANA)], {
      guard: createDeleteGuard({
        makeIndex: () => {
          throw new Error('boom');
        },
      }),
    });
    expect(await checkDeleteGuard(ctx)).toStrictEqual({
      status: 500,
      body: {
        error: 'reference-index-failed',
        message: 'The reference index could not be built: boom',
      },
    });
  });

  it('builds the index once for the saves of one bundle, and again for another bundle', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const makeIndex = vi.fn(createReferenceIndex);
    const guard = createDeleteGuard({ makeIndex });
    const bundle = bundleOf(authorAndPost(), collections());
    await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard }));
    await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard }));
    expect(makeIndex).toHaveBeenCalledTimes(1);
    const other = bundleOf(authorAndPost(), collections());
    await checkDeleteGuard(ctxOf(folder, other, [deleteOf(ANA)], { guard }));
    expect(makeIndex).toHaveBeenCalledTimes(2);
  });

  it('reads a JSON document whose value has a data key as a plain value, not as Markdown', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      'src/content/blog/nested.json': '{"data":{"author":"ana-torres"}}',
    });
    const bundle = bundleOf(
      [
        documentOf(ANA, { file: ANA_FILE, format: 'json' }),
        documentOf('blog/nested', {
          file: 'src/content/blog/nested.json',
          format: 'json',
        }),
      ],
      collections(),
    );
    const ctx = ctxOf(folder, bundle, [deleteOf(ANA)]);
    expect(await checkDeleteGuard(ctx)).toBeUndefined();
  });
});

describe('updateIndexAfterCommit', () => {
  it('puts a save into the index, so a later delete sees the new value', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const guard = createDeleteGuard();
    // The first delete builds the index, and answers 409 for the post.
    expect(
      await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard })),
    ).toStrictEqual(blocked(['blog/blog-1']));
    // The post is then cleared and saved: the hook puts the new value in the index.
    await writeFile(join(folder, BLOG_1), CLEARED);
    await updateIndexAfterCommit(
      ctxOf(
        folder,
        bundle,
        [writeOf('blog/blog-1', { data: { title: 'Hello' }, body: 'Body\n' })],
        { guard },
      ),
    );
    expect(
      await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard })),
    ).toBeUndefined();
  });

  it('takes a deleted document out of the index as a referrer', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const guard = createDeleteGuard();
    await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard }));
    await updateIndexAfterCommit(
      ctxOf(folder, bundle, [deleteOf('blog/blog-1')], { guard }),
    );
    expect(
      await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard })),
    ).toBeUndefined();
  });

  it('indexes a created document from its written value, as Markdown when its format is', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: CLEARED,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const guard = createDeleteGuard();
    await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard }));
    await updateIndexAfterCommit(
      ctxOf(
        folder,
        bundle,
        [
          writeOf('blog/blog-2', {
            data: { title: 'New', author: 'ana-torres' },
            body: 'New\n',
          }),
        ],
        { guard },
      ),
    );
    expect(
      await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard })),
    ).toStrictEqual(blocked(['blog/blog-2']));
  });

  it('does nothing before the index is built, so no index is built by a save', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const makeIndex = vi.fn(createReferenceIndex);
    const guard = createDeleteGuard({ makeIndex });
    const bundle = bundleOf(authorAndPost(), collections());
    await updateIndexAfterCommit(
      ctxOf(folder, bundle, [writeOf('blog/blog-1', {})], { guard }),
    );
    expect(makeIndex).not.toHaveBeenCalled();
  });

  it('leaves the index of another bundle alone', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const guard = createDeleteGuard();
    const bundle = bundleOf(authorAndPost(), collections());
    const other = bundleOf(authorAndPost(), collections());
    await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard }));
    await updateIndexAfterCommit(
      ctxOf(folder, other, [deleteOf('blog/blog-1')], { guard }),
    );
    expect(
      await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard })),
    ).toStrictEqual(blocked(['blog/blog-1']));
  });

  it('does nothing when the index could not be built, so a save can still commit', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const guard = createDeleteGuard({
      makeIndex: () => {
        throw new Error('boom');
      },
    });
    await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard }));
    await expect(
      updateIndexAfterCommit(
        ctxOf(folder, bundle, [writeOf('blog/blog-1', {})], { guard }),
      ),
    ).resolves.toBeUndefined();
  });

  it('removes a deleted document from the index, and updates a written one with its value', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const remove = vi.fn();
    const update = vi.fn();
    const makeIndex = (schemaOf: CollectionSchemaOf): ReferenceIndex => {
      const index = createReferenceIndex(schemaOf);
      return {
        ...index,
        remove: (key) => {
          remove(key);
          index.remove(key);
        },
        update: (key, value) => {
          update(key, value);
          index.update(key, value);
        },
      };
    };
    const guard = createDeleteGuard({ makeIndex });
    await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard }));
    await updateIndexAfterCommit(
      ctxOf(
        folder,
        bundle,
        [
          deleteOf('blog/blog-1'),
          writeOf('blog/blog-3', { data: { title: 'x' }, body: '' }),
        ],
        { guard },
      ),
    );
    expect(remove.mock.calls).toStrictEqual([['blog/blog-1']]);
    expect(update.mock.calls).toStrictEqual([['blog/blog-3', { title: 'x' }]]);
  });

  it.each([
    ['a string', 'x'],
    ['null', null],
    ['an object with no data field', { author: 'ana-torres' }],
  ])(
    'reads a new Markdown post whose value is %s as naming no author',
    async (_label, data) => {
      const folder = await workingCopy({ [ANA_FILE]: '{"name":"Ana"}\n' });
      const bundle = bundleOf(
        [documentOf(ANA, { file: ANA_FILE, format: 'json' })],
        collections(),
      );
      const ctx = ctxOf(folder, bundle, [
        deleteOf(ANA),
        writeOf('blog/new', data),
      ]);
      expect(await checkDeleteGuard(ctx)).toBeUndefined();
    },
  );

  it('reports a thrown value that is not an Error as text', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    const bundle = bundleOf(authorAndPost(), collections());
    const thrown: unknown = 'plain text';
    const ctx = ctxOf(folder, bundle, [deleteOf(ANA)], {
      guard: createDeleteGuard({
        makeIndex: () => {
          throw thrown;
        },
      }),
    });
    expect(await checkDeleteGuard(ctx)).toStrictEqual({
      status: 500,
      body: {
        error: 'reference-index-failed',
        message: 'The reference index could not be built: plain text',
      },
    });
  });

  it('marks the index stale when an update throws, so the save still commits and the next delete rebuilds', async () => {
    const folder = await workingCopy({
      [ANA_FILE]: '{"name":"Ana"}\n',
      [BLOG_1]: POST,
    });
    let built = 0;
    // The first index refuses every update; a rebuilt index works.
    const makeIndex = (schemaOf: CollectionSchemaOf): ReferenceIndex => {
      built += 1;
      const real = createReferenceIndex(schemaOf);
      if (built > 1) return real;
      return {
        ...real,
        update: () => {
          throw new Error('the index refused the update');
        },
      };
    };
    const guard: DeleteGuard = createDeleteGuard({ makeIndex });
    const bundle = bundleOf(authorAndPost(), collections());
    expect(
      await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard })),
    ).toStrictEqual(blocked(['blog/blog-1']));
    // Save 1 clears the post. The hook fails, and says so by rejecting (the write stage logs it).
    await writeFile(join(folder, BLOG_1), CLEARED);
    await expect(
      updateIndexAfterCommit(
        ctxOf(
          folder,
          bundle,
          [
            writeOf('blog/blog-1', {
              data: { title: 'Hello' },
              body: 'Body\n',
            }),
          ],
          { guard },
        ),
      ),
    ).rejects.toThrow('the index refused the update');
    // While stale, the hook takes no more updates: a later save's hook answers without touching the index.
    await expect(
      updateIndexAfterCommit(
        ctxOf(folder, bundle, [writeOf('blog/blog-1', {})], { guard }),
      ),
    ).resolves.toBeUndefined();
    // Save 2 deletes the author alone: the index is rebuilt from the working copy, where nothing points at her.
    expect(
      await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard })),
    ).toBeUndefined();
    expect(built).toBe(2);
    // The rebuilt index is kept: a later guarded delete does not build another.
    await checkDeleteGuard(ctxOf(folder, bundle, [deleteOf(ANA)], { guard }));
    expect(built).toBe(2);
  });
});
