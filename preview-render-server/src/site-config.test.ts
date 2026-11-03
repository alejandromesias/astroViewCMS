import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertOutDirIsSafe,
  loadSiteConfig,
  resolveSiteConfig,
} from './site-config.ts';
import type { SiteConfig } from './types.ts';

const config: SiteConfig = {
  root: '../../my-site',
  regions: { blocks: { component: 'src/components/BlockList.astro' } },
  port: 4400,
};

describe('resolveSiteConfig', () => {
  const resolved = resolveSiteConfig(
    config,
    path.resolve('/work/server/sites'),
    path.resolve('/work/server/.build'),
  );

  it('resolves the site root against the config folder', () => {
    expect(resolved.root).toBe(path.resolve('/work/my-site'));
  });

  it('puts the output in .build, named after the site folder', () => {
    expect(resolved.outDir).toBe(path.resolve('/work/server/.build/my-site'));
    expect(resolved.regionsDir).toBe(
      path.resolve('/work/server/.build/my-site-regions'),
    );
  });

  it('puts the manifests and the upload folder inside the output (the bundle)', () => {
    expect(resolved.mediaDir).toBe(
      path.resolve('/work/server/.build/my-site/media'),
    );
    expect(resolved.manifestDir).toBe(
      path.resolve('/work/server/.build/my-site/manifest'),
    );
  });

  it('keeps the rest of the config', () => {
    expect(resolved.regions).toEqual(config.regions);
    expect(resolved.port).toBe(4400);
  });
});

describe('resolveSiteConfig with overrides', () => {
  it('replaces the root and the output, and puts the other folders next to the output', () => {
    const resolved = resolveSiteConfig(
      config,
      path.resolve('/work/server/sites'),
      path.resolve('/work/server/.build'),
      {
        root: path.resolve('/elsewhere/other-site'),
        out: path.resolve('/bundles/copy'),
      },
    );
    expect(resolved.root).toBe(path.resolve('/elsewhere/other-site'));
    expect(resolved.outDir).toBe(path.resolve('/bundles/copy'));
    expect(resolved.regionsDir).toBe(path.resolve('/bundles/copy-regions'));
    expect(resolved.mediaDir).toBe(path.resolve('/bundles/copy/media'));
    expect(resolved.manifestDir).toBe(path.resolve('/bundles/copy/manifest'));
  });

  it('names the default output after the overridden root', () => {
    const resolved = resolveSiteConfig(
      config,
      path.resolve('/work/server/sites'),
      path.resolve('/work/server/.build'),
      { root: path.resolve('/elsewhere/other-site') },
    );
    expect(resolved.outDir).toBe(
      path.resolve('/work/server/.build/other-site'),
    );
    expect(resolved.manifestDir).toBe(
      path.resolve('/work/server/.build/other-site/manifest'),
    );
  });

  it('keeps the config root when only the output is overridden', () => {
    const resolved = resolveSiteConfig(
      config,
      path.resolve('/work/server/sites'),
      path.resolve('/work/server/.build'),
      { out: path.resolve('/bundles/copy') },
    );
    expect(resolved.root).toBe(path.resolve('/work/my-site'));
    expect(resolved.outDir).toBe(path.resolve('/bundles/copy'));
  });

  it('resolves an overridden root against the current folder, not the config folder', () => {
    const resolved = resolveSiteConfig(
      config,
      path.resolve('/work/server/sites'),
      path.resolve('/work/server/.build'),
      { root: 'relative-site' },
    );
    expect(resolved.root).toBe(path.resolve('relative-site'));
  });

  it('keeps the config values that overrides do not touch', () => {
    const resolved = resolveSiteConfig(
      config,
      path.resolve('/work/server/sites'),
      path.resolve('/work/server/.build'),
      { out: path.resolve('/bundles/copy') },
    );
    expect(resolved.regions).toEqual(config.regions);
    expect(resolved.port).toBe(4400);
  });
});

describe('loadSiteConfig', () => {
  it('applies command-line overrides on top of the config file', async () => {
    const site = await loadSiteConfig(
      path.resolve(import.meta.dirname, '../sites/sample-site.config.ts'),
      path.resolve('/tmp/preview-e2e'),
      { out: path.resolve('/tmp/bundle-copy') },
    );
    expect(site.outDir).toBe(path.resolve('/tmp/bundle-copy'));
    expect(site.root).toBe(
      path.resolve(import.meta.dirname, '../../sample-site'),
    );
  });

  it('loads a config file and resolves it', async () => {
    const site = await loadSiteConfig(
      path.resolve(import.meta.dirname, '../sites/sample-site.config.ts'),
    );
    expect(site.root).toBe(
      path.resolve(import.meta.dirname, '../../sample-site'),
    );
    expect(site.outDir).toBe(
      path.resolve(import.meta.dirname, '../.build/sample-site'),
    );
    expect(Object.keys(site.regions)).toEqual([]);
  });

  it('builds into another folder when given one (PREVIEW_BUILD_DIR)', async () => {
    const buildDir = path.resolve('/tmp/preview-e2e');
    const site = await loadSiteConfig(
      path.resolve(import.meta.dirname, '../sites/sample-site.config.ts'),
      buildDir,
    );
    expect(site.outDir).toBe(path.join(buildDir, 'sample-site'));
    expect(site.mediaDir).toBe(path.join(buildDir, 'sample-site', 'media'));
  });

  it('explains the usage when no file is given', async () => {
    await expect(loadSiteConfig(undefined)).rejects.toThrow(/Usage/);
  });
});

