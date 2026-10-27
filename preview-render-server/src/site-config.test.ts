import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSiteConfig, resolveSiteConfig } from './site-config.ts';
import type { SiteConfig } from './types.ts';

const config: SiteConfig = {
  root: '../../my-site',
  regions: { blocks: { component: 'src/components/BlockList.astro' } },
  port: 4400,
};

describe('resolveSiteConfig', () => {
  const resolved = resolveSiteConfig(config, path.resolve('/work/server/sites'), path.resolve('/work/server/.build'));

  it('resolves the site root against the config folder', () => {
    expect(resolved.root).toBe(path.resolve('/work/my-site'));
  });

  it('puts output, wrappers, uploads and manifests in .build, named after the site folder', () => {
    expect(resolved.outDir).toBe(path.resolve('/work/server/.build/my-site'));
    expect(resolved.regionsDir).toBe(path.resolve('/work/server/.build/my-site-regions'));
    expect(resolved.mediaDir).toBe(path.resolve('/work/server/.build/my-site-media'));
    expect(resolved.manifestDir).toBe(path.resolve('/work/server/.build/my-site-manifest'));
  });

  it('keeps the rest of the config', () => {
    expect(resolved.regions).toEqual(config.regions);
    expect(resolved.port).toBe(4400);
  });
});

describe('loadSiteConfig', () => {
  it('loads a config file and resolves it', async () => {
    const site = await loadSiteConfig(path.resolve(import.meta.dirname, '../sites/sampleAstroProject.config.ts'));
    expect(site.root).toBe(path.resolve(import.meta.dirname, '../../sampleAstroProject'));
    expect(site.outDir).toBe(path.resolve(import.meta.dirname, '../.build/sampleAstroProject'));
    expect(Object.keys(site.regions)).toEqual(['blocks']);
  });

  it('builds into another folder when given one (PREVIEW_BUILD_DIR)', async () => {
    const buildDir = path.resolve('/tmp/preview-e2e');
    const site = await loadSiteConfig(path.resolve(import.meta.dirname, '../sites/sampleAstroProject.config.ts'), buildDir);
    expect(site.outDir).toBe(path.join(buildDir, 'sampleAstroProject'));
    expect(site.mediaDir).toBe(path.join(buildDir, 'sampleAstroProject-media'));
  });

  it('explains the usage when no file is given', async () => {
    await expect(loadSiteConfig(undefined)).rejects.toThrow(/Usage/);
  });
});
