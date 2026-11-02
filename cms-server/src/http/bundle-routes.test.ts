import { afterEach, describe, expect, it } from 'vitest';
import { fakeAppDeps } from '../../test/helpers/app-deps.ts';
import {
  bundleFolder,
  FIXTURE_BUNDLE,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import { createApp } from './app.ts';

afterEach(() => removeBundleFolders());

/** The app over one bundle folder. */
const appOver = (dir: string) =>
  createApp({ ...fakeAppDeps(), bundle: directoryBundleSource(dir) });

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
        bundleId: 'fixture-2026-11-01',
        siteCommit: 'bec46fcadfe832d7bdec8b06eee6ba6546bd2596',
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
          key: 'blog/blog-1',
          file: 'src/content/blog/blog-1.md',
          revision: 'f0a7b71033203392',
          format: 'md',
          editable: true,
          buildTime: false,
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
          revision: '05a0f951dd049418',
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
          revision: '0123456789abcdef',
          format: 'md',
          editable: true,
          buildTime: true,
          buildTimeFields: ['*'],
        },
        {
          key: 'blog/b',
          revision: 'fedcba9876543210',
          format: 'other',
          editable: false,
          buildTime: false,
        },
      ],
    });
  });

  it('answers an empty list for a collection with no documents in documents.json', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request(
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
          revision: '0123456789abcdef',
          format: 'md',
          editable: true,
          buildTime: false,
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

  it('answers 501 for key until 2.4b', async () => {
    const response = await appOver(FIXTURE_BUNDLE).request(
      '/api/documents?key=blog/blog-1',
    );
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: 'not-implemented',
      message: 'Reading one document by key is not built yet.',
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
    });
    const response = await app.request('/api/schema');
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
  });

  it.each(['/api/schema', '/api/documents?collection=blog'])(
    'answers 503 no-bundle for %s with no bundle.json',
    async (path) => {
      const dir = await bundleFolder({ 'bundle.json': null });
      const response = await appOver(dir).request(path);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'no-bundle' });
    },
  );

  it.each([
    ['/api/schema'],
    ['/api/documents?collection=blog'],
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
