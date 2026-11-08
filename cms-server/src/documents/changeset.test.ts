import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type CollectionSchemaJson,
  revisionOf,
  revisionOfEntry,
} from 'preview-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloneRemote,
  commitAndPush,
  git,
  makeTestRoot,
  removeTestRoot,
} from '../../test/helpers/git.ts';
import type { Bundle, DocumentEntry } from '../bundle/read.ts';
import { parseConfig } from '../config/schema.ts';
import { openRepo, type Repo } from '../git/ops.ts';
import { ensureRepo } from '../git/repo.ts';
import type { Logger } from '../log.ts';
import { changesetOf, changesetWithTombstones } from './changeset.ts';

// Each test makes its own remote and clone, so one test takes a few git calls.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// Site-relative paths. The site sits in `site/` of the remote, the `siteDir` of the config.
const BLOG_A = 'src/content/blog/post-a.md';
const BLOG_B = 'src/content/blog/post-b.md';
const PEOPLE = 'src/content/people.json';
const NOTES = 'src/content/notes/main.toml';
const POST_A = '---\ntitle: Post A\n---\nBody A\n';
const POST_B = '---\ntitle: Post B\n---\nBody B\n';
const PEOPLE_TEXT =
  '[\n  { "id": "ana", "name": "Ana" },\n  { "id": "kofi", "name": "Kofi" }\n]\n';
const NOTES_TEXT = 'title = "Notes"\n';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTestRoot(root)));
});

