import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { revisionOf, revisionOfEntry } from 'preview-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAppDeps } from '../../test/helpers/app-deps.ts';
import {
  bundleFolder,
  FIXTURE_BUNDLE,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import {
  removeWorkingCopies,
  sampleWorkingCopy,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import { GitError } from '../git/exec.ts';
import type { Repo } from '../git/ops.ts';
import { createApp } from './app.ts';

// The working copy the route tests read from: a copy of the bundle fixture's source files, made before each test.
let sample = '';
beforeEach(async () => {
  sample = await sampleWorkingCopy();
});
afterEach(async () => {
  await removeBundleFolders();
  await removeWorkingCopies();
});

/** The app over one bundle folder and one working copy (the fixture source copy by default). */
const appOver = (dir: string, root: string = sample) =>
  createApp({
    ...fakeAppDeps(),
    bundle: directoryBundleSource(dir),
    workingCopy: root,
  });

/** A bundle document record. Its manifest revision is a placeholder: the routes never copy it. */
const record = (fields: Record<string, unknown>) => ({
  buildTime: false,
  revision: '0123456789abcdef',
  ...fields,
});

/** A bundle folder whose documents.json holds `records`. */
const bundleWith = (records: Record<string, unknown>[]) =>
  bundleFolder({ 'documents.json': JSON.stringify(records) });

/** The fixture's documents as [key, revision] pairs, in the file's order. */
async function fixtureRevisions(): Promise<[string, string][]> {
  const text = await readFile(join(FIXTURE_BUNDLE, 'documents.json'), 'utf8');
  const records = JSON.parse(text) as { key: string; revision: string }[];
  return records.map(({ key, revision }) => [key, revision]);
}

describe('the bundle routes in createApp', () => {
  it('registers the bundle routes only when the bundle dep is given', async () => {
    expect((await createApp(fakeAppDeps()).request('/api/status')).status).toBe(
      404,
    );
    expect((await appOver(FIXTURE_BUNDLE).request('/api/status')).status).toBe(
      200,
    );
  });
});

describe('GET /api/status', () => {
  it('names the bundle id and its commit', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request('/api/status');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      bundle: {
        bundleId: 'fixture-2026-11-03',
        siteCommit: '4523c67c55284f8bd3ae1b61caa6d5501ccc77ab',
      },
    });
  });

  it('answers 200 with a null bundle when the folder has no bundle.json', async () => {
    const dir = await bundleFolder({ 'bundle.json': null });
    const response = await appOver(dir).request('/api/status');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bundle: null });
  });
});

describe('GET /api/schema', () => {
  it('lists the collections of schema.json, in the file order', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request('/api/schema');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      collections: Array<{ name: string; loader?: unknown; schema?: unknown }>;
    };
    expect(body.collections.map((entry) => entry.name)).toEqual([
      'fixtures',
      'homepage',
      'authors',
      'testimonials',
      'partners',
      'stats',
      'landing',
      'blog',
      'pages',
      'contact',
      'pricing',
      'faq',
    ]);
    expect(body.collections[3]).toMatchObject({
      name: 'testimonials',
      loader: { kind: 'file' },
    });
    expect(body.collections[3]?.schema).toBeDefined();
  });

  it('carries a collection error as it is in schema.json', async () => {
    const dir = await bundleFolder({
      'schema.json': '{"notes":{"error":"Zod cannot export this schema"}}',
    });
    const response = await appOver(dir).request('/api/schema');
    expect(await response.json()).toEqual({
      collections: [{ name: 'notes', error: 'Zod cannot export this schema' }],
    });
  });
});

