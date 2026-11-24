// Memory of the cms-server process alone (WORKPLAN 2.13e, budget 2.13a). Builds the sample-site bundle, seeds a local
// bare repo from sample-site, starts cms-server on that bundle with --bundle (no builder) and reports the rss and
// private memory of its process at two points: at rest after 60 s, and after 50 single-document saves, each followed
// by GET /api/changes and GET /api/status. The preview node is a child process and is not counted. rss is the working
// set on Windows and VmRSS on Linux. Private memory comes from the OS, as in measure-memory.mjs. Compare private memory
// across runs (QUALITY-TOOLING.md, Memory metric). The run fails above BUDGET_MB of rss after the saves (decision R8,
// option B); the weekly Windows job runs it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ask,
  childEnv,
  claimConfigFile,
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
const SAVES = 50;
const BUDGET_MB = 200;

async function measure(stage, pid) {
  return { stage, rss: rssBytes(pid), private: privateBytes(pid) };
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
  }
  rows.push(await measure(`after ${SAVES} saves`, server.pid));

  console.log(
    `cms-server pid ${server.pid}, ${SITE_CONFIG}, ${process.platform}`,
  );
  console.log(
    'stage'.padEnd(24),
    'rss MB'.padStart(8),
    'private MB'.padStart(12),
  );
  for (const row of rows) {
    console.log(
      row.stage.padEnd(24),
      (row.rss / MB).toFixed(1).padStart(8),
      (row.private / MB).toFixed(1).padStart(12),
    );
  }
  const after = rows[rows.length - 1];
  if (after.rss > BUDGET_MB * MB) {
    process.exitCode = 1;
    console.error(
      `rss ${(after.rss / MB).toFixed(1)} MB after ${SAVES} saves is over the ${BUDGET_MB} MB budget (R8)`,
    );
  }
} finally {
  if (server !== undefined) await stop(server);
  fs.rmSync(CONFIG_FILE, { force: true });
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(bundleDir, { recursive: true, force: true });
}
