import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { revisionOf } from 'preview-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, fakeAppDeps } from '../../test/helpers/app-deps.ts';
import {
  bundleFolder,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import { git, makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { saveRepoIn } from '../../test/helpers/repo.ts';
import { previewSays } from '../../test/helpers/save-context.ts';
import { type BundleSource, directoryBundleSource } from '../bundle/source.ts';
import type { Repo } from '../git/ops.ts';
import { createApp } from './app.ts';

// A bundle source with no bundle: a registered bundle route answers 503 `no-bundle`, an unregistered one 404 `not_found`.
const noBundle: BundleSource = { current: async () => null };
const repo = {} as Repo;
const WORKING_COPY = 'unused-working-copy';

describe('createApp', () => {
  it('serves the editor page, its stylesheet and its script', async () => {
    const app = createTestApp(fakeAppDeps());
    const page = await app.request('/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Test editor</title>');
    expect((await app.request('/editor.css')).status).toBe(200);
    expect((await app.request('/editor.js')).status).toBe(200);
  });

  it('registers no bundle routes without a bundle source', async () => {
    const response = await createTestApp({
      ...fakeAppDeps(),
      workingCopy: WORKING_COPY,
    }).request('/api/schema');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('registers no bundle routes without a working copy', async () => {
    const response = await createTestApp({
      ...fakeAppDeps(),
      bundle: noBundle,
    }).request('/api/schema');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('registers the bundle routes with a bundle source and a working copy', async () => {
    const response = await createTestApp({
      ...fakeAppDeps(),
      bundle: noBundle,
      workingCopy: WORKING_COPY,
    }).request('/api/schema');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'no-bundle' });
  });

  it('registers no change routes without a repo', async () => {
    const app = createTestApp({
      ...fakeAppDeps(),
      bundle: noBundle,
      workingCopy: WORKING_COPY,
    });
    const response = await app.request('/api/changes');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect((await app.request('/api/schema')).status).toBe(503);
  });

  it('registers the change routes with a bundle source, a working copy and a repo', async () => {
    const response = await createTestApp({
      ...fakeAppDeps(),
      bundle: noBundle,
      workingCopy: WORKING_COPY,
      repo,
    }).request('/api/changes');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'no-bundle' });
  });

  it.each([
    { missing: 'a bundle source', deps: { workingCopy: WORKING_COPY, repo } },
    { missing: 'a working copy', deps: { bundle: noBundle, repo } },
  ])(
    'registers no change routes without $missing, even with a repo',
    async ({ deps }) => {
      const response = await createTestApp({
        ...fakeAppDeps(),
        ...deps,
      }).request('/api/changes');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    },
  );

  it('registers GET /api/overlay only with the bundle, the working copy, the repo and the overlay dep', async () => {
    const deps = {
      ...fakeAppDeps(),
      bundle: noBundle,
      workingCopy: WORKING_COPY,
      repo,
    };
    const without = await createTestApp(deps).request('/api/overlay');
    expect(without.status).toBe(404);
    const withOverlay = await createTestApp({
      ...deps,
      overlay: { mediaFolder: 'src/assets/uploads' },
    }).request('/api/overlay');
    expect(withOverlay.status).toBe(503);
    expect(await withOverlay.json()).toStrictEqual({ error: 'no-bundle' });
  });

  it('registers GET /api/preview-url only when its dep is given, and it needs no bundle', async () => {
    expect(
      (await createTestApp(fakeAppDeps()).request('/api/preview-url')).status,
    ).toBe(404);
    const response = await createTestApp({
      ...fakeAppDeps(),
      previewUrl: {
        origin: 'http://preview.localhost:4401',
        site: 'demo',
        tokenSecret: 'a-test-secret',
        warm: async () => {},
      },
    }).request('/api/preview-url');
    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: 'invalid-path',
      message:
        'The path must start with a single "/" and hold no scheme, host, backslash or control character.',
    });
  });

  it('answers a JSON 404 for an unknown path', async () => {
    const response = await createTestApp(fakeAppDeps()).request('/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('records each /api call as activity, and no other request (2.10g)', async () => {
    const touch = vi.fn();
    const app = createTestApp({ ...fakeAppDeps(), activity: { touch } });
    await app.request('/');
    expect(touch).not.toHaveBeenCalled();
    await app.request('/api/nope');
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it('records no activity for a request the Host check refuses (2.10g)', async () => {
    const touch = vi.fn();
    const app = createTestApp({ ...fakeAppDeps(), activity: { touch } });
    const response = await app.request('/api/nope', {
      headers: { host: 'evil.example' },
    });
    expect(response.status).toBe(421);
    expect(touch).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'DELETE'])(
    'answers a JSON 404 for %s on an unknown path',
    async (method) => {
      const response = await createTestApp(fakeAppDeps()).request(
        '/api/changes',
        {
          method,
        },
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    },
  );
});

// The Host check (2.9f): a rebinding page's Host gets 421 on every route, and its save changes no file.
const MISDIRECTED = {
  error: 'misdirected',
  message: 'The Host header is not an address of this CMS.',
};
const ANA = 'src/content/authors/ana-torres.json';

describe('createApp: the Host check', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/editor.js'],
    ['GET', '/api/schema'],
    ['GET', '/api/documents?key=authors/ana-torres'],
    ['GET', '/api/changes'],
    ['GET', '/api/overlay'],
    ['GET', '/api/preview-url?path=%2F'],
    ['GET', '/api/status'],
    ['PUT', '/api/changes'],
    ['POST', '/api/publish'],
    ['POST', '/api/media'],
    ['GET', '/nope'],
  ])('refuses %s %s from a rebinding Host with 421', async (method, path) => {
    const app = createApp({
      ...fakeAppDeps(),
      bundle: noBundle,
      workingCopy: WORKING_COPY,
      repo,
      overlay: { mediaFolder: 'src/assets/uploads' },
      previewUrl: {
        origin: 'http://preview.localhost:4401',
        site: 'demo',
        tokenSecret: 'a-test-secret',
        warm: async () => {},
      },
    });
    const response = await app.request(path, {
      method,
      headers: { host: 'localhost.evil.test' },
    });
    expect(response.status).toBe(421);
    expect(await response.json()).toStrictEqual(MISDIRECTED);
  });

  it('refuses a request with no Host header, which app.request does not send', async () => {
    const response = await createApp(fakeAppDeps()).request('/api/schema');
    expect(response.status).toBe(421);
    expect(await response.json()).toStrictEqual(MISDIRECTED);
  });
});

// Each save here runs real git calls, so one test takes a few seconds under load.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

describe('PUT /api/changes from a rebinding Host', () => {
  const folders: string[] = [];
  afterEach(async () => {
    await removeBundleFolders();
    await Promise.all(
      folders.splice(0).map((folder) => removeTestRoot(folder)),
    );
  });

  // The app with the change routes over a real clone of the sample repo, as changes-routes.test.ts builds it.
  async function saveApp() {
    const root = await makeTestRoot();
    folders.push(root);
    const { repo: saves, state, config } = await saveRepoIn(root);
    const app = createApp({
      ...fakeAppDeps(),
      bundle: directoryBundleSource(await bundleFolder()),
      workingCopy: state.siteFolder,
      repo: saves,
      save: { config, preview: previewSays() },
    });
    return { app, siteFolder: state.siteFolder, repoDir: state.repoDir };
  }

  // A save that renames the author Ana, over `before` (her file as it is now).
  function anaSave(before: string): string {
    return JSON.stringify({
      changes: [
        {
          document: 'authors/ana-torres',
          baseRevision: revisionOf(before),
          data: { ...JSON.parse(before), name: 'Ana Rebound' },
        },
      ],
    });
  }

  it('refuses the save with 421 and changes no file', async () => {
    const { app, siteFolder, repoDir } = await saveApp();
    const before = await readFile(join(siteFolder, ANA), 'utf8');
    const response = await app.request('/api/changes', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        host: 'localhost.evil.test',
      },
      body: anaSave(before),
    });
    expect(response.status).toBe(421);
    expect(await response.json()).toStrictEqual(MISDIRECTED);
    expect(await readFile(join(siteFolder, ANA), 'utf8')).toBe(before);
    // No file changed anywhere in the repo, not only the one document.
    expect(await git(repoDir, ['status', '--porcelain'])).toBe('');
  });

  it('saves the same body sent to localhost', async () => {
    const { app, siteFolder } = await saveApp();
    const before = await readFile(join(siteFolder, ANA), 'utf8');
    const response = await app.request('/api/changes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', host: 'localhost' },
      body: anaSave(before),
    });
    expect(response.status).toBe(200);
    expect(await readFile(join(siteFolder, ANA), 'utf8')).toContain(
      'Ana Rebound',
    );
  });
});
