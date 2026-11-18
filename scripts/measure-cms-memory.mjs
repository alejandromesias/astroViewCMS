// Memory of the cms-server process alone (WORKPLAN 2.13e). Not a gate. Builds the sample-site bundle, seeds a local
// bare repo from sample-site, starts cms-server on that bundle with --bundle (no builder) and reports the rss and
// private memory of its process at two points: at rest after 60 s, and after 50 single-document saves, each followed
// by GET /api/changes and GET /api/status. The preview node is a child process and is not counted. rss is the working
// set on Windows and VmRSS on Linux. Private memory comes from the OS, as in measure-memory.mjs. Compare private memory
// across runs (QUALITY-TOOLING.md, Memory metric).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'cms-server');
const PREVIEW_DIR = path.join(ROOT, 'preview-render-server');
const SITE_CONFIG = 'sites/sample-site.config.ts';
// previewSiteConfig is resolved from the config's folder and the schema refuses `..`, so the config sits in the repo
// root. It is written for this run and deleted after it (gitignored). Its .cms folder holds only SITE, removed too.
const CONFIG_FILE = path.join(ROOT, 'cms-memory.config.ts');
const SITE = 'memory-measure';
const SITE_DIR = path.join(ROOT, '.cms', SITE);
const DOCUMENT = 'landing/home-v2';
const REST_MS = 60_000;
const SAVES = 50;
const MB = 1024 * 1024;
const NOT_COPIED = new Set(['node_modules', 'dist', '.astro']);
// Settings every git call carries, so the result does not depend on the machine (as dev-remote.ts does).
const GIT_SETTINGS = [
  '-c',
  'user.name=Developer',
  '-c',
  'user.email=developer@example.invalid',
  '-c',
  'core.autocrlf=false',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'init.defaultBranch=main',
];
// Astro sends `astro` commands to the background when it detects an AI agent; clear those markers for the child
// processes (as measure-memory.mjs does).
const AGENT_VARS = [
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_AGENT_SDK_VERSION',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function git(cwd, args) {
  execFileSync('git', [...GIT_SETTINGS, ...args], {
    cwd,
    stdio: 'pipe',
    windowsHide: true,
  });
}

/** A bare repo under `work` whose main holds the sample-site files, seeded as dev-remote.ts does. */
function seedRemote(work) {
  const remote = path.join(work, 'remote.git');
  const seed = path.join(work, 'seed');
  fs.mkdirSync(remote);
  git(remote, ['init', '--bare']);
  fs.cpSync(path.join(ROOT, 'sample-site'), seed, {
    recursive: true,
    filter: (source) => !NOT_COPIED.has(path.basename(source)),
  });
  git(seed, ['init']);
  git(seed, ['add', '--all']);
  git(seed, ['commit', '--message', 'seed: sample site']);
  git(seed, ['remote', 'add', 'origin', remote]);
  git(seed, ['push', 'origin', 'HEAD:main']);
  return remote;
}

function configText(remote, cmsPort, previewPort) {
  return `export default {
  site: '${SITE}',
  remote: ${JSON.stringify(pathToFileURL(remote).href)},
  previewSiteConfig: 'preview-render-server/${SITE_CONFIG}',
  origins: {
    cms: 'http://127.0.0.1:${cmsPort}',
    preview: 'http://127.0.0.1:${previewPort}',
  },
};
`;
}

