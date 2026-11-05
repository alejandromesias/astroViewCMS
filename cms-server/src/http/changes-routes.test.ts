import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Hono } from 'hono';
import { revisionOf } from 'preview-contract';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeAppDeps } from '../../test/helpers/app-deps.ts';
import {
  bundleFolder,
  FIXTURE_BUNDLE,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import { git, makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { saveRepoIn } from '../../test/helpers/repo.ts';
import { previewSays } from '../../test/helpers/save-context.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import type { Repo } from '../git/ops.ts';
import type { PreviewClient } from '../save/context.ts';
import { createApp } from './app.ts';
import { MAX_BODY_BYTES, registerChangeRoutes } from './changes-routes.ts';

const BLOG_1 = 'src/content/blog/blog-1.md';
const OLD = '---\ntitle: Old\n---\nold\n';
const NEW = '---\ntitle: New\n---\nnew\n';
const ANA = 'src/content/authors/ana-torres.json';
const CONFIG = 'src/config/config.json';

const folders: string[] = [];

afterEach(async () => {
  await removeBundleFolders();
  await Promise.all(folders.splice(0).map((folder) => removeTestRoot(folder)));
});

// A repo in which only blog-1 changed, from OLD (at the merge base) to NEW (in the working copy). GET reads only these.
const repo: Repo = {
  changedPaths: async () => [{ path: BLOG_1, status: 'modified' }],
  mergeBase: async () => 'base',
  showAtBytes: async (_ref, path) =>
    path === BLOG_1 ? Buffer.from(OLD) : null,
  overwrittenSince: async () => new Map(),
  locked: () => Promise.reject(new Error('GET takes no lock')),
  showAt: () => Promise.reject(new Error('GET reads no text')),
};

// The app with only the changes route, over the bundle folder and a working copy.
async function get(bundle: string, siteFolder: string): Promise<Response> {
  const app = new Hono();
  registerChangeRoutes(app, {
    source: directoryBundleSource(bundle),
    repo,
    siteFolder,
    media: fakeAppDeps().media,
  });
  return app.request('/api/changes');
}

async function workingCopy(): Promise<string> {
  const folder = await makeTestRoot();
  folders.push(folder);
  await mkdir(dirname(join(folder, BLOG_1)), { recursive: true });
  await writeFile(join(folder, BLOG_1), NEW);
  return folder;
}

describe('GET /api/changes', () => {
  it('answers 200 with each changed document, its base revision and its saved value', async () => {
    const res = await get(FIXTURE_BUNDLE, await workingCopy());
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      documents: [
        {
          key: 'blog/blog-1',
          status: 'modified',
          baseRevision: revisionOf(OLD),
          value: { data: { title: 'New' }, body: 'new\n' },
        },
      ],
      createdRecords: [],
    });
  });

  it('answers 503 when no bundle is in place', async () => {
    const dir = await bundleFolder({ 'bundle.json': null });
    const res = await get(dir, await workingCopy());
    expect(res.status).toBe(503);
    expect(await res.json()).toStrictEqual({ error: 'no-bundle' });
  });

  it('answers 500 when bundle.json does not parse, and names the file', async () => {
    const dir = await bundleFolder({ 'bundle.json': '{' });
    const res = await get(dir, await workingCopy());
    expect(res.status).toBe(500);
    expect(await res.json()).toStrictEqual({
      error: 'bundle-invalid',
      message: 'bundle.json: is not valid JSON',
    });
  });
});

// The app over a real clone of the bundle fixture's source, with `preview` as the preview node. Each test calls it.
async function saveApp(
  preview: PreviewClient,
  bundle?: string,
): Promise<{ app: Hono; siteFolder: string; repoDir: string }> {
  const root = await makeTestRoot();
  folders.push(root);
  const { repo: saves, state, config } = await saveRepoIn(root);
  const app = createApp({
    ...fakeAppDeps(),
    media: {
      stagingDir: join(root, 'staging'),
      mediaFile: join(root, 'media.json'),
      cmsOrigin: 'http://cms.localhost:4400',
    },
    bundle: directoryBundleSource(bundle ?? (await bundleFolder())),
    workingCopy: state.siteFolder,
    repo: saves,
    save: { config, preview },
  });
  return { app, siteFolder: state.siteFolder, repoDir: state.repoDir };
}

// A PUT of `body` (a string, sent as it is) with the JSON content type unless `headers` says otherwise.
async function put(
  app: Hono,
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): Promise<Response> {
  return app.request('/api/changes', { method: 'PUT', headers, body });
}

