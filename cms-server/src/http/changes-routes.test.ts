import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Hono } from 'hono';
import { revisionOf } from 'preview-contract';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundleFolder,
  FIXTURE_BUNDLE,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import type { ChangesetRepo } from '../documents/changeset.ts';
import { registerChangeRoutes } from './changes-routes.ts';

const BLOG_1 = 'src/content/blog/blog-1.md';
const OLD = '---\ntitle: Old\n---\nold\n';
const NEW = '---\ntitle: New\n---\nnew\n';

const folders: string[] = [];

afterEach(async () => {
  await removeBundleFolders();
  await Promise.all(folders.splice(0).map((folder) => removeTestRoot(folder)));
});

// A repo in which only blog-1 changed, from OLD (at the merge base) to NEW (in the working copy).
const repo: ChangesetRepo = {
  changedPaths: async () => [{ path: BLOG_1, status: 'modified' }],
  mergeBase: async () => 'base',
  showAtBytes: async (_ref, path) =>
    path === BLOG_1 ? Buffer.from(OLD) : null,
  overwrittenSince: async () => new Map(),
};

// The app with only the changes route, over the bundle folder and a working copy.
async function get(bundle: string, siteFolder: string): Promise<Response> {
  const app = new Hono();
  registerChangeRoutes(app, directoryBundleSource(bundle), repo, siteFolder);
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