describe('GET /api/documents?collection=', () => {
  it('lists the documents of a collection with their revisions', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request(
      '/api/documents?collection=blog',
    );
    expect(await response.json()).toEqual({
      documents: [
        {
          key: 'blog/-index',
          file: 'src/content/blog/-index.md',
          revision: 'f951b0d3d5a329e9',
          format: 'md',
          editable: true,
          buildTime: false,
          title: 'Latest news',
        },
        {
          key: 'blog/blog-1',
          file: 'src/content/blog/blog-1.md',
          revision: 'f0a7b71033203392',
          format: 'md',
          editable: true,
          buildTime: false,
          title: 'What you need to know about Photography',
        },
        {
          key: 'blog/blog-2',
          file: 'src/content/blog/blog-2.md',
          revision: '7aea0085ca521e1e',
          format: 'md',
          editable: true,
          buildTime: false,
          title: 'How to make toys from old Olarpaper',
        },
        {
          key: 'blog/blog-3',
          file: 'src/content/blog/blog-3.md',
          revision: 'df5d163626342f30',
          format: 'md',
          editable: true,
          buildTime: false,
          title: 'What you need to know about Photography',
        },
        {
          key: 'blog/blog-4',
          file: 'src/content/blog/blog-4.md',
          revision: '841030777fedd3d2',
          format: 'md',
          editable: true,
          buildTime: false,
          title: 'How to make toys from old Olarpaper',
        },
        {
          key: 'blog/blog-5',
          file: 'src/content/blog/blog-5.md',
          revision: '72ba33c895eafa59',
          format: 'md',
          editable: true,
          buildTime: false,
          title: 'Adversus is a web-based dialer and practical CRM solution',
        },
      ],
    });
  });

  it('answers editable false for a document that is not editable', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request(
      '/api/documents?collection=fixtures',
    );
    expect(await response.json()).toEqual({
      documents: [
        {
          key: 'fixtures/define-vars',
          file: 'src/content/fixtures/define-vars.json',
          revision: '9ef732885ca3cc6a',
          format: 'json',
          editable: false,
          buildTime: false,
        },
      ],
    });
  });

  it('leaves out the entry key of a file() entry, and keeps its own file', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request(
      '/api/documents?collection=stats',
    );
    expect(await response.json()).toEqual({
      documents: [
        {
          key: 'stats/editors',
          file: 'src/content/stats.yaml',
          revision: 'b877e991d4201f6c',
          format: 'yaml',
          editable: true,
          buildTime: false,
        },
        {
          key: 'stats/sites',
          file: 'src/content/stats.yaml',
          revision: 'f60a1c3cab76660a',
          format: 'yaml',
          editable: true,
          buildTime: false,
        },
        {
          key: 'stats/uptime',
          file: 'src/content/stats.yaml',
          revision: '26f950f0c2fd32c5',
          format: 'yaml',
          editable: true,
          buildTime: false,
        },
      ],
    });
  });

  it('shows the build-time flags, and a document with no file', async () => {
    const dir = await bundleFolder({
      'documents.json': JSON.stringify([
        {
          key: 'blog/a',
          format: 'md',
          buildTime: true,
          buildTimeFields: ['*'],
          revision: '0123456789abcdef',
        },
        {
          key: 'blog/b',
          format: 'other',
          buildTime: false,
          editable: false,
          revision: 'fedcba9876543210',
        },
      ]),
    });
    const response = await appOver(dir).request(
      '/api/documents?collection=blog',
    );
    expect(await response.json()).toEqual({
      documents: [
        {
          key: 'blog/a',
          revision: null,
          format: 'md',
          editable: true,
          buildTime: true,
          buildTimeFields: ['*'],
          error: true,
        },
        {
          key: 'blog/b',
          revision: null,
          format: 'other',
          editable: false,
          buildTime: false,
          error: true,
        },
      ],
    });
  });

  it('answers an empty list for a collection with no documents in documents.json', async () => {
    const dir = await bundleWith([]);
    const response = await appOver(dir).request(
      '/api/documents?collection=pricing',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ documents: [] });
  });

  it('finds a collection named __proto__ as an ordinary key', async () => {
    const dir = await bundleFolder({
      'schema.json': '{"__proto__":{}}',
      'documents.json':
        '[{"key":"__proto__/a","format":"md","buildTime":false,"revision":"0123456789abcdef"}]',
    });
    const response = await appOver(dir).request(
      '/api/documents?collection=__proto__',
    );
    expect(await response.json()).toEqual({
      documents: [
        {
          key: '__proto__/a',
          revision: null,
          format: 'md',
          editable: true,
          buildTime: false,
          error: true,
        },
      ],
    });
  });

  it('leaves out a document whose key has no slash, even under a collection of that name', async () => {
    const dir = await bundleFolder({
      'schema.json': '{"loose":{}}',
      'documents.json':
        '[{"key":"loose","format":"md","buildTime":false,"revision":"0123456789abcdef"}]',
    });
    const response = await appOver(dir).request(
      '/api/documents?collection=loose',
    );
    expect(await response.json()).toEqual({ documents: [] });
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'answers 404 for "%s" when schema.json has no such collection',
    async (collection) => {
      const response = await appOver(FIXTURE_BUNDLE).request(
        `/api/documents?collection=${collection}`,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: 'unknown-collection',
        message: `The bundle has no collection "${collection}".`,
      });
    },
  );
});