describe('assertOutDirIsSafe', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A new temp folder for one test, removed afterwards. */
  function tempBase(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-check-'));
    made.push(dir);
    return dir;
  }

  /** A site whose root is `base/my-site` and whose output is `outDir`. */
  function siteWithOut(base: string, outDir: string) {
    const root = path.join(base, 'my-site');
    fs.mkdirSync(root, { recursive: true });
    return resolveSiteConfig(
      { ...config, root },
      base,
      path.join(base, '.build'),
      { out: outDir },
    );
  }

  /** The error a refused output folder throws. */
  function refusal(outDir: string, reason: string): Error {
    return new Error(
      `Refusing to build into ${outDir}: ${reason}. A build clears this folder, so give it a folder of its own.`,
    );
  }

  it('refuses the site root', () => {
    const base = tempBase();
    const site = siteWithOut(base, path.join(base, 'my-site'));
    const work = path.join(base, 'work');
    expect(() => assertOutDirIsSafe(site, work)).toThrow(
      refusal(site.outDir, 'it is the site root'),
    );
  });

  it('refuses a folder that contains the site root', () => {
    const base = tempBase();
    const site = siteWithOut(base, base);
    const work = path.join(base, 'work');
    expect(() => assertOutDirIsSafe(site, work)).toThrow(
      refusal(site.outDir, 'it contains the site root'),
    );
  });

  it('refuses the current folder', () => {
    const base = tempBase();
    const build = path.join(base, 'build');
    fs.mkdirSync(build);
    const site = siteWithOut(base, build);
    expect(() => assertOutDirIsSafe(site, build)).toThrow(
      refusal(site.outDir, 'it is the current folder or contains it'),
    );
  });

  it('refuses a folder that contains the current folder', () => {
    const base = tempBase();
    const build = path.join(base, 'build');
    const work = path.join(build, 'work');
    fs.mkdirSync(work, { recursive: true });
    const site = siteWithOut(base, build);
    expect(() => assertOutDirIsSafe(site, work)).toThrow(
      refusal(site.outDir, 'it is the current folder or contains it'),
    );
  });

  it('refuses a filesystem root', () => {
    const base = tempBase();
    const driveRoot = path.parse(base).root;
    const site = siteWithOut(base, driveRoot);
    const work = path.join(base, 'work');
    expect(() => assertOutDirIsSafe(site, work)).toThrow(
      refusal(site.outDir, 'it is a filesystem root'),
    );
  });

  it('refuses a non-empty folder with no bundle.json', () => {
    const base = tempBase();
    const build = path.join(base, 'build');
    fs.mkdirSync(build);
    fs.writeFileSync(path.join(build, 'notes.txt'), 'keep me');
    const site = siteWithOut(base, build);
    const work = path.join(base, 'work');
    expect(() => assertOutDirIsSafe(site, work)).toThrow(
      refusal(
        site.outDir,
        'it is not empty and has no bundle.json from an earlier build',
      ),
    );
  });

  it('allows a folder that does not exist yet', () => {
    const base = tempBase();
    const site = siteWithOut(base, path.join(base, 'fresh'));
    const work = path.join(base, 'work');
    expect(() => assertOutDirIsSafe(site, work)).not.toThrow();
  });

  it('allows an empty folder', () => {
    const base = tempBase();
    const build = path.join(base, 'build');
    fs.mkdirSync(build);
    const site = siteWithOut(base, build);
    const work = path.join(base, 'work');
    expect(() => assertOutDirIsSafe(site, work)).not.toThrow();
  });

  it('allows a rebuild over an old bundle (manifest/bundle.json)', () => {
    const base = tempBase();
    const build = path.join(base, 'build');
    fs.mkdirSync(path.join(build, 'manifest'), { recursive: true });
    fs.writeFileSync(path.join(build, 'manifest', 'bundle.json'), '{}');
    fs.mkdirSync(path.join(build, 'server'));
    fs.writeFileSync(path.join(build, 'server', 'old.mjs'), 'old');
    const site = siteWithOut(base, build);
    const work = path.join(base, 'work');
    expect(() => assertOutDirIsSafe(site, work)).not.toThrow();
  });
});
