// Memory of one preview server process, for comparing runs by hand. Not a gate.
// Builds the default sample (sites/sample-site.config.ts) with PREVIEW_DEV=1,
// starts the server in its own process and reports rss and private memory at
// three points: idle (listening, no request), after warm-up (POST
// /__preview/warm), and after 100 renders of landing/home-v2 (the same edit
// pattern as the budget test). rss is process.memoryUsage().rss from
// /__dev/memory, as in the figures of SYSTEM-DESIGN.md. Private memory comes from
// the OS: the private working set on Windows, Private_Clean + Private_Dirty in
// /proc/<pid>/smaps_rollup on Linux. DOCS/QUALITY-TOOLING.md says how to run it.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'preview-render-server');
const SITE_CONFIG = 'sites/sample-site.config.ts';
const HOME = 'landing/home-v2';
const RENDERS = 100;
const MB = 1024 * 1024;
// Astro sends `astro` commands to the background when it detects an AI agent;
// clear those markers for the child processes (as test/support does).
const AGENT_VARS = [
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_AGENT_SDK_VERSION',
];

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
    if (!Number.isFinite(bytes)) throw new Error(`no private working set for ${pid}: ${ps.stderr}`);
    return bytes;
  }
  if (process.platform === 'linux') {
    const rollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const kb = rollup
      .split('\n')
      .filter((line) => /^Private_(Clean|Dirty):/.test(line))
      .reduce((sum, line) => sum + Number.parseInt(line.split(/\s+/)[1], 10), 0);
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

async function measure(stage, pid, baseUrl) {
  const dev = await (await fetch(`${baseUrl}/__dev/memory`)).json();
  return { stage, rss: dev.rss, private: privateBytes(pid) };
}

const buildRoot = path.join(SERVER_DIR, '.build');
fs.mkdirSync(buildRoot, { recursive: true });
const buildDir = fs.mkdtempSync(path.join(buildRoot, 'memory-'));
const env = { ...process.env, PREVIEW_BUILD_DIR: buildDir, PREVIEW_DEV: '1' };
for (const name of AGENT_VARS) delete env[name];

let server;
try {
  const build = spawnSync(process.execPath, ['src/build.ts', SITE_CONFIG], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: 180_000,
  });
  if (build.status !== 0) throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);

  const port = await freePort();
  let output = '';
  server = spawn(process.execPath, ['--expose-gc', 'src/start.ts', SITE_CONFIG], {
    cwd: SERVER_DIR,
    env: { ...env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  await waitForListening(port, server, () => output);

  const baseUrl = `http://127.0.0.1:${port}`;
  const home = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'sample-site/src/content/landing/home-v2.json'), 'utf8'),
  );
  const rows = [await measure('idle', server.pid, baseUrl)];

  const warm = await fetch(`${baseUrl}/__preview/warm`, { method: 'POST' });
  if (!warm.ok) throw new Error(`warm-up answered ${warm.status}`);
  rows.push(await measure('after warm-up', server.pid, baseUrl));

  for (let i = 0; i < RENDERS; i++) {
    home.blocks[0].title = `Memory edit ${i}`;
    const res = await fetch(`${baseUrl}/__preview/render?path=${encodeURIComponent(`/${HOME}`)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: { [HOME]: home } }),
    });
    if (res.status !== 200) throw new Error(`render ${i} answered ${res.status}`);
    await res.text();
  }
  rows.push(await measure(`after ${RENDERS} renders`, server.pid, baseUrl));

  console.log(`preview server pid ${server.pid}, ${SITE_CONFIG}, ${process.platform}`);
  console.log('stage'.padEnd(20), 'rss MB'.padStart(8), 'private MB'.padStart(12));
  for (const row of rows) {
    console.log(
      row.stage.padEnd(20),
      (row.rss / MB).toFixed(1).padStart(8),
      (row.private / MB).toFixed(1).padStart(12),
    );
  }
} finally {
  server?.kill();
  fs.rmSync(buildDir, { recursive: true, force: true });
}
