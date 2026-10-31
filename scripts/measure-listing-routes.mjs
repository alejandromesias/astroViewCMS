// Listing-route tripwire for the D7 cache decision (WORKPLAN task 1.8a item 5).
// Not a gate: run it by hand before phase 3 and whenever posts per tag grow.
// Copies sample-site to a temporary folder outside the repo, writes 200 generated
// posts there, builds and starts the preview server on the copy, then renders
// /blog/page/2 and /tags/design after warm-up. Prints the median render (the
// JSON renderMs) and the share of it spent in getStaticPaths (the Server-Timing
// `paths` value). Flags a page whose median render is over 15 ms. The temporary
// folder is deleted at the end; the repo's sample-site is not touched.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'preview-render-server');
const SAMPLE_DIR = path.join(ROOT, 'sample-site');
const POSTS = 200;
const RENDERS = 50;
const PAGES = ['/blog/page/2', '/tags/design'];
const FLAG_MS = 15;
// Astro sends `astro` commands to the background when it detects an AI agent;
// clear those markers for the child processes (as measure-memory.mjs does).
const AGENT_VARS = [
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_AGENT_SDK_VERSION',
];
// The same build-time fields as preview-render-server/sites/sample-site.config.ts.
const BUILD_TIME_FIELDS = {
  'data:src/config/config.json': ['site.base_url', 'site.base_path', 'site.trailing_slash'],
  'data:src/config/theme.json': ['*'],
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
    if (server.exitCode !== null) throw new Error(`server exited:\n${output()}`);
    const up = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (up) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server did not listen within ${timeoutMs} ms:\n${output()}`);
}

async function renderOnce(baseUrl, pathname) {
  const res = await fetch(`${baseUrl}/__preview/render?path=${encodeURIComponent(pathname)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ documents: {} }),
  });
  if (res.status !== 200) throw new Error(`${pathname} answered ${res.status}`);
  const body = await res.json();
  const paths = Number(/paths;dur=([\d.]+)/.exec(res.headers.get('server-timing') ?? '')?.[1]);
  if (!Number.isFinite(paths)) throw new Error(`${pathname} has no Server-Timing paths value`);
  return { render: body.renderMs, paths };
}

// The copy and the build output sit outside the repo, so they have no node_modules
// of their own. A junction at the work folder's root serves both: Node looks up
// parent folders (no admin rights needed on Windows).
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'listing-'));
const copyDir = path.join(workDir, 'sample-site');
const buildDir = path.join(workDir, 'build');
const modulesLink = path.join(workDir, 'node_modules');
const env = { ...process.env, PREVIEW_BUILD_DIR: buildDir };
for (const name of AGENT_VARS) delete env[name];

let server;
try {
  fs.cpSync(SAMPLE_DIR, copyDir, {
    recursive: true,
    filter: (src) => !['node_modules', 'dist', '.astro'].includes(path.basename(src)),
  });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), modulesLink, 'junction');

  const configFile = path.join(workDir, 'site.config.mjs');
  fs.writeFileSync(
    configFile,
    `export default ${JSON.stringify({ root: copyDir, regions: {}, buildTimeFields: BUILD_TIME_FIELDS, port: 4401 })};\n`,
  );

  const generated = spawnSync(process.execPath, ['scripts/generate-posts.mjs', String(POSTS)], {
    cwd: copyDir,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (generated.status !== 0) throw new Error(`generate-posts failed:\n${generated.stderr}`);

  const build = spawnSync(process.execPath, ['src/build.ts', configFile], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (build.status !== 0) throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);

  const port = await freePort();
  let output = '';
  server = spawn(process.execPath, ['src/start.ts', configFile], {
    cwd: SERVER_DIR,
    env: { ...env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  await waitForListening(port, server, () => output);

  const baseUrl = `http://127.0.0.1:${port}`;
  const warm = await fetch(`${baseUrl}/__preview/warm`, { method: 'POST' });
  if (!warm.ok) throw new Error(`warm-up answered ${warm.status}`);

  const rows = [];
  for (const pathname of PAGES) {
    await renderOnce(baseUrl, pathname); // first render is untimed (cold paths, 20 ms in D7)
    const samples = [];
    for (let i = 0; i < RENDERS; i++) samples.push(await renderOnce(baseUrl, pathname));
    const renderMedian = median(samples.map((s) => s.render));
    const pathsMedian = median(samples.map((s) => s.paths));
    rows.push({ pathname, renderMedian, pathsMedian });
  }

  console.log(`${POSTS} posts, ${RENDERS} renders per page after warm-up, ${process.platform}`);
  console.log('page'.padEnd(16), 'render ms'.padStart(10), 'paths ms'.padStart(10), 'paths share'.padStart(12));
  for (const row of rows) {
    console.log(
      row.pathname.padEnd(16),
      row.renderMedian.toFixed(1).padStart(10),
      row.pathsMedian.toFixed(1).padStart(10),
      `${((100 * row.pathsMedian) / row.renderMedian).toFixed(0)}%`.padStart(12),
    );
  }
  const flagged = rows.filter((row) => row.renderMedian > FLAG_MS).map((row) => row.pathname);
  console.log(
    flagged.length > 0
      ? `FLAG: median render over ${FLAG_MS} ms: ${flagged.join(', ')} (D7: cache the paths)`
      : `No page over ${FLAG_MS} ms median render.`,
  );
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  // Remove the junction alone first, so the recursive delete never follows it into the repo.
  if (fs.existsSync(modulesLink)) fs.rmdirSync(modulesLink);
  fs.rmSync(workDir, { recursive: true, force: true });
}