// A save body of one update of the author Ana, over `before` (her file as it is now).
function anaUpdate(before: string, name: string): string {
  return JSON.stringify({
    changes: [
      {
        document: 'authors/ana-torres',
        baseRevision: revisionOf(before),
        data: { ...JSON.parse(before), name },
      },
    ],
  });
}

describe('PUT /api/changes', () => {
  it('saves an update, commits it with one line per document, and answers the new revision', async () => {
    const { app, siteFolder, repoDir } = await saveApp(previewSays());
    const before = await readFile(join(siteFolder, ANA), 'utf8');
    const res = await put(app, anaUpdate(before, 'Ana T.'));
    const after = await readFile(join(siteFolder, ANA), 'utf8');
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      revisions: { 'authors/ana-torres': revisionOf(after) },
      warnings: [],
      rebuild: false,
    });
    expect((await git(repoDir, ['log', '-1', '--format=%B'])).trim()).toBe(
      'CMS save: 1 document(s)\n\nmodified authors/ana-torres',
    );
  });

  it('saves two documents in one commit', async () => {
    const { app, siteFolder, repoDir } = await saveApp(previewSays());
    const before = await readFile(join(siteFolder, ANA), 'utf8');
    const res = await put(
      app,
      JSON.stringify({
        changes: [
          JSON.parse(anaUpdate(before, 'Ana T.')).changes[0],
          {
            document: 'authors/lee',
            baseRevision: null,
            data: { name: 'Lee' },
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()).revisions)).toStrictEqual([
      'authors/ana-torres',
      'authors/lee',
    ]);
    expect((await git(repoDir, ['log', '-1', '--format=%B'])).trim()).toBe(
      'CMS save: 2 document(s)\n\nmodified authors/ana-torres\ncreated authors/lee',
    );
  });

  it('creates a document that GET then answers, and updates it in a second save', async () => {
    const { app, siteFolder } = await saveApp(previewSays());
    const created = await put(
      app,
      JSON.stringify({
        changes: [
          {
            document: 'authors/lee',
            baseRevision: null,
            data: { name: 'Lee' },
          },
        ],
      }),
    );
    const rev1 = (await created.json()).revisions['authors/lee'];
    expect(rev1).toBe(
      revisionOf(
        await readFile(join(siteFolder, 'src/content/authors/lee.json')),
      ),
    );
    const read = await app.request('/api/documents?key=authors/lee');
    expect(await read.json()).toMatchObject({
      key: 'authors/lee',
      revision: rev1,
      value: { name: 'Lee' },
      editable: true,
      buildTime: false,
    });

    const updated = await put(
      app,
      JSON.stringify({
        changes: [
          {
            document: 'authors/lee',
            baseRevision: rev1,
            data: { name: 'Lee Park' },
          },
        ],
      }),
    );
    expect(updated.status).toBe(200);
    const reread = await app.request('/api/documents?key=authors/lee');
    expect(await reread.json()).toMatchObject({ value: { name: 'Lee Park' } });
  }, 20_000);

  it('saves one entry of a shared file, and leaves the other entries as they are', async () => {
    const { app, siteFolder } = await saveApp(previewSays());
    const other = async () =>
      (
        await (
          await app.request('/api/documents?key=testimonials/t-kofi')
        ).json()
      ).value;
    const otherBefore = await other();
    const fileBefore = await readFile(
      join(siteFolder, 'src/content/testimonials.json'),
      'utf8',
    );
    const read = await (
      await app.request('/api/documents?key=testimonials/t-ana')
    ).json();
    const res = await put(
      app,
      JSON.stringify({
        changes: [
          {
            document: 'testimonials/t-ana',
            baseRevision: read.revision,
            data: { ...read.value, name: 'Priya N.' },
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const reread = await (
      await app.request('/api/documents?key=testimonials/t-ana')
    ).json();
    expect(reread.value).toMatchObject({ name: 'Priya N.' });
    expect(await other()).toStrictEqual(otherBefore);
    // Only the name of the saved entry changes in the file; the codec keeps the rest byte for byte.
    expect(
      await readFile(join(siteFolder, 'src/content/testimonials.json'), 'utf8'),
    ).toBe(fileBefore.replace('"name": "Priya Nair"', '"name": "Priya N."'));
  });

  it('answers 409 with the revision and value now, and writes nothing', async () => {
    const { app, siteFolder, repoDir } = await saveApp(previewSays());
    const before = await readFile(join(siteFolder, ANA), 'utf8');
    const res = await put(
      app,
      JSON.stringify({
        changes: [
          {
            document: 'authors/ana-torres',
            baseRevision: 'stale',
            data: { name: 'Ana T.' },
          },
        ],
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toStrictEqual({
      error: 'conflict',
      documents: [
        {
          key: 'authors/ana-torres',
          revision: revisionOf(before),
          value: JSON.parse(before),
        },
      ],
    });
    expect(await git(repoDir, ['status', '--porcelain'])).toBe('');
  });

  it('answers 422 with the field paths the preview reports, and writes nothing', async () => {
    const { app, siteFolder, repoDir } = await saveApp(
      previewSays([
        {
          key: 'authors/ana-torres',
          path: ['name'],
          message: 'Required',
          kind: 'invalid',
        },
      ]),
    );
    const before = await readFile(join(siteFolder, ANA), 'utf8');
    const res = await put(app, anaUpdate(before, ''));
    expect(res.status).toBe(422);
    expect(await res.json()).toStrictEqual({
      error: 'invalid',
      errors: [
        { key: 'authors/ana-torres', path: ['name'], message: 'Required' },
      ],
    });
    expect(await git(repoDir, ['status', '--porcelain'])).toBe('');
  });

  it('saves when the only error is a refinement that threw', async () => {
    const { app, siteFolder } = await saveApp(
      previewSays([
        {
          key: 'authors/ana-torres',
          path: ['name'],
          message: 'boom',
          kind: 'refinement-threw',
        },
      ]),
    );
    const before = await readFile(join(siteFolder, ANA), 'utf8');
    const res = await put(app, anaUpdate(before, 'Ana T.'));
    expect(res.status).toBe(200);
  });

  it('answers 503 preview-unavailable when the preview node does not answer, and writes nothing', async () => {
    const { app, siteFolder, repoDir } = await saveApp({
      validate: () => Promise.reject(new Error('timed out')),
    });
    const before = await readFile(join(siteFolder, ANA), 'utf8');
    const res = await put(app, anaUpdate(before, 'Ana T.'));
    expect(res.status).toBe(503);
    expect(await res.json()).toStrictEqual({
      error: 'preview-unavailable',
      message:
        'The preview node did not answer, so nothing was saved. Try again once it is ready.',
    });
    expect(await readFile(join(siteFolder, ANA), 'utf8')).toBe(before);
    expect(await git(repoDir, ['status', '--porcelain'])).toBe('');
  });

  it('answers the rebuild flag when a build-time field changed', async () => {
    const { app, siteFolder } = await saveApp(previewSays());
    const before = await readFile(join(siteFolder, CONFIG), 'utf8');
    const current = JSON.parse(before);
    const res = await put(
      app,
      JSON.stringify({
        changes: [
          {
            document: 'data:src/config/config.json',
            baseRevision: revisionOf(before),
            data: {
              ...current,
              site: { ...current.site, base_url: 'https://elsewhere.example' },
            },
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).rebuild).toBe(true);
  });

  it('answers 400 invalid-body for a body that is not JSON', async () => {
    const { app } = await saveApp(previewSays());
    const res = await put(app, '{');
    expect(res.status).toBe(400);
    expect(await res.json()).toStrictEqual({
      error: 'invalid-body',
      message: 'The body is not valid JSON',
    });
  });

  it('answers 404 for a body that is not JSON by its content type', async () => {
    const { app } = await saveApp(previewSays());
    const res = await put(app, '{}', { 'content-type': 'text/plain' });
    expect(res.status).toBe(404);
  });

  it('refuses a cross-site request with 403', async () => {
    const { app } = await saveApp(previewSays());
    const res = await put(app, '{}', {
      'content-type': 'application/json',
      'sec-fetch-site': 'cross-site',
    });
    expect(res.status).toBe(403);
  });

  it('answers 413 for a body over the cap', async () => {
    const { app } = await saveApp(previewSays());
    const res = await put(app, 'x'.repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toStrictEqual({
      error: 'body-too-large',
      message: `The body is larger than ${MAX_BODY_BYTES} bytes`,
    });
  });

  it('answers 500 for a body that fails while it is read, not 413', async () => {
    const { app } = await saveApp(previewSays());
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const res = await app.request('/api/changes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: broken,
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(500);
  });

  it('answers 503 no-bundle when no bundle is in place', async () => {
    const { app } = await saveApp(
      previewSays(),
      await bundleFolder({ 'bundle.json': null }),
    );
    const res = await put(
      app,
      JSON.stringify({
        changes: [{ document: 'authors/lee', baseRevision: null, data: {} }],
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toStrictEqual({ error: 'no-bundle' });
  });
});
