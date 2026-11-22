// End-to-end (WORKPLAN 2.12b): the whole save and publish path with siteDir set, a monorepo whose site sits in a
// subfolder. seedRemote copies sample-site into `site/` of the first commit (no second copy is committed), the CMS saves
// and publishes there, and the publish's commit holds only the saved file, under `site/`. Runs with --bundle: nothing is built.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { bundleJsonSchema } from 'preview-contract';
import { describe, expect, inject, it, vi } from 'vitest';
import { type CmsConfig, parseConfig } from '../../src/config/schema.ts';
import { type Running, realDeps, run } from '../../src/run.ts';
import {
  git,
  makeTestRoot,
  removeTestRoot,
  seedRemote,
} from '../helpers/git.ts';

const CMS_DIR = path.resolve(import.meta.dirname, '../..');
const RENDERER_DIR = path.resolve(CMS_DIR, '../preview-render-server');
const BUNDLE = inject('bundleDir');
const SITE_DIR = 'site';
const ANA = 'src/content/authors/ana-torres.json';

/** A port that is free right now on 127.0.0.1. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

describe('save and publish with siteDir set (monorepo, 2.12b)', () => {
  it('saves a document under site/ and publishes one commit on the remote that holds only that file', async () => {
    const root = await makeTestRoot();
    const configPath = path.join(root, 'cms.config.ts');
    const identity = bundleJsonSchema.parse(
      JSON.parse(
        fs.readFileSync(path.join(BUNDLE, 'manifest', 'bundle.json'), 'utf8'),
      ),
    );
    const cmsPort = await freePort();
    const previewPort = await freePort();
    const cmsOrigin = `http://127.0.0.1:${cmsPort}`;
    const remote = await seedRemote(root, { siteDir: SITE_DIR });
    const seed = (await git(remote, ['rev-parse', 'main'])).trim();
    const config: CmsConfig = parseConfig({
      site: 'sample-site',
      siteDir: SITE_DIR,
      remote,
      previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
      origins: {
        cms: cmsOrigin,
        preview: `http://127.0.0.1:${previewPort}`,
      },
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let running: Running | undefined;
    try {
      running = await run(
        ['--bundle', BUNDLE, configPath],
        {},
        {
          ...realDeps,
          loadConfig: () =>
            Promise.resolve({
              ...config,
              previewSiteConfig: path.join(
                RENDERER_DIR,
                'sites',
                'sample-site.config.ts',
              ),
            }),
          logger,
        },
      );

      // The document is read from the site folder inside the repo, and saved there.
      const current = (await (
        await fetch(
          `${cmsOrigin}/api/documents?key=${encodeURIComponent('authors/ana-torres')}`,
        )
      ).json()) as { value: Record<string, unknown>; revision: string };
      const saved = await fetch(`${cmsOrigin}/api/changes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: [
            {
              document: 'authors/ana-torres',
              baseRevision: current.revision,
              deleted: false,
              data: { ...current.value, name: 'Ana Monorepo' },
            },
          ],
        }),
      });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toStrictEqual({
        revisions: { 'authors/ana-torres': expect.any(String) as string },
        warnings: [],
        rebuild: false,
      });
      expect(running.supervisor.status().bundleId).toBe(identity.bundleId);

      // Publish: one commit on top of the seed, by the configured author. No build runs (a content save).
      const published = await fetch(`${cmsOrigin}/api/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(published.status).toBe(200);
      const answer = (await published.json()) as { commit: string };
      expect(answer).toStrictEqual({
        commit: expect.any(String) as string,
        overwritten: [],
        renamed: [],
      });
      const head = (await git(remote, ['rev-parse', 'main'])).trim();
      expect(answer.commit).toBe(head);
      expect((await git(remote, ['rev-parse', 'main^1'])).trim()).toBe(seed);
      expect(
        (await git(remote, ['diff', '--name-only', seed, head])).trim(),
      ).toBe(`${SITE_DIR}/${ANA}`);
      expect(
        JSON.parse(
          await git(remote, ['show', `${head}:${SITE_DIR}/${ANA}`]),
        ) as unknown,
      ).toMatchObject({ name: 'Ana Monorepo' });
    } finally {
      await running?.stop();
      await removeTestRoot(root);
    }
  }, 180_000);
});
