// Builds sample-site with `npm run build`'s script into a temporary
// folder (.build/e2e-*, via PREVIEW_BUILD_DIR), starts `npm start`'s script on
// a free port and hands its URL to the tests. The usual .build/<site> output
// and a server already running on the usual port are left alone.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
    buildDir: string;
  }
}

const SERVER_DIR = path.resolve(import.meta.dirname, '../..');
const SITE_CONFIG = 'sites/sample-site.config.ts';
// Astro 7 sends `astro` commands to the background when it detects an AI
// agent (see HANDOFF environment notes); clear those markers for children.
const AGENT_VARS = ['AI_AGENT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_AGENT_SDK_VERSION'];

let server: ChildProcess | undefined;
let buildDir: string | undefined;

export async function setup(project: TestProject) {
  // Inside the workspace, not the OS temp folder: the build resolves its npm
  // packages from node_modules, during prerendering and at runtime.
  fs.mkdirSync(path.join(SERVER_DIR, '.build'), { recursive: true });
  buildDir = fs.mkdtempSync(path.join(SERVER_DIR, '.build', 'e2e-'));
  const env: NodeJS.ProcessEnv = { ...process.env, PREVIEW_BUILD_DIR: buildDir };
  for (const name of AGENT_VARS) delete env[name];

  const build = spawnSync(process.execPath, ['src/build.ts', SITE_CONFIG], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: 180_000,
  });
  if (build.status !== 0) {
    throw new Error(`Preview build failed (${build.status}):\n${build.stdout}\n${build.stderr}`);
  }

  const port = await freePort();
  server = spawn(process.execPath, ['src/start.ts', SITE_CONFIG], {
    cwd: SERVER_DIR,
    env: { ...env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout?.on('data', (chunk) => (output += chunk));
  server.stderr?.on('data', (chunk) => (output += chunk));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, () => output);
  project.provide('baseUrl', baseUrl);
  project.provide('buildDir', buildDir);
}

export async function teardown() {
  server?.kill();
  if (buildDir) fs.rmSync(buildDir, { recursive: true, force: true });
}

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

async function waitForServer(baseUrl: string, output: () => string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) throw new Error(`Preview server exited:\n${output()}`);
    try {
      await fetch(baseUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Preview server did not start within ${timeoutMs} ms:\n${output()}`);
}
