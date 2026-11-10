import { describe, expect, it } from 'vitest';
import { fakeAppDeps } from '../../test/helpers/app-deps.ts';
import type { BundleSource } from '../bundle/source.ts';
import type { Repo } from '../git/ops.ts';
import { createApp } from './app.ts';

// A bundle source with no bundle: a registered bundle route answers 503 `no-bundle`, an unregistered one 404 `not_found`.
const noBundle: BundleSource = { current: async () => null };
const repo = {} as Repo;
const WORKING_COPY = 'unused-working-copy';

describe('createApp', () => {
  it('serves the editor page, its stylesheet and its script', async () => {
    const app = createApp(fakeAppDeps());
    const page = await app.request('/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Test editor</title>');
    expect((await app.request('/editor.css')).status).toBe(200);
    expect((await app.request('/editor.js')).status).toBe(200);
  });

  it('registers no bundle routes without a bundle source', async () => {
    const response = await createApp({
      ...fakeAppDeps(),
      workingCopy: WORKING_COPY,
    }).request('/api/schema');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('registers no bundle routes without a working copy', async () => {
    const response = await createApp({
      ...fakeAppDeps(),
      bundle: noBundle,
    }).request('/api/schema');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('registers the bundle routes with a bundle source and a working copy', async () => {
    const response = await createApp({
      ...fakeAppDeps(),
      bundle: noBundle,
      workingCopy: WORKING_COPY,
    }).request('/api/schema');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'no-bundle' });
  });

  it('registers no change routes without a repo', async () => {
    const app = createApp({
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
    const response = await createApp({
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
      const response = await createApp({ ...fakeAppDeps(), ...deps }).request(
        '/api/changes',
      );
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
    const without = await createApp(deps).request('/api/overlay');
    expect(without.status).toBe(404);
    const withOverlay = await createApp({
      ...deps,
      overlay: { mediaFolder: 'src/assets/uploads' },
    }).request('/api/overlay');
    expect(withOverlay.status).toBe(503);
    expect(await withOverlay.json()).toStrictEqual({ error: 'no-bundle' });
  });

  it('registers GET /api/preview-url only when its dep is given, and it needs no bundle', async () => {
    expect(
      (await createApp(fakeAppDeps()).request('/api/preview-url')).status,
    ).toBe(404);
    const response = await createApp({
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
    const response = await createApp(fakeAppDeps()).request('/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it.each(['POST', 'PUT', 'DELETE'])(
    'answers a JSON 404 for %s on an unknown path',
    async (method) => {
      const response = await createApp(fakeAppDeps()).request('/api/changes', {
        method,
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    },
  );
});
