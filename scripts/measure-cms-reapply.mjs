// Re-apply time on a 200-post site (WORKPLAN 2.13a-1). Not a gate; run by hand, not in CI (architect, 2026-11-24).
// Copies sample-site to a folder under preview-render-server/.build, generates 200 posts there with the generator of
// measure-listing-routes.mjs, and builds it with the real builder, so the bundle is the one a 200-post site has. Seeds a
// local bare remote from the copy and clones it with ensureRepo, as cms-server does. Each of RUNS rounds saves
// SAVES_PER_RUN documents on cms/work, moves origin/main forward with a developer commit, fetches (sync, under its lock),
// and times the re-apply step: tx.reapply under locked('reapply'), as ops.test.ts does. Mean and range over the rounds.
// A local remote leaves out network time.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { directoryBundleSource } from '../cms-server/src/bundle/source.ts';
import { createBundleStore } from '../cms-server/src/bundle/store.ts';
import { parseConfig } from '../cms-server/src/config/schema.ts';
import { openRepo } from '../cms-server/src/git/ops.ts';
import { ensureRepo } from '../cms-server/src/git/repo.ts';
import {
  childEnv,
  git,
  PREVIEW_DIR,
  ROOT,
  seedRemote,
} from './measure-cms-shared.mjs';

const RUNS = 3;
const SAVES_PER_RUN = 3;
const POSTS = 200;
const SITE_DIR = 'sample-site';
// A generated post of the copy; the developer commit changes its title, so origin moves on a file the saves do not touch.
const GENERATED_POST = 'src/content/blog/generated/post-001.md';
// The same build-time fields as measure-listing-routes.mjs and preview-render-server/sites/sample-site.config.ts.
const BUILD_TIME_FIELDS = {
  'data:src/config/config.json': [
    'site.base_url',
    'site.base_path',
    'site.trailing_slash',
  ],
  'data:src/config/theme.json': ['*'],
};
const NOT_COPIED = new Set(['node_modules', 'dist', '.astro']);

/** The manifest folder of the bundle the build wrote: <buildDir>/<name>/manifest, with bundle.json in it. */
function manifestIn(buildDir) {
  for (const name of fs.readdirSync(buildDir)) {
    const manifest = path.join(buildDir, name, 'manifest');
    if (fs.existsSync(path.join(manifest, 'bundle.json'))) return manifest;
  }
  throw new Error(`no bundle.json under ${buildDir}`);
}

