// End-to-end (WORKPLAN 2.1i): run() starts the CMS on a harness repo and the sample-site bundle that
// global-setup builds, with the real preview node. The CMS answers /api/status, /api/schema and /, the node
// answers the bundle's bundleId, and stop() frees both ports. The config is injected (loadConfig), because
// the schema refuses the `..` that a config folder under cms-server needs to reach preview-render-server.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  bundleJsonSchema,
  type PreviewConfig,
  previewConfigSchema,
} from 'preview-contract';
import { describe, expect, inject, it, vi } from 'vitest';
import { type CmsConfig, parseConfig } from '../../src/config/schema.ts';
import { type Running, realDeps, run } from '../../src/run.ts';
import { makeTestRoot, removeTestRoot, seedRemote } from '../helpers/git.ts';

const CMS_DIR = path.resolve(import.meta.dirname, '../..');
const RENDERER_DIR = path.resolve(CMS_DIR, '../preview-render-server');
const BUNDLE = inject('bundleDir');

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

/** True when nothing listens on the port: a listen on it succeeds. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

/** Reads and parses a JSON file of the bundle. */
function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('run() with the real parts', () => {
  it('serves the CMS and the preview node on their ports, and stop() frees both', async () => {
    const root = await makeTestRoot();
    const configPath = path.join(root, 'cms.config.ts');
    const identity = bundleJsonSchema.parse(
      readJson(path.join(BUNDLE, 'manifest', 'bundle.json')),
    );
    const schemaNames = Object.keys(
      readJson(path.join(BUNDLE, 'manifest', 'schema.json')) as object,
    ).sort();
    const cmsPort = await freePort();
    const previewPort = await freePort();
    const cmsOrigin = `http://127.0.0.1:${cmsPort}`;
    const previewOrigin = `http://127.0.0.1:${previewPort}`;
    const config: CmsConfig = parseConfig({
      site: 'sample-site',
      remote: await seedRemote(root),
      previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
      origins: { cms: cmsOrigin, preview: previewOrigin },
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let running: Running | undefined;
    try {
      // The config's own previewSiteConfig is a relative path the schema allows only inside the config's folder.
      running = await run(
        ['--bundle', BUNDLE, configPath],
        {},
        {
          ...realDeps,
          loadConfig: () =>
            Promise.resolve({
              ...config,
              previewSiteConfig: path.join(
                RENDERER_DIR,
                'sites',
                'sample-site.config.ts',
              ),
            }),
          logger,
        },
      );
      expect(logger.info).toHaveBeenCalledWith('cms started', {
        cms: cmsOrigin,
        preview: previewOrigin,
        cmsPort,
        previewPort,
        bundle: identity.bundleId,
        previewState: 'ready',
        recovered: false,
      });

      const status = await fetch(`${cmsOrigin}/api/status`);
      expect(status.status).toBe(200);
      // The bundle key, and the preview status beside it (2.9c). With --bundle the builder is off; the node serves the bundle.
      expect(await status.json()).toStrictEqual({
        bundle: {
          bundleId: identity.bundleId,
          siteCommit: identity.siteCommit,
        },
        builder: 'off',
        build: { state: 'off', error: null, failedCommit: null },
        node: { state: 'ready', bundleId: identity.bundleId, error: null },
        lastSync: null,
        syncError: null,
        renamed: [],
        changesetSize: 0,
        publish: 'idle',
        errors: {
          protocolMismatch: null,
          upstreamBuildFailed: null,
          swap: null,
        },
      });

      const schema = await fetch(`${cmsOrigin}/api/schema`);
      expect(schema.status).toBe(200);
      const { collections } = (await schema.json()) as {
        collections: { name: string }[];
      };
      expect(collections.map((item) => item.name).sort()).toEqual(schemaNames);

      const page = await fetch(`${cmsOrigin}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toBe(
        fs.readFileSync(path.join(CMS_DIR, 'editor', 'index.html'), 'utf8'),
      );

      const secrets = readJson(
        path.join(root, '.cms', 'sample-site', 'secrets.json'),
      ) as { previewInternalSecret: string };
      const node = await fetch(`${previewOrigin}/__preview/config`, {
        headers: {
          Authorization: `Bearer ${secrets.previewInternalSecret}`,
        },
      });
      expect(node.status).toBe(200);
      const nodeConfig: PreviewConfig = previewConfigSchema.parse(
        await node.json(),
      );
      expect(nodeConfig).toEqual({
        editorOrigins: [cmsOrigin],
        bundleId: identity.bundleId,
        protocolVersion: expect.any(Number) as number,
      });
      expect(running.supervisor.status()).toMatchObject({
        state: 'ready',
        port: previewPort,
        bundleId: identity.bundleId,
      });

      await running.stop();
      expect(running.server.listening).toBe(false);
      await expect(fetch(`${cmsOrigin}/`)).rejects.toThrow();
      await expect(
        fetch(`${previewOrigin}/__preview/config`),
      ).rejects.toThrow();
      expect(running.supervisor.status().state).toBe('stopped');
      expect(await portIsFree(cmsPort)).toBe(true);
      expect(await portIsFree(previewPort)).toBe(true);
    } finally {
      await running?.stop();
      await removeTestRoot(root);
    }
  }, 180_000);

  it('checks a save with the real node: a valid create is written, and an invalid one answers 422 with the node errors', async () => {
    const root = await makeTestRoot();
    const configPath = path.join(root, 'cms.config.ts');
    const cmsPort = await freePort();
    const previewPort = await freePort();
    const cmsOrigin = `http://127.0.0.1:${cmsPort}`;
    const config: CmsConfig = parseConfig({
      site: 'sample-site',
      remote: await seedRemote(root),
      previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
      origins: { cms: cmsOrigin, preview: `http://127.0.0.1:${previewPort}` },
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let running: Running | undefined;
    try {
      running = await run(
        ['--bundle', BUNDLE, configPath],
        {},
        {
          ...realDeps,
          loadConfig: () =>
            Promise.resolve({
              ...config,
              previewSiteConfig: path.join(
                RENDERER_DIR,
                'sites',
                'sample-site.config.ts',
              ),
            }),
          logger,
        },
      );
      const save = (changes: unknown[]) =>
        fetch(`${cmsOrigin}/api/changes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes }),
        });

      // The real node checks the values with the sample site's schema, and the save answers 200.
      const valid = await save([
        {
          document: 'authors/e2e-new',
          baseRevision: null,
          deleted: false,
          data: {
            name: 'E2E Author',
            role: 'Tester',
            bio: 'Written by the end-to-end test.',
            avatar: '../../assets/authors/ana-torres.png',
          },
        },
      ]);
      expect(valid.status).toBe(200);
      expect(await valid.json()).toStrictEqual({
        revisions: { 'authors/e2e-new': expect.any(String) as string },
        warnings: [],
        rebuild: false,
      });

      // The node's 422 is the answer of the save, with the errors of the node.
      const invalid = await save([
        {
          document: 'authors/e2e-bad',
          baseRevision: null,
          deleted: false,
          data: { name: 'No role' },
        },
      ]);
      expect(invalid.status).toBe(422);
      expect(await invalid.json()).toStrictEqual({
        error: 'invalid',
        errors: [
          {
            key: 'authors/e2e-bad',
            path: ['role'],
            message: 'Invalid input: expected string, received undefined',
          },
          {
            key: 'authors/e2e-bad',
            path: ['bio'],
            message: 'Invalid input: expected string, received undefined',
          },
          {
            key: 'authors/e2e-bad',
            path: ['avatar'],
            message: 'Invalid input: expected string, received undefined',
          },
        ],
      });

      // The valid create is the one changed file of the working copy.
      const status = (await (
        await fetch(`${cmsOrigin}/api/status`)
      ).json()) as {
        changesetSize: number;
      };
      expect(status.changesetSize).toBe(1);
    } finally {
      await running?.stop();
      await removeTestRoot(root);
    }
  }, 180_000);
});
