// Memory of the cms-server process alone (WORKPLAN 2.13e, budget R8). Builds the sample-site bundle, seeds a local bare
// repo from sample-site, starts cms-server on that bundle with --bundle (no builder) and reports the memory of its
// process at three points: at rest after 60 s, after WARM_SAVES single-document saves (the warm-up), and after SAVES
// saves. Each save is followed by GET /api/changes and GET /api/status. The preview node is a child process and is not
// counted. The budget (decision R8, metric changed 2026-11-25 from rss to commit charge, user-approved): the run fails
// when the commit charge of cms-server grows by more than GROWTH_LIMIT_MB from the warm-up to SAVES saves (a leak), or is
// over CEILING_MB at SAVES saves (a backstop). Commit charge is read from outside the process (commitBytes), on Windows
// only; elsewhere it is not measured and the budget is not checked. rss (the working set, which Windows trims under
// load) and private memory are printed for information only. The weekly Windows job runs it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ask,
  childEnv,
  claimConfigFile,
  commitBytes,
  configText,
  freePort,
  MB,
  PREVIEW_DIR,
  privateBytes,
  ROOT,
  rssBytes,
  SITE_CONFIG,
  seedRemote,
  sleep,
  startCms,
  stop,
  waitForBundle,
  waitForListening,
} from './measure-cms-shared.mjs';

// The run writes this file and deletes it afterwards (claimConfigFile). previewSiteConfig is resolved from the config's
// folder and the schema refuses `..`, so the config sits in the repo root. Its .cms folder holds only SITE, removed too.
const CONFIG_FILE = path.join(ROOT, 'cms-memory.config.ts');
const SITE = 'memory-measure';
const SITE_DIR = path.join(ROOT, '.cms', SITE);
const DOCUMENT = 'landing/home-v2';
const REST_MS = 60_000;
const WARM_SAVES = 10;
const SAVES = 50;
// The R8 budget (2026-11-25): commit charge growth from the warm-up to SAVES saves, and the commit charge ceiling at SAVES.
const GROWTH_LIMIT_MB = 30;
const CEILING_MB = 450;

async function measure(stage, pid) {
  return {
    stage,
    commit: commitBytes(pid),
    rss: rssBytes(pid),
    private: privateBytes(pid),
  };
}

claimConfigFile(CONFIG_FILE);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-memory-'));
// The bundle sits under preview-render-server/.build, as in measure-memory.mjs: its modules resolve packages from there.
const bundleRoot = path.join(PREVIEW_DIR, '.build');
fs.mkdirSync(bundleRoot, { recursive: true });
const bundleDir = fs.mkdtempSync(path.join(bundleRoot, 'cms-memory-'));

let server;
let output = () => '';
try {
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  const remote = seedRemote(work);
  const build = spawnSync(process.execPath, ['src/build.ts', SITE_CONFIG], {
    cwd: PREVIEW_DIR,
    env: childEnv({ PREVIEW_BUILD_DIR: bundleDir }),
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (build.status !== 0)
    throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);

  const cmsPort = await freePort();
  const previewPort = await freePort();
  fs.writeFileSync(
    CONFIG_FILE,
    configText({ site: SITE, remote, cmsPort, previewPort }),
    'utf8',
  );
  // The build writes <bundleDir>/sample-site, whose manifest/ holds the bundle files (bundle.json among them).
  const started = startCms(CONFIG_FILE, [
    '--bundle',
    path.join(bundleDir, 'sample-site'),
  ]);
  server = started.server;
  output = started.output;
  await waitForListening(cmsPort, server, output);

  const base = `http://127.0.0.1:${cmsPort}`;
  await waitForBundle(base, output, 30_000);
  await sleep(REST_MS);
  const rows = [
    await measure(`at rest, after ${REST_MS / 1000} s`, server.pid),
  ];

  const home = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, 'sample-site/src/content', `${DOCUMENT}.json`),
      'utf8',
    ),
  );
  const doc = JSON.parse(
    await ask(`${base}/api/documents?key=${encodeURIComponent(DOCUMENT)}`),
  );
  let revision = doc.revision;
  let warm;
  for (let i = 0; i < SAVES; i++) {
    home.blocks[0].title = `Memory save ${i}`;
    const answer = JSON.parse(
      await ask(`${base}/api/changes`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: [{ document: DOCUMENT, baseRevision: revision, data: home }],
        }),
      }),
    );
    revision = answer.revisions[DOCUMENT];
    if (revision === undefined) throw new Error(`save ${i} gave no revision`);
    await ask(`${base}/api/changes`);
    await ask(`${base}/api/status`);
    if (i === WARM_SAVES - 1) {
      warm = await measure(`after ${WARM_SAVES} saves (warm-up)`, server.pid);
      rows.push(warm);
    }
  }
  const after = await measure(`after ${SAVES} saves`, server.pid);
  rows.push(after);

  console.log(
    `cms-server pid ${server.pid}, ${SITE_CONFIG}, ${process.platform}`,
  );
  console.log(
    'stage'.padEnd(30),
    'commit MB'.padStart(10),
    'rss MB'.padStart(8),
    'private MB'.padStart(12),
  );
  const mb = (bytes) =>
    bytes === null ? 'not measured' : (bytes / MB).toFixed(1);
  for (const row of rows) {
    console.log(
      row.stage.padEnd(30),
      mb(row.commit).padStart(10),
      (row.rss / MB).toFixed(1).padStart(8),
      (row.private / MB).toFixed(1).padStart(12),
    );
  }
  // The R8 budget. Not checked where commit charge is not measured.
  if (warm.commit === null) {
    console.log(
      'commit charge is not measured here; the R8 budget is not checked',
    );
  } else {
    const growthMb = (after.commit - warm.commit) / MB;
    console.log(
      `commit charge growth from save ${WARM_SAVES} to save ${SAVES}: ${growthMb.toFixed(1)} MB (limit ${GROWTH_LIMIT_MB} MB); ceiling ${CEILING_MB} MB at save ${SAVES}`,
    );
    if (growthMb > GROWTH_LIMIT_MB) {
      process.exitCode = 1;
      console.error(
        `commit charge grew ${growthMb.toFixed(1)} MB from save ${WARM_SAVES} to save ${SAVES}, over the ${GROWTH_LIMIT_MB} MB limit (R8)`,
      );
    }
    if (after.commit > CEILING_MB * MB) {
      process.exitCode = 1;
      console.error(
        `commit charge ${(after.commit / MB).toFixed(1)} MB after ${SAVES} saves is over the ${CEILING_MB} MB ceiling (R8)`,
      );
    }
  }
} finally {
  if (server !== undefined) await stop(server);
  fs.rmSync(CONFIG_FILE, { force: true });
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(bundleDir, { recursive: true, force: true });
}
