// The real build of cms-server (WORKPLAN 2.9a): a worktree of a seeded remote, preview-render-server's build.ts,
// and the bundle. Each case runs a real sample-site build, so this file runs alone ([build]).
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cloneRemote,
  commitAndPush,
  git,
  makeTestRoot,
  removeTestRoot,
  seedRemote,
} from '../../test/helpers/git.ts';
import { openRepo } from '../git/ops.ts';
import { ensureRepo } from '../git/repo.ts';
import type { Logger } from '../log.ts';
import { createBuilder } from './build-commit.ts';
import { createBuildRunner } from './build-runner.ts';

const SITE = 'demo';
const SITE_CONFIG = path.resolve(
  import.meta.dirname,
  '../../../preview-render-server/sites/sample-site.config.ts',
);
// A page whose frontmatter does not parse, so astro fails on this file.
const BROKEN_PAGE = '---\nconst value = ;\n---\n<h1>Broken</h1>\n';
const BUILD_TEST_TIMEOUT_MS = 240_000;

// Silent: the cases check the results, the bundle and the folders, not the log lines.
const SILENT: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let root: string;

beforeEach(async () => {
  root = await makeTestRoot();
});

afterEach(async () => {
  await removeTestRoot(root);
});

// A seeded remote (sample-site on `main`), its CMS clone, and a runner that builds for real.
async function setUp() {
  const remote = await seedRemote(root);
  const cmsDir = path.join(root, '.cms');
  const config = {
    site: SITE,
    remote,
    branch: 'main',
    siteDir: '.',
    git: { author: 'Developer <developer@example.invalid>' },
  };
  const state = await ensureRepo({ config, cmsDir, log: SILENT });
  const repo = openRepo({ config, cmsDir, state });
  const runner = createBuildRunner({
    build: createBuilder({
      repo,
      cmsDir,
      site: SITE,
      siteDir: '.',
      siteConfig: SITE_CONFIG,
      log: SILENT,
    }),
  });
  return { remote, cmsDir, state, runner };
}

describe('the build of a commit', () => {
  it(
    'builds a worktree of the seeded remote into a bundle, and removes the worktree',
    async () => {
      const { cmsDir, state, runner } = await setUp();
      const commit = (
        await git(state.repoDir, ['rev-parse', 'origin/main'])
      ).trim();

      const result = await runner.request(commit);

      expect(result.ok).toBe(true);
      expect(result.firstError).toBeNull();
      expect(result.dir).toBe(
        path.join(cmsDir, SITE, 'bundles', result.bundleId),
      );
      const bundle = JSON.parse(
        await readFile(
          path.join(result.dir, 'manifest', 'bundle.json'),
          'utf8',
        ),
      ) as { bundleId: string };
      expect(bundle.bundleId).toBe(result.bundleId);
      const log = await readFile(
        path.join(cmsDir, SITE, 'logs', `${result.bundleId}.log`),
        'utf8',
      );
      expect(log.split('\n').slice(0, 4)).toEqual([
        `commit ${commit}`,
        `bundle ${result.bundleId}`,
        'result ok',
        '',
      ]);
      expect(await readdir(path.join(cmsDir, SITE, 'worktrees'))).toEqual([]);
    },
    BUILD_TEST_TIMEOUT_MS,
  );

  it(
    'fails a commit whose page does not compile, with the first error, and keeps no bundle folder',
    async () => {
      const { remote, cmsDir, state, runner } = await setUp();
      const clone = await cloneRemote(remote, path.join(root, 'clone'));
      const commit = await commitAndPush(
        clone,
        { 'src/pages/broken.astro': BROKEN_PAGE },
        'Add a broken page',
      );
      await git(state.repoDir, ['fetch', 'origin']);

      const result = await runner.request(commit);

      expect(result.ok).toBe(false);
      expect(result.firstError).toEqual({
        file: 'src/pages/broken.astro',
        message: 'CompilerError: Unexpected token',
      });
      expect(existsSync(result.dir)).toBe(false);
      const log = await readFile(
        path.join(cmsDir, SITE, 'logs', `${result.bundleId}.log`),
        'utf8',
      );
      expect(log.split('\n').slice(0, 3)).toEqual([
        `commit ${commit}`,
        `bundle ${result.bundleId}`,
        'result failed',
      ]);
    },
    BUILD_TEST_TIMEOUT_MS,
  );
});