function rssBytes(pid) {
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Process -Id ${pid}).WorkingSet64`,
      ],
      { encoding: 'utf8' },
    );
    const bytes = Number.parseInt(ps.stdout.trim(), 10);
    if (!Number.isFinite(bytes))
      throw new Error(`no working set for ${pid}: ${ps.stderr}`);
    return bytes;
  }
  if (process.platform === 'linux') {
    const line = fs
      .readFileSync(`/proc/${pid}/status`, 'utf8')
      .split('\n')
      .find((text) => text.startsWith('VmRSS:'));
    if (line === undefined) throw new Error(`no VmRSS for ${pid}`);
    return Number.parseInt(line.split(/\s+/)[1], 10) * 1024;
  }
  throw new Error(`rss is not read on ${process.platform}`);
}

function privateBytes(pid) {
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess=${pid}").WorkingSetPrivate`,
      ],
      { encoding: 'utf8' },
    );
    const bytes = Number.parseInt(ps.stdout.trim(), 10);
    if (!Number.isFinite(bytes))
      throw new Error(`no private working set for ${pid}: ${ps.stderr}`);
    return bytes;
  }
  if (process.platform === 'linux') {
    const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const kb = rollup
      .split('\n')
      .filter((line) => /^Private_(Clean|Dirty):/.test(line))
      .reduce(
        (sum, line) => sum + Number.parseInt(line.split(/\s+/)[1], 10),
        0,
      );
    return kb * 1024;
  }
  throw new Error(`private memory is not read on ${process.platform}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForListening(port, server, output, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`server exited:\n${output()}`);
    const up = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (up) return;
    await sleep(200);
  }
  throw new Error(`server did not listen within ${timeoutMs} ms:\n${output()}`);
}

/** Waits until /api/status names a bundle. Without one it still answers 200, with `bundle: null`. */
async function waitForBundle(base, output, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = JSON.parse(await ask(`${base}/api/status`));
    if (status.bundle !== null) return;
    await sleep(200);
  }
  throw new Error(`cms-server did not load a bundle:\n${output()}`);
}

/** The text of a request that must answer 200. Throws with the answer otherwise. */
async function ask(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `${init?.method ?? 'GET'} ${url} answered ${res.status}: ${text}`,
    );
  return text;
}

/** Stops cms-server by closing its stdin (2.1i), and kills it when it does not exit in 10 s. */
async function stop(server) {
  if (server.exitCode !== null) return;
  server.stdin.end();
  const exit = new Promise((resolve) => server.once('exit', resolve));
  await Promise.race([exit, sleep(10_000)]);
  if (server.exitCode === null) server.kill();
}

async function measure(stage, pid) {
  return { stage, rss: rssBytes(pid), private: privateBytes(pid) };
}

// The run writes this file and deletes it afterwards, so it must not already exist: a file of that name is someone's.
if (fs.existsSync(CONFIG_FILE))
  throw new Error(`${CONFIG_FILE} exists; move it before the run`);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-memory-'));
// The bundle sits under preview-render-server/.build, as in measure-memory.mjs: its modules resolve packages from there.
const bundleRoot = path.join(PREVIEW_DIR, '.build');
fs.mkdirSync(bundleRoot, { recursive: true });
const bundleDir = fs.mkdtempSync(path.join(bundleRoot, 'cms-memory-'));
const env = { ...process.env };
for (const name of AGENT_VARS) delete env[name];

let server;
try {
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  const remote = seedRemote(work);
  const build = spawnSync(process.execPath, ['src/build.ts', SITE_CONFIG], {
    cwd: PREVIEW_DIR,
    env: { ...env, PREVIEW_BUILD_DIR: bundleDir },
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (build.status !== 0)
    throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);

  const cmsPort = await freePort();
  const previewPort = await freePort();
  fs.writeFileSync(
    CONFIG_FILE,
    configText(remote, cmsPort, previewPort),
    'utf8',
  );
  let output = '';
  server = spawn(
    process.execPath,
    // The build writes <bundleDir>/sample-site, whose manifest/ holds the bundle files (bundle.json among them).
    [
      'src/main.ts',
      CONFIG_FILE,
      '--bundle',
      path.join(bundleDir, 'sample-site'),
    ],
    {
      cwd: SERVER_DIR,
      // The preview node is a child of cms-server and inherits this: it serves without the gate and without
      // secrets. That is for this local measurement only (as local-insecure.env says for npm run start:sample).
      env: { ...env, PREVIEW_INSECURE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'], // the node exits when its stdin closes (2.1i): keep the pipe open
    },
  );
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  await waitForListening(cmsPort, server, () => output);

  const base = `http://127.0.0.1:${cmsPort}`;
  await waitForBundle(base, () => output);
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
} finally {
  if (server !== undefined) await stop(server);
  fs.rmSync(CONFIG_FILE, { force: true });
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(bundleDir, { recursive: true, force: true });
}
