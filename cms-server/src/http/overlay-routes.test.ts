import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_BUNDLE } from '../../test/helpers/bundle.ts';
import { silentLog } from '../../test/helpers/repo.ts';
import {
  removeWorkingCopies,
  sampleWorkingCopy,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import type { BundleSource } from '../bundle/source.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import type { ChangesetRepo } from '../documents/changeset.ts';
import { GitError } from '../git/exec.ts';
import { registerOverlayRoutes } from './overlay-routes.ts';

afterEach(removeWorkingCopies);

const CMS_ORIGIN = 'http://cms.localhost:4400';

/** A changeset repo with no changed paths, so the answer is the working copy's changed documents only. */
const quietRepo: ChangesetRepo = {
  changedPaths: async () => [],
  mergeBase: async () => 'base',
  showAtBytes: async () => null,
  overwrittenSince: async () => new Map(),
};

/** An app with GET /api/overlay over `source` and `repo`, and a media folder with no media.json. */
async function appWith(
  source: BundleSource,
  siteFolder: string,
  repo: ChangesetRepo = quietRepo,
): Promise<Hono> {
  const media = await tempWorkingCopy({});
  const app = new Hono();
  registerOverlayRoutes(app, {
    source,
    repo,
    siteFolder,
    media: {
      stagingDir: join(media, 'staging'),
      mediaFile: join(media, 'media.json'),
      cmsOrigin: CMS_ORIGIN,
    },
    mediaFolder: 'src/assets/uploads',
    log: silentLog(),
  });
  return app;
}

describe('GET /api/overlay', () => {
  it('answers the changed documents of the working copy, in the render request shape', async () => {
    const siteFolder = await sampleWorkingCopy({
      'src/content/authors/ana-torres.json': '{"name":"Ana T."}\n',
    });
    const app = await appWith(
      directoryBundleSource(FIXTURE_BUNDLE),
      siteFolder,
    );
    const response = await app.request('/api/overlay');
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      documents: { 'authors/ana-torres': { name: 'Ana T.' } },
      media: {},
    });
  });

  it('answers 503 no-bundle when there is no bundle', async () => {
    const siteFolder = await sampleWorkingCopy();
    const app = await appWith({ current: async () => null }, siteFolder);
    const response = await app.request('/api/overlay');
    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({ error: 'no-bundle' });
  });

  it('answers 500 changes-unavailable when git cannot give the changed paths', async () => {
    const siteFolder = await sampleWorkingCopy();
    const failing: ChangesetRepo = {
      ...quietRepo,
      changedPaths: () =>
        Promise.reject(
          new GitError('failed', 'git diff --name-status failed (exit 128)', {
            exitCode: 128,
          }),
        ),
    };
    const app = await appWith(
      directoryBundleSource(FIXTURE_BUNDLE),
      siteFolder,
      failing,
    );
    const response = await app.request('/api/overlay');
    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({
      error: 'changes-unavailable',
      message: 'git diff --name-status failed (exit 128)',
    });
  });
});