/** The bundle's own JSON documents (one file each, not an entry of a shared file), the first `count`. */
function savedRecords(manifest, count) {
  const documents = JSON.parse(
    fs.readFileSync(path.join(manifest, 'documents.json'), 'utf8'),
  );
  return documents
    .filter(
      (record) =>
        record.format === 'json' &&
        record.file !== undefined &&
        record.entryKey === undefined,
    )
    .slice(0, count);
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-reapply-'));
  const buildRoot = path.join(PREVIEW_DIR, '.build');
  fs.mkdirSync(buildRoot, { recursive: true });
  const copyRoot = fs.mkdtempSync(path.join(buildRoot, 'reapply-'));
  const copyDir = path.join(copyRoot, SITE_DIR);
  const buildDir = path.join(copyRoot, 'build');
  const modulesLink = path.join(copyRoot, 'node_modules');
  try {
    fs.cpSync(path.join(ROOT, SITE_DIR), copyDir, {
      recursive: true,
      filter: (source) => !NOT_COPIED.has(path.basename(source)),
    });
    // A junction serves the builder's package lookups, as in measure-listing-routes.mjs.
    fs.symlinkSync(path.join(ROOT, 'node_modules'), modulesLink, 'junction');

    const generated = spawnSync(
      process.execPath,
      ['scripts/generate-posts.mjs', String(POSTS)],
      { cwd: copyDir, encoding: 'utf8', timeout: 60_000 },
    );
    if (generated.status !== 0)
      throw new Error(`generate-posts failed:\n${generated.stderr}`);
    // The sample ignores the generated posts (they are not committed in the repo). The remote of a 200-post site has them,
    // so the copy's ignore line for them goes before the seed is made.
    const ignorePath = path.join(copyDir, '.gitignore');
    fs.writeFileSync(
      ignorePath,
      fs
        .readFileSync(ignorePath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== 'src/content/blog/generated/')
        .join('\n'),
    );

    const configFile = path.join(copyRoot, 'site.config.mjs');
    fs.writeFileSync(
      configFile,
      `export default ${JSON.stringify({ root: copyDir, regions: {}, buildTimeFields: BUILD_TIME_FIELDS, port: 4401 })};\n`,
    );
    const build = spawnSync(process.execPath, ['src/build.ts', configFile], {
      cwd: PREVIEW_DIR,
      env: childEnv({ PREVIEW_BUILD_DIR: buildDir }),
      encoding: 'utf8',
      timeout: 300_000,
    });
    if (build.status !== 0)
      throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);
    const manifest = manifestIn(buildDir);
    const records = savedRecords(manifest, SAVES_PER_RUN);
    if (records.length < SAVES_PER_RUN)
      throw new Error(
        `the bundle has ${records.length} JSON documents, need ${SAVES_PER_RUN}`,
      );

    const remote = seedRemote(work, copyDir);
    const config = parseConfig({
      site: 'reapply-measure',
      remote,
      // seedRemote puts the site at the root of the repo, so the site folder is the root ('.').
      siteDir: '.',
      previewSiteConfig: 'preview.config.json',
      origins: {
        cms: 'https://cms.example.test',
        preview: 'https://preview.example.test',
      },
    });
    const cmsDir = path.join(work, '.cms');
    const log = {
      info: () => {},
      warn: (...args) => console.warn(...args),
      error: (...args) => console.error(...args),
    };
    const state = await ensureRepo({ config, cmsDir, log });
    // One Repo for the whole run: its lock is shared by the saves, the sync and the re-apply.
    const repo = openRepo({ config, cmsDir, state });
    const bundles = createBundleStore(directoryBundleSource(manifest));

    const developer = path.join(work, 'developer');
    git(work, ['clone', remote, developer]);

    async function saveRecord(record, run) {
      const target = path.join(state.siteFolder, record.file);
      const data = JSON.parse(fs.readFileSync(target, 'utf8'));
      data.measureRun = run;
      fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
      await repo.locked('save', (tx) =>
        tx.commitSave([record.file], `measure save ${run}: ${record.key}`),
      );
    }

    function moveOrigin(run) {
      const file = path.join(developer, GENERATED_POST);
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, 'utf8')
          .replace(/^title: .*$/m, `title: "Developer run ${run}"`),
      );
      git(developer, ['add', '--all']);
      git(developer, ['commit', '--message', `developer run ${run}`]);
      git(developer, ['push', 'origin', 'HEAD']);
    }

    // The fetch says whether a re-apply is due. A round without one would time almost nothing, so it is refused.
    async function syncUpstream() {
      const sync = await repo.locked('sync', (tx) => tx.fetch(bundles));
      if (!sync.ok) throw new Error(sync.syncError.message);
      if (!sync.reapply)
        throw new Error(
          'the fetch found no re-apply to time: this round is not a re-apply',
        );
      return sync.upstream;
    }

    const rounds = [];
    for (let run = 1; run <= RUNS; run++) {
      for (const record of records) await saveRecord(record, run);
      moveOrigin(run);
      const upstream = await syncUpstream();
      const started = performance.now();
      const result = await repo.locked('reapply', (tx) =>
        tx.reapply(upstream, bundles),
      );
      rounds.push({
        ms: performance.now() - started,
        renamed: result.renamed.length,
      });
    }

    const ms = rounds.map((round) => round.ms);
    const mean = ms.reduce((sum, value) => sum + value, 0) / ms.length;
    console.log(
      `\nre-apply on a ${POSTS}-post site, ${process.platform}, ${RUNS} rounds, ${SAVES_PER_RUN} saves and one developer commit before each`,
    );
    console.log(
      `re-apply ms: mean ${mean.toFixed(0)} (min ${Math.min(...ms).toFixed(0)} to max ${Math.max(...ms).toFixed(0)}, n ${ms.length})`,
    );
    console.log(
      'round'.padEnd(8),
      're-apply ms'.padStart(12),
      'renamed'.padStart(9),
    );
    for (const [index, round] of rounds.entries()) {
      console.log(
        String(index + 1).padEnd(8),
        round.ms.toFixed(0).padStart(12),
        String(round.renamed).padStart(9),
      );
    }
  } finally {
    // The junction goes first, alone, so the recursive delete never follows it into the repo. A Windows junction is
    // removed with rmdir (as in measure-listing-routes.mjs).
    if (fs.existsSync(modulesLink)) {
      if (process.platform === 'win32') fs.rmdirSync(modulesLink);
      else fs.unlinkSync(modulesLink);
    }
    fs.rmSync(copyRoot, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
}

await main();
