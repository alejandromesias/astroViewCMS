// End-to-end (WORKPLAN 2.9b): the supervisor starts the real preview node (start.ts) on
// one port and swaps it to a second bundle. The second bundle is a copy of the built one
// whose bundle.json names another bundleId, so the answer on the port must show that id.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  bundleJsonSchema,
  type PreviewConfig,
  previewConfigSchema,
} from 'preview-contract';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createSupervisor,
  type Supervisor,
} from '../../src/preview/supervisor.ts';

const CMS_DIR = path.resolve(import.meta.dirname, '../..');
const RENDERER_DIR = path.resolve(CMS_DIR, '../preview-render-server');
const BUNDLE_A = inject('bundleDir');
const BUNDLE_B = path.join(path.dirname(BUNDLE_A), 'bundle-swapped');

/** The bundleId that a bundle's own bundle.json names. */
function bundleIdOf(dir: string): string {
  const json: unknown = JSON.parse(
    fs.readFileSync(path.join(dir, 'manifest', 'bundle.json'), 'utf8'),
  );
  return bundleJsonSchema.parse(json).bundleId;
}

/** A port that is free right now on 127.0.0.1. */
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

describe('the supervisor with the real preview node', () => {
  const secrets = {
    previewTokenSecret: randomBytes(32).toString('hex'),
    previewInternalSecret: randomBytes(32).toString('hex'),
  };
  let port = 0;
  let supervisor: Supervisor | undefined;

  /** GET /__preview/config on the port, with the internal bearer. */
  async function config(): Promise<PreviewConfig> {
    const response = await fetch(`http://127.0.0.1:${port}/__preview/config`, {
      headers: { Authorization: `Bearer ${secrets.previewInternalSecret}` },
    });
    expect(response.status).toBe(200);
    return previewConfigSchema.parse(await response.json());
  }

  beforeAll(async () => {
    port = await freePort();
    fs.cpSync(BUNDLE_A, BUNDLE_B, { recursive: true });
    const file = path.join(BUNDLE_B, 'manifest', 'bundle.json');
    const json: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...bundleJsonSchema.parse(json), bundleId: 'e2e-swapped' }, null, 2)}\n`,
    );
    supervisor = createSupervisor({
      port,
      site: 'sample-site',
      editorOrigin: 'https://cms.example',
      secrets,
      siteConfig: path.join(RENDERER_DIR, 'sites/sample-site.config.ts'),
      readyTimeoutMs: 60_000,
    });
  });

  afterAll(async () => {
    await supervisor?.stop();
  });

  it('starts the first bundle, and the port answers its bundleId', async () => {
    const first = { bundleId: bundleIdOf(BUNDLE_A), dir: BUNDLE_A };
    expect(await supervisor?.start(first)).toEqual({ ok: true });
    expect(await config()).toEqual({
      editorOrigins: ['https://cms.example'],
      bundleId: first.bundleId,
      protocolVersion: expect.any(Number) as number,
    });
    expect(supervisor?.status()).toMatchObject({
      state: 'ready',
      port,
      bundleId: first.bundleId,
      failures: 0,
    });
  });

  it('refuses a request without the internal bearer (the gate is on)', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/__preview/config`);
    expect(response.status).toBe(401);
  });

  it("swaps to the second bundle on the same port, and the port answers that bundle's bundleId", async () => {
    const second = { bundleId: bundleIdOf(BUNDLE_B), dir: BUNDLE_B };
    expect(second.bundleId).toBe('e2e-swapped');
    expect(await supervisor?.swap(second)).toEqual({ ok: true });
    expect((await config()).bundleId).toBe(second.bundleId);
    expect(supervisor?.status()).toMatchObject({
      state: 'ready',
      port,
      bundleId: second.bundleId,
    });
  });

  it('stop() takes the node down, and the port answers nothing', async () => {
    await supervisor?.stop();
    await expect(
      fetch(`http://127.0.0.1:${port}/__preview/config`),
    ).rejects.toThrow();
    expect(supervisor?.status().state).toBe('stopped');
  });
});