describe('GET /api/documents query rules', () => {
  it('answers 400 when neither collection nor key is given', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request('/api/documents');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'missing-query',
      message: 'Give a collection or a key.',
    });
  });

  it('lets key win over collection', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request(
      '/api/documents?collection=blog&key=fixtures/define-vars',
    );
    expect(response.status).toBe(200);
    expect((await response.json()).key).toBe('fixtures/define-vars');
  });
});

describe('GET /api/documents?key=', () => {
  it('answers an editable JSON document with its value, revision and build-time flags', async () => {
    const text = '{"color":"teal"}';
    const dir = await bundleWith([
      record({
        key: 'config/theme',
        file: 'src/config/theme.json',
        format: 'json',
        buildTime: true,
        buildTimeFields: ['*'],
      }),
    ]);
    const root = await tempWorkingCopy({ 'src/config/theme.json': text });
    const response = await appOver(dir, root).request(
      '/api/documents?key=config/theme',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: 'config/theme',
      file: 'src/config/theme.json',
      revision: revisionOf(text),
      format: 'json',
      editable: true,
      buildTime: true,
      buildTimeFields: ['*'],
      value: { color: 'teal' },
    });
  });

  it('answers Markdown with its data and body', async () => {
    const text = '---\ntitle: Hi\n---\nBody\n';
    const dir = await bundleWith([
      record({ key: 'blog/post', file: 'src/post.md', format: 'md' }),
    ]);
    const root = await tempWorkingCopy({ 'src/post.md': text });
    expect(
      await (
        await appOver(dir, root).request('/api/documents?key=blog/post')
      ).json(),
    ).toEqual({
      key: 'blog/post',
      file: 'src/post.md',
      revision: revisionOf(text),
      format: 'md',
      editable: true,
      buildTime: false,
      value: { data: { title: 'Hi' }, body: 'Body\n' },
    });
  });

  it('answers a file() entry with its raw entry, id included, and not its entry key', async () => {
    const text = '[{"id":"p1","name":"Rex"}]';
    const dir = await bundleWith([
      record({
        key: 'pets/p1',
        file: 'src/pets.json',
        format: 'json',
        entryKey: 'p1',
      }),
    ]);
    const root = await tempWorkingCopy({ 'src/pets.json': text });
    expect(
      await (
        await appOver(dir, root).request('/api/documents?key=pets/p1')
      ).json(),
    ).toEqual({
      key: 'pets/p1',
      file: 'src/pets.json',
      revision: revisionOfEntry({ name: 'Rex' }),
      format: 'json',
      editable: true,
      buildTime: false,
      value: { id: 'p1', name: 'Rex' },
    });
  });

  it('answers a read-only document with its flags and no value', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request(
      '/api/documents?key=fixtures/define-vars',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: 'fixtures/define-vars',
      file: 'src/content/fixtures/define-vars.json',
      revision: '9ef732885ca3cc6a',
      format: 'json',
      editable: false,
      buildTime: false,
    });
  });

  it('finds a document that a save created, and answers 404 for a key that nothing made', async () => {
    const text = '{"name":"New"}';
    const root = await tempWorkingCopy({
      'src/content/authors/new-one.json': text,
    });
    const repo: Repo = {
      changedPaths: async () => [
        { path: 'src/content/authors/new-one.json', status: 'created' },
      ],
      mergeBase: async () => 'base',
      showAtBytes: async () => null,
      overwrittenSince: async () => new Map(),
      locked: () => Promise.reject(new Error('GET takes no lock')),
      showAt: () => Promise.reject(new Error('GET reads no text')),
    };
    const app = createApp({
      ...fakeAppDeps(),
      bundle: directoryBundleSource(FIXTURE_BUNDLE),
      workingCopy: root,
      repo,
    });
    const created = await app.request('/api/documents?key=authors/new-one');
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({
      key: 'authors/new-one',
      file: 'src/content/authors/new-one.json',
      revision: revisionOf(text),
      format: 'json',
      editable: true,
      buildTime: false,
      value: { name: 'New' },
    });
    const missing = await app.request('/api/documents?key=authors/nobody');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: 'unknown-document',
      message: 'The bundle has no document "authors/nobody".',
    });
  });

  it('answers 500 changes-unavailable, not 404, when the changes of an unknown key cannot be read', async () => {
    const root = await tempWorkingCopy({});
    const repo: Repo = {
      changedPaths: () =>
        Promise.reject(
          new GitError('failed', 'git diff --name-status failed (exit 128)'),
        ),
      mergeBase: async () => 'base',
      showAtBytes: async () => null,
      overwrittenSince: async () => new Map(),
      locked: () => Promise.reject(new Error('GET takes no lock')),
      showAt: () => Promise.reject(new Error('GET reads no text')),
    };
    const app = createApp({
      ...fakeAppDeps(),
      bundle: directoryBundleSource(FIXTURE_BUNDLE),
      workingCopy: root,
      repo,
    });
    const response = await app.request('/api/documents?key=authors/nobody');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'changes-unavailable',
      message: 'git diff --name-status failed (exit 128)',
    });
  });

  it('answers 500 as an unhandled error, not changes-unavailable and not 404, when the changes of an unknown key fail for another reason', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const root = await tempWorkingCopy({});
      const repo: Repo = {
        changedPaths: () => Promise.reject(new Error('boom')),
        mergeBase: async () => 'base',
        showAtBytes: async () => null,
        overwrittenSince: async () => new Map(),
        locked: () => Promise.reject(new Error('GET takes no lock')),
        showAt: () => Promise.reject(new Error('GET reads no text')),
      };
      const app = createApp({
        ...fakeAppDeps(),
        bundle: directoryBundleSource(FIXTURE_BUNDLE),
        workingCopy: root,
        repo,
      });
      const response = await app.request('/api/documents?key=authors/nobody');
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Internal Server Error');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('answers 404 unknown-document for a key the bundle does not have', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request(
      '/api/documents?key=blog/nope',
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'unknown-document',
      message: 'The bundle has no document "blog/nope".',
    });
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', ''])(
    'answers 404 unknown-document for the key "%s", which is not a document',
    async (key) => {
      const response = await appOver(FIXTURE_BUNDLE).request(
        `/api/documents?key=${encodeURIComponent(key)}`,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: 'unknown-document',
        message: `The bundle has no document "${key}".`,
      });
    },
  );

  it('takes a key with slashes whole', async () => {
    const text = '---\ntitle: Deep\n---\n';
    const dir = await bundleWith([
      record({ key: 'blog/nested/post-1', file: 'src/post.md', format: 'md' }),
    ]);
    const root = await tempWorkingCopy({ 'src/post.md': text });
    const body = await (
      await appOver(dir, root).request(
        `/api/documents?key=${encodeURIComponent('blog/nested/post-1')}`,
      )
    ).json();
    expect(body).toEqual({
      key: 'blog/nested/post-1',
      file: 'src/post.md',
      revision: revisionOf(text),
      format: 'md',
      editable: true,
      buildTime: false,
      value: { data: { title: 'Deep' }, body: '' },
    });
  });

  it('answers 404 document-missing when the file of the document is gone', async () => {
    const root = await sampleWorkingCopy({
      'src/content/blog/blog-1.md': null,
    });
    const response = await appOver(FIXTURE_BUNDLE, root).request(
      '/api/documents?key=blog/blog-1',
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'document-missing',
      message: 'Document "blog/blog-1" is missing from the working copy.',
    });
  });

  it('answers 404 document-missing when the entry is not in its shared file', async () => {
    const dir = await bundleWith([
      record({
        key: 'pets/p9',
        file: 'src/pets.json',
        format: 'json',
        entryKey: 'p9',
      }),
    ]);
    const root = await tempWorkingCopy({ 'src/pets.json': '[{"id":"p1"}]' });
    const response = await appOver(dir, root).request(
      '/api/documents?key=pets/p9',
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'document-missing',
      message: 'Document "pets/p9" is missing from the working copy.',
    });
  });

  it('answers 200 with editable false, the error and no value when a Markdown file has TOML frontmatter', async () => {
    const text = '+++\ntitle = "x"\n+++\nBody\n';
    const root = await sampleWorkingCopy({
      'src/content/blog/blog-1.md': text,
    });
    const response = await appOver(FIXTURE_BUNDLE, root).request(
      '/api/documents?key=blog/blog-1',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: 'blog/blog-1',
      file: 'src/content/blog/blog-1.md',
      revision: revisionOf(text),
      format: 'md',
      editable: false,
      buildTime: false,
      error: {
        code: 'parse-error',
        message:
          'TOML frontmatter (+++) is not supported: the document is read-only',
      },
    });
  });

  it('gives the position of a JSON error, and keeps the revision of the bytes', async () => {
    const text = '{\n  "a": 1,,\n}';
    const root = await sampleWorkingCopy({ 'src/config/theme.json': text });
    const response = await appOver(FIXTURE_BUNDLE, root).request(
      `/api/documents?key=${encodeURIComponent('data:src/config/theme.json')}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: 'data:src/config/theme.json',
      file: 'src/config/theme.json',
      revision: revisionOf(text),
      format: 'json',
      editable: false,
      buildTime: true,
      buildTimeFields: ['*'],
      error: {
        code: 'parse-error',
        message: 'Invalid JSON at line 2, column 10: PropertyNameExpected',
        line: 2,
        column: 10,
      },
    });
  });

  it('answers a file() entry of a shared file that does not parse with a null revision and the error', async () => {
    const root = await sampleWorkingCopy({
      'src/content/testimonials.json': '[',
    });
    const response = await appOver(FIXTURE_BUNDLE, root).request(
      '/api/documents?key=testimonials/t-ana',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: 'testimonials/t-ana',
      file: 'src/content/testimonials.json',
      revision: null,
      format: 'json',
      editable: false,
      buildTime: false,
      error: {
        code: 'parse-error',
        message: 'Invalid JSON at line 1, column 2: CloseBracketExpected',
        line: 1,
        column: 2,
      },
    });
  });

  it('answers the revision the fixture has for every document, with the fixture source files as the working copy', async () => {
    const expected = await fixtureRevisions();
    const app = appOver(FIXTURE_BUNDLE);
    const answers = await Promise.all(
      expected.map(async ([key]) => {
        const response = await app.request(
          `/api/documents?key=${encodeURIComponent(key)}`,
        );
        const body = (await response.json()) as { revision: string | null };
        return [key, body.revision];
      }),
    );
    expect(answers).toEqual(expected);
  });

  it('gives the same revisions in a collection list as the key route does', async () => {
    const expected = await fixtureRevisions();
    for (const collection of [
      'authors',
      'blog',
      'fixtures',
      'stats',
      'testimonials',
    ]) {
      const response = await appOver(FIXTURE_BUNDLE).request(
        `/api/documents?collection=${collection}`,
      );
      const body = (await response.json()) as {
        documents: { key: string; revision: string | null }[];
      };
      expect(
        body.documents.map(({ key, revision }) => [key, revision]),
      ).toEqual(expected.filter(([key]) => key.startsWith(`${collection}/`)));
    }
  });
});

describe('GET /api/documents?collection= reads the working copy', () => {
  it('takes the title from title or name, only from a string, and gives none to a read-only document', async () => {
    const files = {
      'src/a.md': '---\ntitle: Alpha\n---\nx\n',
      'src/b.json': '{"title":5,"name":"Beta"}',
      'src/c.json': '{"title":"Gamma"}',
    };
    const dir = await bundleWith([
      record({ key: 'pages/a', file: 'src/a.md', format: 'md' }),
      record({ key: 'pages/b', file: 'src/b.json', format: 'json' }),
      record({
        key: 'pages/c',
        file: 'src/c.json',
        format: 'json',
        editable: false,
      }),
    ]);
    const root = await tempWorkingCopy(files);
    const response = await appOver(dir, root).request(
      '/api/documents?collection=pages',
    );
    const [a, b, c] = [
      files['src/a.md'],
      files['src/b.json'],
      files['src/c.json'],
    ];
    expect(await response.json()).toEqual({
      documents: [
        {
          key: 'pages/a',
          file: 'src/a.md',
          revision: revisionOf(a),
          format: 'md',
          editable: true,
          buildTime: false,
          title: 'Alpha',
        },
        {
          key: 'pages/b',
          file: 'src/b.json',
          revision: revisionOf(b),
          format: 'json',
          editable: true,
          buildTime: false,
          title: 'Beta',
        },
        {
          key: 'pages/c',
          file: 'src/c.json',
          revision: revisionOf(c),
          format: 'json',
          editable: false,
          buildTime: false,
        },
      ],
    });
  });

  it('takes an MDX title from its data, and gives no title to a name that is not a string or to a null value', async () => {
    const files = {
      'src/d.mdx': '---\ntitle: Delta\n---\nx\n',
      'src/e.json': '{"name":5}',
      'src/f.json': 'null',
    };
    const dir = await bundleWith([
      record({ key: 'pages/d', file: 'src/d.mdx', format: 'mdx' }),
      record({ key: 'pages/e', file: 'src/e.json', format: 'json' }),
      record({ key: 'pages/f', file: 'src/f.json', format: 'json' }),
    ]);
    const root = await tempWorkingCopy(files);
    const response = await appOver(dir, root).request(
      '/api/documents?collection=pages',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      documents: [
        {
          key: 'pages/d',
          file: 'src/d.mdx',
          revision: revisionOf(files['src/d.mdx']),
          format: 'mdx',
          editable: true,
          buildTime: false,
          title: 'Delta',
        },
        {
          key: 'pages/e',
          file: 'src/e.json',
          revision: revisionOf(files['src/e.json']),
          format: 'json',
          editable: true,
          buildTime: false,
        },
        {
          key: 'pages/f',
          file: 'src/f.json',
          revision: revisionOf(files['src/f.json']),
          format: 'json',
          editable: true,
          buildTime: false,
        },
      ],
    });
  });

  it('lists a document whose file does not parse with no title and the error flag, and the other documents as they are', async () => {
    const text = '+++\ntitle = "x"\n+++\nBody\n';
    const root = await sampleWorkingCopy({
      'src/content/blog/blog-1.md': text,
    });
    const dir = await bundleWith([
      record({
        key: 'blog/blog-1',
        file: 'src/content/blog/blog-1.md',
        format: 'md',
      }),
    ]);
    const response = await appOver(dir, root).request(
      '/api/documents?collection=blog',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      documents: [
        {
          key: 'blog/blog-1',
          file: 'src/content/blog/blog-1.md',
          revision: revisionOf(text),
          format: 'md',
          editable: true,
          buildTime: false,
          error: true,
        },
      ],
    });
  });

  it('lists the entries of a broken shared file with a null revision and the error flag', async () => {
    const root = await sampleWorkingCopy({
      'src/content/testimonials.json': '[',
    });
    const dir = await bundleWith([
      record({
        key: 'testimonials/t-ana',
        file: 'src/content/testimonials.json',
        format: 'json',
        entryKey: 't-ana',
      }),
    ]);
    const response = await appOver(dir, root).request(
      '/api/documents?collection=testimonials',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      documents: [
        {
          key: 'testimonials/t-ana',
          file: 'src/content/testimonials.json',
          revision: null,
          format: 'json',
          editable: true,
          buildTime: false,
          error: true,
        },
      ],
    });
  });

  it('lists a missing file and a missing entry with a null revision and the error flag', async () => {
    const dir = await bundleWith([
      record({ key: 'pages/gone', file: 'src/gone.json', format: 'json' }),
      record({
        key: 'pages/nope',
        file: 'src/shared.json',
        format: 'json',
        entryKey: 'nope',
      }),
    ]);
    const root = await tempWorkingCopy({
      'src/shared.json': '[{"id":"here","name":"X"}]',
    });
    const response = await appOver(dir, root).request(
      '/api/documents?collection=pages',
    );
    expect(await response.json()).toEqual({
      documents: [
        {
          key: 'pages/gone',
          file: 'src/gone.json',
          revision: null,
          format: 'json',
          editable: true,
          buildTime: false,
          error: true,
        },
        {
          key: 'pages/nope',
          file: 'src/shared.json',
          revision: null,
          format: 'json',
          editable: true,
          buildTime: false,
          error: true,
        },
      ],
    });
  });
});

describe('errors of the bundle routes', () => {
  it('lets an error that is not a BundleError reach the default 500, not bundle-invalid', async () => {
    const app = createApp({
      ...fakeAppDeps(),
      bundle: {
        current: async () => {
          throw new Error('disk on fire');
        },
      },
      workingCopy: sample,
    });
    const response = await app.request('/api/schema');
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
  });

  it.each([
    ['/api/schema'],
    ['/api/documents?collection=blog'],
    ['/api/documents?key=blog/blog-1'],
  ])('answers 503 no-bundle for %s with no bundle.json', async (path) => {
    const dir = await bundleFolder({ 'bundle.json': null });
    const response = await appOver(dir).request(path);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'no-bundle' });
  });

  it.each([
    ['/api/schema'],
    ['/api/documents?collection=blog'],
    ['/api/documents?key=blog/blog-1'],
    ['/api/status'],
  ])(
    'answers 500 bundle-invalid for %s when a file is corrupt',
    async (path) => {
      const dir = await bundleFolder({ 'documents.json': '[' });
      const response = await appOver(dir).request(path);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'bundle-invalid',
        message: 'documents.json: is not valid JSON',
      });
    },
  );
});