function silentLog(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// The bundle of the test site: two posts, two entries of people.json, and one TOML document.
function bundleOf(): Pick<Bundle, 'documents' | 'collections'> {
  const records: DocumentEntry[] = [
    {
      key: 'blog/post-a',
      file: BLOG_A,
      format: 'md',
      buildTime: false,
      revision: 'r',
    },
    {
      key: 'blog/post-b',
      file: BLOG_B,
      format: 'md',
      buildTime: false,
      revision: 'r',
    },
    {
      key: 'people/ana',
      file: PEOPLE,
      format: 'json',
      entryKey: 'ana',
      buildTime: false,
      revision: 'r',
    },
    {
      key: 'people/kofi',
      file: PEOPLE,
      format: 'json',
      entryKey: 'kofi',
      buildTime: false,
      revision: 'r',
    },
    {
      key: 'notes/main',
      file: NOTES,
      format: 'toml',
      editable: false,
      buildTime: false,
      revision: 'r',
    },
  ];
  const collections = new Map<string, CollectionSchemaJson>([
    [
      'blog',
      {
        loader: { kind: 'glob', pattern: '**/*.md', base: 'src/content/blog' },
      },
    ],
    ['people', { loader: { kind: 'file', pattern: PEOPLE } }],
    [
      'notes',
      {
        loader: {
          kind: 'glob',
          pattern: '**/*.toml',
          base: 'src/content/notes',
        },
      },
    ],
  ]);
  return {
    documents: new Map(records.map((record) => [record.key, record])),
    collections,
  };
}

interface Harness {
  readonly root: string;
  readonly remote: string;
  readonly repo: Repo;
  readonly repoDir: string;
  readonly siteFolder: string;
}

// A remote with the test site on `main`, cloned by ensureRepo. Its operations are the real ones. `extraFiles` replaces
// files of the seed commit, so a test can start from a file that does not parse.
async function harness(
  extraFiles: Record<string, string> = {},
): Promise<Harness> {
  const root = await makeTestRoot();
  roots.push(root);
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  await git(root, ['init', '--bare', remote]);
  await mkdir(seed);
  await git(seed, ['init']);
  const files: Record<string, string> = {
    [BLOG_A]: POST_A,
    [BLOG_B]: POST_B,
    [PEOPLE]: PEOPLE_TEXT,
    [NOTES]: NOTES_TEXT,
    ...extraFiles,
  };
  for (const [path, text] of Object.entries(files)) {
    const target = join(seed, 'site', path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  await git(seed, ['add', '--all']);
  await git(seed, ['commit', '--message', 'seed']);
  await git(seed, ['remote', 'add', 'origin', remote]);
  await git(seed, ['push', 'origin', 'HEAD:main']);
  const config = parseConfig({
    site: 'demo',
    remote,
    siteDir: 'site',
    previewSiteConfig: 'preview.config.json',
    origins: {
      cms: 'https://cms.example.test',
      preview: 'https://preview.example.test',
    },
  });
  const cmsDir = join(root, '.cms');
  const state = await ensureRepo({ config, cmsDir, log: silentLog() });
  return {
    root,
    remote,
    repo: openRepo({ config, cmsDir, state }),
    repoDir: state.repoDir,
    siteFolder: state.siteFolder,
  };
}

// Overwrites a file of the working copy.
async function edit(h: Harness, path: string, text: string): Promise<void> {
  const target = join(h.siteFolder, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
}

// Commits the given site paths on cms/work, as a save does.
function save(h: Harness, paths: string[], message: string): Promise<unknown> {
  return h.repo.locked('save', (tx) => tx.commitSave(paths, message));
}

function changes(h: Harness) {
  return changesetOf({
    bundle: bundleOf(),
    repo: h.repo,
    siteFolder: h.siteFolder,
  });
}

// The changes of a bundle that holds no document, so each changed file is read by its collection's loader.
function changesUnbundled(h: Harness) {
  return changesetOf({
    bundle: {
      documents: new Map<string, DocumentEntry>(),
      collections: bundleOf().collections,
    },
    repo: h.repo,
    siteFolder: h.siteFolder,
  });
}

describe('changesetOf: documents with a file of their own', () => {
  it('reports an edited document with its revision at the merge base and its saved value', async () => {
    const h = await harness();
    await edit(h, BLOG_A, '---\ntitle: Post A\n---\nBody A edited\n');
    await save(h, [BLOG_A], 'edit a');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/post-a',
          status: 'modified',
          baseRevision: revisionOf(POST_A),
          value: { data: { title: 'Post A' }, body: 'Body A edited\n' },
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('keeps the base revision of a document saved twice', async () => {
    const h = await harness();
    await edit(h, BLOG_A, '---\ntitle: Post A\n---\nFirst\n');
    await save(h, [BLOG_A], 'first');
    await edit(h, BLOG_A, '---\ntitle: Post A\n---\nSecond\n');
    await save(h, [BLOG_A], 'second');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/post-a',
          status: 'modified',
          baseRevision: revisionOf(POST_A),
          value: { data: { title: 'Post A' }, body: 'Second\n' },
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('reports a deleted document with its base revision and no value', async () => {
    const h = await harness();
    await rm(join(h.siteFolder, BLOG_B));
    await save(h, [BLOG_B], 'delete b');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/post-b',
          status: 'deleted',
          baseRevision: revisionOf(POST_B),
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('reports a deleted file the bundle does not hold, with no created record', async () => {
    const h = await harness();
    await rm(join(h.siteFolder, BLOG_B));
    await save(h, [BLOG_B], 'delete b');
    expect(await changesUnbundled(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/post-b',
          status: 'deleted',
          baseRevision: revisionOf(POST_B),
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('gives a deleted file the bundle lacks a tombstone, and a deleted file the bundle holds none (2.10h)', async () => {
    const h = await harness();
    await rm(join(h.siteFolder, BLOG_B));
    await save(h, [BLOG_B], 'delete b');
    const unbundled = await changesetWithTombstones({
      bundle: {
        documents: new Map<string, DocumentEntry>(),
        collections: bundleOf().collections,
      },
      repo: h.repo,
      siteFolder: h.siteFolder,
    });
    expect(unbundled).toStrictEqual({
      changeset: {
        documents: [
          {
            key: 'blog/post-b',
            status: 'deleted',
            baseRevision: revisionOf(POST_B),
          },
        ],
        createdRecords: [],
        fileErrors: [],
      },
      tombstones: [
        {
          key: 'blog/post-b',
          file: BLOG_B,
          format: 'md',
          buildTime: false,
          revision: revisionOf(POST_B),
        },
      ],
    });
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/post-b',
          status: 'deleted',
          baseRevision: revisionOf(POST_B),
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('reports a modified file the bundle does not hold, with a record of its saved bytes', async () => {
    const h = await harness();
    const edited = '---\ntitle: Post A\n---\nBody A edited\n';
    await edit(h, BLOG_A, edited);
    await save(h, [BLOG_A], 'edit a');
    expect(await changesUnbundled(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/post-a',
          status: 'modified',
          baseRevision: revisionOf(POST_A),
          value: { data: { title: 'Post A' }, body: 'Body A edited\n' },
        },
      ],
      createdRecords: [
        {
          key: 'blog/post-a',
          file: BLOG_A,
          format: 'md',
          buildTime: false,
          revision: revisionOf(edited),
        },
      ],
      fileErrors: [],
    });
  });

  it('gives no record to a document the bundle holds, even when the CMS edited it', async () => {
    const h = await harness();
    await edit(h, BLOG_A, '---\ntitle: Post A\n---\nBody A edited\n');
    await save(h, [BLOG_A], 'edit a');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/post-a',
          status: 'modified',
          baseRevision: revisionOf(POST_A),
          value: { data: { title: 'Post A' }, body: 'Body A edited\n' },
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('drops the record of a created document once the bundle holds its key, and keeps the document', async () => {
    const h = await harness();
    const postC = '---\ntitle: Post C\n---\nBody C\n';
    const postCPath = 'src/content/blog/post-c.md';
    await edit(h, postCPath, postC);
    await save(h, [postCPath], 'create c');
    const record: DocumentEntry = {
      key: 'blog/post-c',
      file: postCPath,
      format: 'md',
      buildTime: false,
      revision: revisionOf(postC),
    };
    const base = bundleOf();
    expect(await changesUnbundled(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/post-c',
          status: 'created',
          baseRevision: null,
          value: { data: { title: 'Post C' }, body: 'Body C\n' },
        },
      ],
      createdRecords: [record],
      fileErrors: [],
    });
    expect(
      await changesetOf({
        bundle: {
          documents: new Map<string, DocumentEntry>([
            ...base.documents,
            [record.key, record],
          ]),
          collections: base.collections,
        },
        repo: h.repo,
        siteFolder: h.siteFolder,
      }),
    ).toStrictEqual({
      documents: [
        {
          key: 'blog/post-c',
          status: 'created',
          baseRevision: null,
          value: { data: { title: 'Post C' }, body: 'Body C\n' },
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('gives no record to a new file whose key the bundle holds under another file', async () => {
    const h = await harness();
    const postC = '---\ntitle: Post C\n---\nBody C\n';
    const postCPath = 'src/content/blog/post-c.md';
    await edit(h, postCPath, postC);
    await save(h, [postCPath], 'create c');
    const base = bundleOf();
    const held: DocumentEntry = {
      key: 'blog/post-c',
      file: 'src/content/blog/old-c.md',
      format: 'md',
      buildTime: false,
      revision: 'r',
    };
    expect(
      await changesetOf({
        bundle: {
          documents: new Map<string, DocumentEntry>([
            ...base.documents,
            [held.key, held],
          ]),
          collections: base.collections,
        },
        repo: h.repo,
        siteFolder: h.siteFolder,
      }),
    ).toStrictEqual({
      documents: [
        {
          key: 'blog/post-c',
          status: 'created',
          baseRevision: null,
          value: { data: { title: 'Post C' }, body: 'Body C\n' },
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('reports nothing for a new file that the working copy no longer has', async () => {
    const h = await harness();
    await edit(h, 'src/content/blog/gone.md', POST_B);
    await save(h, ['src/content/blog/gone.md'], 'add gone');
    await rm(join(h.siteFolder, 'src/content/blog/gone.md'));
    expect(await changesUnbundled(h)).toStrictEqual({
      documents: [],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('reports a new file that does not parse as a document with its error, and no created record', async () => {
    const h = await harness();
    const authors = new Map<string, CollectionSchemaJson>([
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
    await edit(h, 'src/content/authors/ana.json', '{\n  "name": ');
    await save(h, ['src/content/authors/ana.json'], 'broken author');
    expect(
      await changesetOf({
        bundle: {
          documents: new Map<string, DocumentEntry>(),
          collections: authors,
        },
        repo: h.repo,
        siteFolder: h.siteFolder,
      }),
    ).toStrictEqual({
      documents: [
        {
          key: 'authors/ana',
          status: 'created',
          baseRevision: null,
          error: {
            code: 'parse-error',
            message: 'Invalid JSON at line 2, column 11: ValueExpected',
            line: 2,
            column: 11,
          },
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('reports a new document under its glob id, with a record for the next save', async () => {
    const h = await harness();
    const text = '---\ntitle: My Post\n---\nHi\n';
    await edit(h, 'src/content/blog/My Post.md', text);
    await save(h, ['src/content/blog/My Post.md'], 'create');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/my-post',
          status: 'created',
          baseRevision: null,
          value: { data: { title: 'My Post' }, body: 'Hi\n' },
        },
      ],
      createdRecords: [
        {
          key: 'blog/my-post',
          file: 'src/content/blog/My Post.md',
          format: 'md',
          buildTime: false,
          revision: revisionOf(text),
        },
      ],
      fileErrors: [],
    });
  });

  it('keeps a document created by one save as created, with its latest value, when a second save edits it', async () => {
    const h = await harness();
    await edit(h, 'src/content/blog/draft.md', '---\ntitle: v1\n---\n');
    await save(h, ['src/content/blog/draft.md'], 'create');
    const latest = '---\ntitle: v2\n---\nlatest\n';
    await edit(h, 'src/content/blog/draft.md', latest);
    await save(h, ['src/content/blog/draft.md'], 'edit');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'blog/draft',
          status: 'created',
          baseRevision: null,
          value: { data: { title: 'v2' }, body: 'latest\n' },
        },
      ],
      createdRecords: [
        {
          key: 'blog/draft',
          file: 'src/content/blog/draft.md',
          format: 'md',
          buildTime: false,
          revision: revisionOf(latest),
        },
      ],
      fileErrors: [],
    });
  });

  it('keys a new document by its frontmatter slug, as the build does', async () => {
    const h = await harness();
    await edit(
      h,
      'src/content/blog/draft-title.md',
      '---\nslug: final-title\ntitle: T\n---\n',
    );
    await save(h, ['src/content/blog/draft-title.md'], 'create');
    const documents = (await changes(h)).documents;
    expect(documents.map((document) => document.key)).toEqual([
      'blog/final-title',
    ]);
  });

  it('reports a document changed by hand that cannot be edited, as an error and not a refusal', async () => {
    const h = await harness();
    await edit(h, NOTES, 'title = "Changed"\n');
    await save(h, [NOTES], 'edit toml');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'notes/main',
          status: 'modified',
          baseRevision: revisionOf(NOTES_TEXT),
          error: {
            code: 'not-editable',
            message:
              'The format "toml" is read-only in the CMS, so the document cannot be checked',
          },
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('ignores a changed file that no collection reads', async () => {
    const h = await harness();
    await edit(h, 'src/content/blog/notes.txt', 'not a post\n');
    await edit(h, 'src/other/page.md', '# other\n');
    await save(h, ['src/content/blog/notes.txt', 'src/other/page.md'], 'misc');
    expect(await changes(h)).toStrictEqual({
      documents: [],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('ignores a changed file when a collection has no loader to read it', async () => {
    const h = await harness();
    await edit(h, 'src/other/page.md', '# other\n');
    await save(h, ['src/other/page.md'], 'page');
    const collections = new Map<string, CollectionSchemaJson>([
      ['pages', {}],
      ...bundleOf().collections,
    ]);
    expect(
      await changesetOf({
        bundle: { documents: new Map<string, DocumentEntry>(), collections },
        repo: h.repo,
        siteFolder: h.siteFolder,
      }),
    ).toStrictEqual({ documents: [], createdRecords: [], fileErrors: [] });
  });

  it('ignores a new file of a collection with generateId ids, since its key is not its path', async () => {
    const h = await harness();
    await edit(h, 'src/content/blog/new-post.md', POST_B);
    await save(h, ['src/content/blog/new-post.md'], 'new post');
    const collections: Bundle['collections'] = new Map([
      [
        'blog',
        {
          loader: {
            kind: 'glob',
            pattern: '**/*.md',
            base: 'src/content/blog',
            customId: true,
          },
        },
      ],
    ]);
    expect(
      await changesetOf({
        bundle: { documents: new Map<string, DocumentEntry>(), collections },
        repo: h.repo,
        siteFolder: h.siteFolder,
      }),
    ).toStrictEqual({ documents: [], createdRecords: [], fileErrors: [] });
  });

  it('gives a document the CMS-Overwrote sha of its newest trailer', async () => {
    const h = await harness();
    await edit(h, BLOG_A, '---\ntitle: Post A\n---\nBody A edited\n');
    await save(h, [BLOG_A], 'edit a');
    await git(h.repoDir, [
      'commit',
      '--allow-empty',
      '--message',
      're-apply',
      '--trailer',
      'CMS-Overwrote: blog/post-a 0123456',
    ]);
    const documents = (await changes(h)).documents;
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      key: 'blog/post-a',
      overwritten: '0123456',
    });
  });
});

describe('changesetOf: entries of a file() file', () => {
  it('reports an edited entry and an added one, and no other entry', async () => {
    const h = await harness();
    await edit(
      h,
      PEOPLE,
      '[\n  { "id": "ana", "name": "Ana B" },\n  { "id": "kofi", "name": "Kofi" },\n  { "id": "lena", "name": "Lena" }\n]\n',
    );
    await save(h, [PEOPLE], 'people');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'people/ana',
          status: 'modified',
          baseRevision: revisionOfEntry({ name: 'Ana' }),
          value: { id: 'ana', name: 'Ana B' },
        },
        {
          key: 'people/lena',
          status: 'created',
          baseRevision: null,
          value: { id: 'lena', name: 'Lena' },
        },
      ],
      createdRecords: [
        {
          key: 'people/lena',
          file: PEOPLE,
          format: 'json',
          entryKey: 'lena',
          buildTime: false,
          revision: revisionOfEntry({ name: 'Lena' }),
        },
      ],
      fileErrors: [],
    });
  });

  it('reports a removed entry as deleted', async () => {
    const h = await harness();
    await edit(h, PEOPLE, '[\n  { "id": "ana", "name": "Ana" }\n]\n');
    await save(h, [PEOPLE], 'remove kofi');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'people/kofi',
          status: 'deleted',
          baseRevision: revisionOfEntry({ name: 'Kofi' }),
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('reports a removed entry the bundle lacks as deleted, with no created record', async () => {
    const h = await harness();
    await edit(h, PEOPLE, '[\n  { "id": "ana", "name": "Ana" }\n]\n');
    await save(h, [PEOPLE], 'remove kofi');
    expect(await changesUnbundled(h)).toStrictEqual({
      documents: [
        {
          key: 'people/kofi',
          status: 'deleted',
          baseRevision: revisionOfEntry({ name: 'Kofi' }),
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
    const { tombstones } = await changesetWithTombstones({
      bundle: {
        documents: new Map<string, DocumentEntry>(),
        collections: bundleOf().collections,
      },
      repo: h.repo,
      siteFolder: h.siteFolder,
    });
    expect(tombstones).toStrictEqual([
      {
        key: 'people/kofi',
        file: PEOPLE,
        format: 'json',
        entryKey: 'kofi',
        buildTime: false,
        revision: revisionOfEntry({ name: 'Kofi' }),
      },
    ]);
  });

  it('does not report an upstream change to another entry of the same file', async () => {
    const h = await harness();
    await edit(
      h,
      PEOPLE,
      '[\n  { "id": "ana", "name": "Ana B" },\n  { "id": "kofi", "name": "Kofi" }\n]\n',
    );
    await save(h, [PEOPLE], 'edit ana');
    const other = await cloneRemote(h.remote, join(h.root, 'other'));
    await commitAndPush(
      other,
      {
        [`site/${PEOPLE}`]:
          '[\n  { "id": "ana", "name": "Ana" },\n  { "id": "kofi", "name": "Kofi upstream" }\n]\n',
      },
      'upstream kofi',
    );
    await git(h.repoDir, ['fetch', 'origin']);
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'people/ana',
          status: 'modified',
          baseRevision: revisionOfEntry({ name: 'Ana' }),
          value: { id: 'ana', name: 'Ana B' },
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('gives each document of a file that does not parse the error, and the base revision it had', async () => {
    const h = await harness();
    await edit(h, PEOPLE, '[\n  { "id": "ana", "name": ');
    await save(h, [PEOPLE], 'broken');
    const error = {
      code: 'parse-error',
      message: 'Invalid JSON at line 2, column 26: ValueExpected',
      line: 2,
      column: 26,
    };
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'people/ana',
          status: 'modified',
          baseRevision: revisionOfEntry({ name: 'Ana' }),
          error,
        },
        {
          key: 'people/kofi',
          status: 'modified',
          baseRevision: revisionOfEntry({ name: 'Kofi' }),
          error,
        },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('reports a new file() file in a format the CMS cannot parse as a file error', async () => {
    const h = await harness();
    const settings = 'src/content/settings.toml';
    const bundle = {
      documents: new Map<string, DocumentEntry>(),
      collections: new Map<string, CollectionSchemaJson>([
        ['settings', { loader: { kind: 'file', pattern: settings } }],
      ]),
    };
    await edit(h, settings, 'title = "Site"\n');
    await save(h, [settings], 'settings');
    expect(
      await changesetOf({ bundle, repo: h.repo, siteFolder: h.siteFolder }),
    ).toStrictEqual({
      documents: [],
      createdRecords: [],
      fileErrors: [
        {
          path: settings,
          error: {
            code: 'not-editable',
            message:
              'The format "toml" is read-only in the CMS, so the document cannot be checked',
          },
        },
      ],
    });
  });

  it('gives the documents of a file that did not parse at the merge base the base error', async () => {
    const h = await harness({ [PEOPLE]: '[\n  { "id": "ana", "name": ' });
    await edit(h, PEOPLE, PEOPLE_TEXT);
    await save(h, [PEOPLE], 'repair people');
    const error = {
      code: 'parse-error',
      message: 'Invalid JSON at line 2, column 26: ValueExpected',
      line: 2,
      column: 26,
    };
    expect(await changes(h)).toStrictEqual({
      documents: [
        { key: 'people/ana', status: 'modified', baseRevision: null, error },
        { key: 'people/kofi', status: 'modified', baseRevision: null, error },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('gives a document whose entry the merge base lacks the error, with no base revision', async () => {
    const h = await harness();
    const base = bundleOf();
    const documents = new Map(base.documents);
    documents.set('people/lena', {
      key: 'people/lena',
      file: PEOPLE,
      format: 'json',
      entryKey: 'lena',
      buildTime: false,
      revision: 'r',
    });
    await edit(h, PEOPLE, '[\n  { "id": "ana", "name": ');
    await save(h, [PEOPLE], 'broken');
    const error = {
      code: 'parse-error',
      message: 'Invalid JSON at line 2, column 26: ValueExpected',
      line: 2,
      column: 26,
    };
    expect(
      await changesetOf({
        bundle: { documents, collections: base.collections },
        repo: h.repo,
        siteFolder: h.siteFolder,
      }),
    ).toStrictEqual({
      documents: [
        {
          key: 'people/ana',
          status: 'modified',
          baseRevision: revisionOfEntry({ name: 'Ana' }),
          error,
        },
        {
          key: 'people/kofi',
          status: 'modified',
          baseRevision: revisionOfEntry({ name: 'Kofi' }),
          error,
        },
        { key: 'people/lena', status: 'modified', baseRevision: null, error },
      ],
      createdRecords: [],
      fileErrors: [],
    });
  });

  it('orders the changed entries of a file() file by id', async () => {
    const h = await harness();
    await edit(
      h,
      PEOPLE,
      '[\n  { "id": "ana", "name": "Ana B" },\n  { "id": "lena", "name": "Lena" },\n  { "id": "bo", "name": "Bo" }\n]\n',
    );
    await save(h, [PEOPLE], 'people');
    expect(await changes(h)).toStrictEqual({
      documents: [
        {
          key: 'people/ana',
          status: 'modified',
          baseRevision: revisionOfEntry({ name: 'Ana' }),
          value: { id: 'ana', name: 'Ana B' },
        },
        {
          key: 'people/bo',
          status: 'created',
          baseRevision: null,
          value: { id: 'bo', name: 'Bo' },
        },
        {
          key: 'people/kofi',
          status: 'deleted',
          baseRevision: revisionOfEntry({ name: 'Kofi' }),
        },
        {
          key: 'people/lena',
          status: 'created',
          baseRevision: null,
          value: { id: 'lena', name: 'Lena' },
        },
      ],
      createdRecords: [
        {
          key: 'people/bo',
          file: PEOPLE,
          format: 'json',
          entryKey: 'bo',
          buildTime: false,
          revision: revisionOfEntry({ name: 'Bo' }),
        },
        {
          key: 'people/lena',
          file: PEOPLE,
          format: 'json',
          entryKey: 'lena',
          buildTime: false,
          revision: revisionOfEntry({ name: 'Lena' }),
        },
      ],
      fileErrors: [],
    });
  });

  it('gives a record to each changed entry the bundle lacks, whatever its status, and none to an entry it holds', async () => {
    const h = await harness();
    const base = bundleOf();
    const lena: DocumentEntry = {
      key: 'people/lena',
      file: PEOPLE,
      format: 'json',
      entryKey: 'lena',
      buildTime: false,
      revision: 'r',
    };
    await edit(
      h,
      PEOPLE,
      '[\n  { "id": "ana", "name": "Ana B" },\n  { "id": "kofi", "name": "Kofi" },\n  { "id": "lena", "name": "Lena" },\n  { "id": "bo", "name": "Bo" }\n]\n',
    );
    await save(h, [PEOPLE], 'people');
    expect(
      await changesetOf({
        bundle: {
          documents: new Map<string, DocumentEntry>([[lena.key, lena]]),
          collections: base.collections,
        },
        repo: h.repo,
        siteFolder: h.siteFolder,
      }),
    ).toStrictEqual({
      documents: [
        {
          key: 'people/ana',
          status: 'modified',
          baseRevision: revisionOfEntry({ name: 'Ana' }),
          value: { id: 'ana', name: 'Ana B' },
        },
        {
          key: 'people/bo',
          status: 'created',
          baseRevision: null,
          value: { id: 'bo', name: 'Bo' },
        },
        {
          key: 'people/lena',
          status: 'created',
          baseRevision: null,
          value: { id: 'lena', name: 'Lena' },
        },
      ],
      createdRecords: [
        {
          key: 'people/ana',
          file: PEOPLE,
          format: 'json',
          entryKey: 'ana',
          buildTime: false,
          revision: revisionOfEntry({ name: 'Ana B' }),
        },
        {
          key: 'people/bo',
          file: PEOPLE,
          format: 'json',
          entryKey: 'bo',
          buildTime: false,
          revision: revisionOfEntry({ name: 'Bo' }),
        },
      ],
      fileErrors: [],
    });
  });

  it('reports a new file() file that does not parse as a file error, since no document of the bundle can carry it', async () => {
    const h = await harness();
    const extra = 'src/content/extra.json';
    const base = bundleOf();
    const bundle = {
      documents: base.documents,
      collections: new Map<string, CollectionSchemaJson>([
        ...base.collections,
        ['extra', { loader: { kind: 'file', pattern: extra } }],
      ]),
    };
    await edit(h, extra, '[\n  { "id": "ana", "name": ');
    await save(h, [extra], 'broken new file');
    expect(
      await changesetOf({ bundle, repo: h.repo, siteFolder: h.siteFolder }),
    ).toStrictEqual({
      documents: [],
      createdRecords: [],
      fileErrors: [
        {
          path: extra,
          error: {
            code: 'parse-error',
            message: 'Invalid JSON at line 2, column 26: ValueExpected',
            line: 2,
            column: 26,
          },
        },
      ],
    });
  });
});
