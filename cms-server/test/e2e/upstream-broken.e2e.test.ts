// End-to-end (WORKPLAN 2.10f): a developer pushes a component that does not build to the bare remote. A CMS user's content
// edit still publishes: the build check is skipped and the answer says so, and GET /api/status reports the commit that does
// not build. The real builder and the real preview node run with no --bundle, so the sample site is built several times.
import net from 'node:net';
import path from 'node:path';
import type { StatusAnswerBody } from 'cms-contract';
import { describe, expect, it, vi } from 'vitest';
import { type CmsConfig, parseConfig } from '../../src/config/schema.ts';
import { type Running, realDeps, run } from '../../src/run.ts';
import {
  cloneRemote,
  commitAndPush,
  git,
  makeTestRoot,
  removeTestRoot,
  seedRemote,
} from '../helpers/git.ts';

const CMS_DIR = path.resolve(import.meta.dirname, '../..');
const RENDERER_DIR = path.resolve(CMS_DIR, '../preview-render-server');
// The header every page's layout renders. Its unclosed expression does not compile, so the build of every page fails.
const HEADER = 'src/layouts/partials/Header.astro';
const BROKEN_HEADER = '---\n---\n<header>{unclosed\n';
// The builds of the sample site take minutes on a slow machine: the start-up build, then the sync's and the publish's.
const WAIT_MS = 600_000;

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

/** Polls `read` once a second until it answers a value, and fails when `ms` pass first. */
async function until<T>(
  read: () => Promise<T | undefined>,
  ms: number,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline)
      throw new Error('the condition did not come true in time');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** GET /api/status, or undefined while the answer is not one. */
async function statusOf(origin: string): Promise<StatusAnswerBody | undefined> {
  const answer = await fetch(`${origin}/api/status`).catch(() => undefined);
  if (answer === undefined || !answer.ok) return undefined;
  return (await answer.json()) as StatusAnswerBody;
}

describe('a broken upstream does not hold back a content publish (2.10f)', () => {
  it(
    'publishes a content edit with the build check skipped, and reports the commit that does not build',
    async () => {
      const root = await makeTestRoot();
      const configPath = path.join(root, 'cms.config.ts');
      const cmsPort = await freePort();
      const previewPort = await freePort();
      const cmsOrigin = `http://127.0.0.1:${cmsPort}`;
      const previewOrigin = `http://127.0.0.1:${previewPort}`;
      const remote = await seedRemote(root);
      const config: CmsConfig = parseConfig({
        site: 'sample-site',
        remote,
        previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
        origins: { cms: cmsOrigin, preview: previewOrigin },
      });
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      let running: Running | undefined;
      try {
        // No --bundle: the builder is on, so the first start builds the seeded site, as it does in use.
        running = await run(
          [configPath],
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
        await until(async () => {
          const status = await statusOf(cmsOrigin);
          return status?.bundle &&
            status.build?.state === 'idle' &&
            status.node?.state === 'ready'
            ? status
            : undefined;
        }, WAIT_MS);

        // A developer pushes the broken header: a code change, so the publish's sync asks for a build that fails.
        const developer = await cloneRemote(
          remote,
          path.join(root, 'developer'),
        );
        const brokenCommit = await commitAndPush(
          developer,
          { [HEADER]: BROKEN_HEADER },
          'dev: break the header',
        );

        // A CMS user edits an author. The publish syncs, its build of the new code fails, and so does the build of the
        // origin tip, so the upstream is recorded as broken. The publish validates the edit and pushes it with no build.
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
                data: { ...current.value, name: 'Ana Upstream' },
              },
            ],
          }),
        });
        expect(saved.status).toBe(200);

        // The route answers 404 to a request that is not JSON (the guard against other pages), and takes no body.
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
          buildCheckSkipped: 'upstream-broken',
        });
        // The content edit is the commit on the remote, and it sits on the developer's commit.
        expect((await git(remote, ['rev-parse', 'main'])).trim()).toBe(
          answer.commit,
        );
        expect((await git(remote, ['rev-parse', 'main^1'])).trim()).toBe(
          brokenCommit,
        );
        // The status keeps the commit that does not build, with its first error.
        const status = await statusOf(cmsOrigin);
        expect(status?.errors?.upstreamBuildFailed).toStrictEqual({
          sha: brokenCommit,
          firstError: expect.any(String) as string,
        });
      } finally {
        await running?.stop();
        await removeTestRoot(root);
      }
    },
    WAIT_MS + 300_000,
  );
});
