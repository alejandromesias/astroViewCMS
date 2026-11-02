// Two builds of the sample site, each into its own folder (--out), and each
// folder started as a node on its own port (--port). The two nodes run at the
// same time and both must answer. Builds run one after the other to keep
// memory low. Helpers come from test/support/preview-server.ts.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  childEnv,
  freePort,
  SERVER_DIR,
  waitForServer,
} from '../support/preview-server.ts';

const SITE_CONFIG = 'sites/sample-site.config.ts';

/** Builds the sample site into `outDir`. Throws with the build's output when
 *  the build fails. */
function buildInto(outDir: string): void {
  const build = spawnSync(
    process.execPath,
    ['src/build.ts', SITE_CONFIG, '--out', outDir],
    { cwd: SERVER_DIR, env: childEnv(), encoding: 'utf8', timeout: 180_000 },
  );
  if (build.status !== 0) {
    throw new Error(
      `Build into ${outDir} failed (${build.status}):\n${build.stdout}\n${build.stderr}`,
    );
  }
}

/** Starts start.ts on the build in `outDir`, on `port`, and waits until it
 *  answers. Returns the child so the test can stop it. */
async function startNode(outDir: string, port: number): Promise<ChildProcess> {
  const server = spawn(
    process.execPath,
    ['src/start.ts', SITE_CONFIG, '--out', outDir, '--port', String(port)],
    {
      cwd: SERVER_DIR,
      env: childEnv({ HOST: '127.0.0.1', PREVIEW_INSECURE: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  server.stdout?.on('data', (chunk) => (output += chunk));
  server.stderr?.on('data', (chunk) => (output += chunk));
  await waitForServer(`http://127.0.0.1:${port}`, server, () => output);
  return server;
}

/** Stops a child process and resolves once it has exited, so its files are
 *  released before the folder is removed. */
async function stopNode(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await exited;
}

/** Returns the HTTP status of a GET to `url`, reading the body so the
 *  connection is released. */
async function statusOf(url: string): Promise<number> {
  const response = await fetch(url);
  await response.text();
  return response.status;
}

describe('two nodes side by side', () => {
  it('builds the sample site into two folders and serves each on its own port', async () => {
    fs.mkdirSync(path.join(SERVER_DIR, '.build'), { recursive: true });
    const work = fs.mkdtempSync(
      path.join(SERVER_DIR, '.build', 'side-by-side-'),
    );
    const outA = path.join(work, 'node-a');
    const outB = path.join(work, 'node-b');
    const nodes: ChildProcess[] = [];
    try {
      buildInto(outA);
      buildInto(outB);
      // Each output carries its own manifest folder, not a shared one.
      expect(fs.existsSync(path.join(outA, 'manifest', 'routes.json'))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(outB, 'manifest', 'routes.json'))).toBe(
        true,
      );

      const portA = await freePort();
      const portB = await freePort();
      nodes.push(await startNode(outA, portA));
      nodes.push(await startNode(outB, portB));

      expect([
        await statusOf(`http://127.0.0.1:${portA}/`),
        await statusOf(`http://127.0.0.1:${portB}/`),
      ]).toEqual([200, 200]);
    } finally {
      for (const node of nodes) await stopNode(node);
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 600_000);
});
