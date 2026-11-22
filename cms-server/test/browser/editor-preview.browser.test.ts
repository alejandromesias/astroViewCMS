// Browser (WORKPLAN 2.12b, rows R1 and R7). Chromium opens the real editor on cms.localhost; the editor's iframe is the
// preview on preview.localhost. Two host names, so the preview cookie is the preview's own (PHASE-2-DESIGN 5.7). Node
// runs the test and drives Chromium with Playwright, the one the workspace already has (preview-render-server's devDependency).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Frame,
  type Page,
} from 'playwright';
import { bundleJsonSchema } from 'preview-contract';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { type CmsConfig, parseConfig } from '../../src/config/schema.ts';
import { type Running, realDeps, run } from '../../src/run.ts';
import { makeTestRoot, removeTestRoot, seedRemote } from '../helpers/git.ts';

const CMS_DIR = path.resolve(import.meta.dirname, '../..');
const RENDERER_DIR = path.resolve(CMS_DIR, '../preview-render-server');
const BUNDLE = inject('bundleDir');
// The page the editor opens: its author card is the author document, and its title is the post document.
const PAGE = '/blog/blog-1';
const AUTHOR = 'authors/ana-torres';
const POST = 'blog/blog-1';
const DRAFT_NAME = 'Ana Draft';
const SAVED_NAME = 'Ana Saved';
const SAVED_TITLE = 'Saved Title For The Browser Test';

let browser: Browser | undefined;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

function browserOf(): Browser {
  if (browser === undefined) throw new Error('Chromium did not start');
  return browser;
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

interface Rig {
  readonly running: Running;
  readonly cmsOrigin: string;
  readonly previewOrigin: string;
}

/**
 * Starts the CMS on cms.localhost and its gated preview node on preview.localhost, from the built bundle (no build),
 * then runs `check`. Both are stopped, and the repo removed, whatever `check` does.
 */
async function withRig(check: (rig: Rig) => Promise<void>): Promise<void> {
  const root = await makeTestRoot();
  const configPath = path.join(root, 'cms.config.ts');
  const cmsOrigin = `http://cms.localhost:${await freePort()}`;
  const previewOrigin = `http://preview.localhost:${await freePort()}`;
  const config: CmsConfig = parseConfig({
    site: 'sample-site',
    remote: await seedRemote(root),
    previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
    origins: { cms: cmsOrigin, preview: previewOrigin },
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
    await check({ running, cmsOrigin, previewOrigin });
  } finally {
    await running?.stop();
    await removeTestRoot(root);
  }
}

/**
 * Waits until the editor reports that the preview of PAGE is open. "Page ready" is set on the iframe's first `ready`, and
 * the priming render replaces it with "Rendered" within milliseconds, so either line counts (a wait for one of them alone
 * can miss it on a quick render, as after a reload).
 */
async function waitForReady(page: Page): Promise<void> {
  await page
    .locator('#status')
    .filter({ hasText: /Page ready: \/blog\/blog-1|Rendered \/blog\/blog-1 / })
    .waitFor();
}

/** Opens the editor on the CMS origin at PAGE. Resolves once the preview has answered `ready`. */
async function openEditor(
  context: BrowserContext,
  cmsOrigin: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${cmsOrigin}/?page=${encodeURIComponent(PAGE)}`);
  await waitForReady(page);
  return page;
}

/** The editor's iframe, which holds the preview of PAGE. */
function previewFrameOf(page: Page, previewOrigin: string): Frame {
  const frame = page
    .frames()
    .find((item) => item.url() === `${previewOrigin}${PAGE}`);
  if (frame === undefined) throw new Error(`no preview frame at ${PAGE}`);
  return frame;
}

/** Types into a document's form: its JSON value, with `change` merged over the value the form holds now. */
async function editValue(
  page: Page,
  key: string,
  change: Record<string, unknown>,
): Promise<void> {
  const field = page.locator(
    `section.document[data-key="${key}"] textarea[data-field="value"]`,
  );
  await field.waitFor();
  const current = JSON.parse(await field.inputValue()) as Record<
    string,
    unknown
  >;
  await field.fill(JSON.stringify({ ...current, ...change }));
}

describe('the editor on the CMS origin drives the preview on its own origin', () => {
  it('the iframe fetches with the cookie of the token exchange, the same preview opened top-level answers 401, and a draft changes the preview', async () => {
    await withRig(async ({ cmsOrigin, previewOrigin }) => {
      const context = await browserOf().newContext();
      try {
        const page = await openEditor(context, cmsOrigin);
        const frame = previewFrameOf(page, previewOrigin);

        // The iframe's own request to the node's config route succeeds: the cookie came with the iframe's token exchange.
        const configStatus = await frame.evaluate(async () => {
          const response = await fetch('/__preview/config', {
            credentials: 'same-origin',
          });
          return response.status;
        });
        expect(configStatus).toBe(200);

        // The same preview, opened top-level on its own origin, has no cookie there: 401.
        const top = await context.newPage();
        const answer = await top.goto(`${previewOrigin}${PAGE}`);
        expect(answer?.status()).toBe(401);
        expect(await answer?.text()).toBe('Unauthorized');
        await top.close();

        // A draft typed into the form changes the preview, with no save.
        await editValue(page, AUTHOR, { name: DRAFT_NAME });
        await frame.getByText(DRAFT_NAME).first().waitFor();
      } finally {
        await context.close();
      }
    });
  }, 120_000);

  it('edits two documents, saves, reloads: the preview shows both saved values, with no rebuild', async () => {
    const identity = bundleJsonSchema.parse(
      JSON.parse(
        fs.readFileSync(path.join(BUNDLE, 'manifest', 'bundle.json'), 'utf8'),
      ),
    );
    await withRig(async ({ running, cmsOrigin, previewOrigin }) => {
      const context = await browserOf().newContext();
      try {
        const page = await openEditor(context, cmsOrigin);
        await editValue(page, AUTHOR, { name: SAVED_NAME });
        await editValue(page, POST, { title: SAVED_TITLE });
        const frame = previewFrameOf(page, previewOrigin);
        await frame.getByText(SAVED_NAME).first().waitFor();
        await frame.getByText(SAVED_TITLE).first().waitFor();

        // Save: one request, answered 200 with both revisions and no rebuild.
        const put = page.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' &&
            response.url() === `${cmsOrigin}/api/changes`,
        );
        await page.locator('#save').click();
        const saved = await put;
        expect(saved.status()).toBe(200);
        expect(await saved.json()).toStrictEqual({
          revisions: {
            [AUTHOR]: expect.any(String) as string,
            [POST]: expect.any(String) as string,
          },
          warnings: [],
          rebuild: false,
        });
        expect(running.supervisor.status().bundleId).toBe(identity.bundleId);

        // Reload: the editor has no drafts now, so the saved values reach the preview through the overlay alone.
        await page.reload();
        await waitForReady(page);
        const reloaded = previewFrameOf(page, previewOrigin);
        await reloaded.getByText(SAVED_NAME).first().waitFor();
        await reloaded.getByText(SAVED_TITLE).first().waitFor();
      } finally {
        await context.close();
      }
    });
  }, 180_000);
});
