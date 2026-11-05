// A real clone for the save tests (WORKPLAN 2.5c): a bare remote whose `main` holds the bundle fixture's source files
// under `site/`, cloned by ensureRepo, so a save commits on cms/work for real. The working copy is `state.siteFolder`.
// Every git call goes through test/helpers/git.ts. Test code only.
import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CmsConfig, parseConfig } from '../../src/config/schema.ts';
import { openRepo, type Repo } from '../../src/git/ops.ts';
import { ensureRepo, type RepoState } from '../../src/git/repo.ts';
import type { Logger } from '../../src/log.ts';
import { git } from './git.ts';

// The source files that the bundle fixture's documents point at, copied from the bundle source.
const SITE_SOURCE = fileURLToPath(
  new URL('../fixtures/bundle-src/src/', import.meta.url),
);

/** A clone with its operations, and the config it was made with. */
export interface SaveRepo {
  readonly repo: Repo;
  readonly state: RepoState;
  readonly config: CmsConfig;
}

/** A clone of a new remote under `root`, whose site folder is `<root>/repo/site`. Call once per test. */
export async function saveRepoIn(root: string): Promise<SaveRepo> {
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  await git(root, ['init', '--bare', remote]);
  await mkdir(join(seed, 'site'), { recursive: true });
  await cp(SITE_SOURCE, join(seed, 'site', 'src'), { recursive: true });
  await git(seed, ['init']);
  await git(seed, ['add', '--all']);
  await git(seed, ['commit', '--message', 'seed: site']);
  await git(seed, ['remote', 'add', 'origin', remote]);
  await git(seed, ['push', 'origin', 'HEAD:main']);
  const config = parseConfig({
    site: 'demo',
    remote,
    siteDir: 'site',
    previewSiteConfig: 'preview.config.json',
    origins: {
      cms: 'https://cms.example.test',
      preview: 'https://preview.example.test',
    },
  });
  const cmsDir = join(root, '.cms');
  const state = await ensureRepo({ config, cmsDir, log: silentLog() });
  return { repo: openRepo({ config, cmsDir, state }), state, config };
}

/** A logger that prints nothing. */
export function silentLog(): Logger {
  return { info() {}, warn() {}, error() {} };
}
