// Helpers of the cms-server measurements (WORKPLAN 2.13a, 2.13e). Not a gate. measure-cms-memory.mjs and
// measure-cms-publish.mjs start cms-server, read its status and read the memory of its process through these.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SERVER_DIR = path.join(ROOT, 'cms-server');
export const PREVIEW_DIR = path.join(ROOT, 'preview-render-server');
export const SITE_CONFIG = 'sites/sample-site.config.ts';
export const MB = 1024 * 1024;
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

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The environment of a child process: this one's, without the agent markers, plus `extra`. */
export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const name of AGENT_VARS) delete env[name];
  return env;
}

export function git(cwd, args) {
  execFileSync('git', [...GIT_SETTINGS, ...args], {
    cwd,
    stdio: 'pipe',
    windowsHide: true,
  });
}

/** A bare repo under `work` whose main holds the sample-site files, seeded as dev-remote.ts does. */
export function seedRemote(work) {
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

/** The CMS config file of a measurement. `publish` sets `publish.buildCheck` when given. */
export function configText({ site, remote, cmsPort, previewPort, publish }) {
  const publishLine =
    publish === undefined ? '' : `  publish: { buildCheck: '${publish}' },\n`;
  return `export default {
  site: '${site}',
  remote: ${JSON.stringify(pathToFileURL(remote).href)},
  previewSiteConfig: 'preview-render-server/${SITE_CONFIG}',
  origins: {
    cms: 'http://127.0.0.1:${cmsPort}',
    preview: 'http://127.0.0.1:${previewPort}',
  },
${publishLine}};
`;
}

export function rssBytes(pid) {
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

export function privateBytes(pid) {
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

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function waitForListening(
  port,
  server,
  output,
  timeoutMs = 20_000,
) {
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

/** Waits until /api/status names a bundle. Without one the status still answers 200, with `bundle: null`. */
export async function waitForBundle(base, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = JSON.parse(await ask(`${base}/api/status`));
    if (status.bundle !== null) return;
    await sleep(200);
  }
  throw new Error(`cms-server did not load a bundle:\n${output()}`);
}

/** Waits until /api/status names a bundle and its node is ready. Without a bundle the status still answers 200. */
export async function waitForReady(base, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = JSON.parse(await ask(`${base}/api/status`));
    if (status.bundle !== null && status.node?.state === 'ready') return;
    await sleep(200);
  }
  throw new Error(`cms-server did not get a ready node:\n${output()}`);
}

/** The text of a request that must answer 200. Throws with the answer otherwise. */
export async function ask(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `${init?.method ?? 'GET'} ${url} answered ${res.status}: ${text}`,
    );
  return text;
}

/** Stops cms-server by closing its stdin (2.1i), and kills it when it does not exit in 10 s. */
export async function stop(server) {
  if (server.exitCode !== null) return;
  server.stdin.end();
  const exit = new Promise((resolve) => server.once('exit', resolve));
  await Promise.race([exit, sleep(10_000)]);
  if (server.exitCode === null) server.kill();
}

/**
 * Starts cms-server from the CMS config `configFile` (and `extra` arguments) in its folder. The preview node is a child
 * of cms-server and inherits PREVIEW_INSECURE: it serves without the gate and without secrets. That is for this local
 * measurement only (as local-insecure.env says for npm run start:sample). stdio is piped: the node exits when its stdin
 * closes (2.1i), so the pipe stays open.
 */
export function startCms(configFile, extra = []) {
  let output = '';
  const server = spawn(
    process.execPath,
    ['src/main.ts', configFile, ...extra],
    {
      cwd: SERVER_DIR,
      env: childEnv({ PREVIEW_INSECURE: '1' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  return { server, output: () => output };
}

/** Fails loudly when a file the run writes already exists: a file of that name is someone's. */
export function claimConfigFile(file) {
  if (fs.existsSync(file))
    throw new Error(`${file} exists; move it before the run`);
}
