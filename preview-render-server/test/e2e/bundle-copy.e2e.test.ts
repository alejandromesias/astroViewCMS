// Portability (2.0d): the sample-site bundle is copied to another folder and
// started from there as its own node. The render, validate and warm routes
// must answer, which they can only do if the manifests and uploads are found
// relative to the copy. The copy stays inside the workspace, because the bundle
// resolves its packages from node_modules.
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import {
  childEnv,
  freePort,
  SERVER_DIR,
  waitForServer,
} from '../support/preview-server.ts';

/** Starts the front server (src/start.ts) on `port` against the copied bundle
 *  folder (--out), as a node run by hand. Returns the child and its base URL. */
async function startEntry(
  bundle: string,
  port: number,
): Promise<{ child: ChildProcess; baseUrl: string }> {
  const child = spawn(
    process.execPath,
    ['src/start.ts', 'sites/sample-site.config.ts', '--out', bundle],
    {
      cwd: SERVER_DIR,
      env: childEnv({
        HOST: '127.0.0.1',
        PORT: String(port),
        PREVIEW_INSECURE: '1',
      }),
      // stdin stays a pipe: start.ts exits when it closes (stdin-exit.ts).
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child, () => output);
  return { child, baseUrl };
}

describe('a copied bundle, started from another folder', () => {
  it('answers the render, validate and warm routes', async () => {
    const source = path.join(inject('buildDir'), 'sample-site');
    fs.mkdirSync(path.join(SERVER_DIR, '.build'), { recursive: true });
    const work = fs.mkdtempSync(
      path.join(SERVER_DIR, '.build', 'bundle-copy-'),
    );
    const copy = path.join(work, 'copied-bundle');
    let child: ChildProcess | undefined;
    try {
      fs.cpSync(source, copy, { recursive: true });
      const started = await startEntry(copy, await freePort());
      child = started.child;
      const { baseUrl } = started;

      expect((await fetch(`${baseUrl}/`)).status).toBe(200);

      const render = await fetch(`${baseUrl}/__preview/render?path=/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documents: {} }),
      });
      expect(render.status).toBe(200);
      expect(await render.json()).toMatchObject({ limits: [] });

      const validate = await fetch(`${baseUrl}/__preview/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documents: {} }),
      });
      expect(validate.status).toBe(200);
      expect(await validate.json()).toEqual({ valid: true });

      const warm = await fetch(`${baseUrl}/__preview/warm`, { method: 'POST' });
      expect(warm.status).toBe(204);
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child?.once('exit', resolve));
        child.kill();
        await exited;
      }
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);
});
