import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSiteConfig, resolveSiteConfig } from './site-config.ts';
import type { SiteConfig } from './types.ts';

const config: SiteConfig = {
  root: '../../my-site',
  islands: { blocks: { component: 'src/components/BlockList.astro' } },
  port: 4400,
};

describe('resolveSiteConfig', () => {
  const resolved = resolveSiteConfig(config, path.resolve('/work/server/sites'), path.resolve('/work/server/.build'));

  it('resolves the site root against the config folder', () => {
    expect(resolved.root).toBe(path.resolve('/work/my-site'));
  });

  it('puts output, wrappers and uploads in .build, named after the site folder', () => {
    expect(resolved.outDir).toBe(path.resolve('/work/server/.build/my-site'));
    expect(resolved.islandsDir).toBe(path.resolve('/work/server/.build/my-site-islands'));
    expect(resolved.mediaDir).toBe(path.resolve('/work/server/.build/my-site-media'));
  });

  it('keeps the rest of the config', () => {
    expect(resolved.islands).toEqual(config.islands);
    expect(resolved.port).toBe(4400);
  });
});

describe('loadSiteConfig', () => {
  it('loads a config file and resolves it', async () => {
    const site = await loadSiteConfig(path.resolve(import.meta.dirname, '../sites/sampleAstroProject.config.ts'));
    expect(site.root).toBe(path.resolve(import.meta.dirname, '../../sampleAstroProject'));
    expect(site.outDir).toBe(path.resolve(import.meta.dirname, '../.build/sampleAstroProject'));
    expect(Object.keys(site.islands)).toEqual(['blocks']);
  });

  it('explains the usage when no file is given', async () => {
    await expect(loadSiteConfig(undefined)).rejects.toThrow(/Usage/);
  });
});
