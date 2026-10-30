// Builds a site for preview into a temporary folder, starts the real server on
// a free port and returns its URL. Shared by the end-to-end and browser suites
// (their global setups pick the site config). The usual .build/<site> output
// and a server already running on the usual port are left alone.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const SERVER_DIR = path.resolve(import.meta.dirname, '../..');
// Astro 7 sends `astro` commands to the background when it detects an AI
// agent (see HANDOFF environment notes); clear those markers for children.
const AGENT_VARS = [
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_AGENT_SDK_VERSION',
];

export interface PreviewServer {
  baseUrl: string;
  buildDir: string;
  stop(): Promise<void>;
}

/** `siteConfig` is relative to the preview-render-server folder. */
export async function startPreviewServer(
  siteConfig: string,
): Promise<PreviewServer> {
  // Inside the workspace, not the OS temp folder: the build resolves its npm
  // packages from node_modules, during prerendering and at runtime.
  fs.mkdirSync(path.join(SERVER_DIR, '.build'), { recursive: true });
  const buildDir = fs.mkdtempSync(path.join(SERVER_DIR, '.build', 'e2e-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PREVIEW_BUILD_DIR: buildDir,
    PREVIEW_DEV: '1',
  };
  for (const name of AGENT_VARS) delete env[name];

  const build = spawnSync(process.execPath, ['src/build.ts', siteConfig], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: 180_000,
  });
  if (build.status !== 0) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    throw new Error(
      `Preview build failed (${build.status}):\n${build.stdout}\n${build.stderr}`,
    );
  }

  const port = await freePort();
  // --expose-gc lets /__dev/memory force a GC before it reports (step 7c).
  const server = spawn(
    process.execPath,
    ['--expose-gc', 'src/start.ts', siteConfig],
    {
      cwd: SERVER_DIR,
      env: { ...env, HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  server.stdout?.on('data', (chunk) => (output += chunk));
  server.stderr?.on('data', (chunk) => (output += chunk));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, server, () => output);
  return {
    baseUrl,
    buildDir,
    stop: async () => {
      server.kill();
      fs.rmSync(buildDir, { recursive: true, force: true });
    },
  };
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

async function waitForServer(
  baseUrl: string,
  server: ChildProcess,
  output: () => string,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Preview server exited:\n${output()}`);
    try {
      await fetch(baseUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  server.kill();
  throw new Error(
    `Preview server did not start within ${timeoutMs} ms:\n${output()}`,
  );
}
