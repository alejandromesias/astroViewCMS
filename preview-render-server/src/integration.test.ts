import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';
import previewRenderServer, {
  RESOLVED_ID,
  VIRTUAL_ID,
  bridgeScript,
  devRoutes,
  findImages,
  regionWrappers,
  siteModule,
  normalizeId,
  wrapperSource,
  writeRegionWrappers,
} from './integration.ts';
import type { ResolvedSiteConfig } from './types.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-integration-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A tiny site on disk: two regions and some images.
const root = path.join(tmp, 'site');
for (const file of ['src/components/BlockList.astro', 'src/components/Nav.astro']) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), '<div />');
}
for (const file of ['src/content/assets/a.png', 'src/content/assets/b.JPG', 'src/assets/nested/c.webp', 'src/content/notes.txt']) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), '');
}

const site: ResolvedSiteConfig = {
  root,
  port: 4400,
  outDir: path.join(tmp, '.build/site'),
  regionsDir: path.join(tmp, '.build/site-regions'),
  mediaDir: path.join(tmp, '.build/site-media'),
  manifestDir: path.join(tmp, '.build/site-manifest'),
  regions: {
    blocks: { component: 'src/components/BlockList.astro' },
    nav: { component: 'src/components/Nav.astro' },
  },
};

const posix = (p: string) => p.replaceAll('\\', '/');

describe('devRoutes', () => {
  it('adds /__dev/documents only to a build made with PREVIEW_DEV=1', () => {
    expect(devRoutes({ PREVIEW_DEV: '1' }).map((route) => route.pattern)).toEqual(['/__dev/documents']);
    expect(devRoutes({})).toEqual([]);
    expect(devRoutes({ PREVIEW_DEV: '0' })).toEqual([]);
    expect(devRoutes({ PREVIEW_DEV: 'true' })).toEqual([]);
  });
});

describe('bridgeScript', () => {
  it('starts the bridge with the editor origins of the site config', () => {
    expect(bridgeScript('C:/x/bridge.ts', ['https://editor.example'])).toBe(
      'import { startBridge } from "C:/x/bridge.ts"; startBridge(window, window.fetch.bind(window), { editorOrigins: ["https://editor.example"] });',
    );
  });
});

describe('normalizeId', () => {
  it('uses forward slashes, drops the query and lowercases', () => {
    expect(normalizeId('C:\\Site\\src\\A.astro?astro&type=style')).toBe('c:/site/src/a.astro');
  });
});

describe('wrapperSource', () => {
  it('imports the component and wraps it in a display:contents marker', () => {
    expect(wrapperSource('blocks', 'C:\\site\\src\\components\\BlockList.astro')).toMatchInlineSnapshot(`
      "---
      import Region from "C:/site/src/components/BlockList.astro";
      ---
      <div style="display: contents" data-preview-region="blocks"><Region {...Astro.props} /></div>
      "
    `);
  });
});

describe('writeRegionWrappers', () => {
  const wrappers = writeRegionWrappers(site);

  it('writes one wrapper per region', () => {
    expect(fs.readdirSync(site.regionsDir).sort()).toEqual(['blocks.astro', 'nav.astro']);
    expect(fs.readFileSync(path.join(site.regionsDir, 'nav.astro'), 'utf8')).toContain('data-preview-region="nav"');
  });

  it('maps each normalized component id to its wrapper', () => {
    expect(wrappers.get(normalizeId(path.join(root, 'src/components/BlockList.astro')))).toBe(
      posix(path.join(site.regionsDir, 'blocks.astro')),
    );
  });
});

describe('findImages', () => {
  it('finds images in any folder, any extension case, and nothing else', () => {
    const found = findImages(path.join(root, 'src')).map((file) => posix(path.relative(root, file))).sort();
    expect(found).toEqual(['src/assets/nested/c.webp', 'src/content/assets/a.png', 'src/content/assets/b.JPG']);
  });
});

// Calls a Vite plugin hook with a fake plugin context.
type Hook = (this: unknown, ...args: unknown[]) => unknown;
const hook = (plugin: Plugin, name: 'resolveId' | 'load') => plugin[name] as unknown as Hook;

describe('siteModule (virtual:preview-site)', () => {
  const plugin = siteModule(site);
  const source = hook(plugin, 'load').call({}, RESOLVED_ID) as string;

  it('resolves only the virtual id', () => {
    expect(hook(plugin, 'resolveId').call({}, VIRTUAL_ID)).toBe(RESOLVED_ID);
    expect(hook(plugin, 'resolveId').call({}, './other.ts')).toBeUndefined();
    expect(hook(plugin, 'load').call({}, '/some/file.ts')).toBeUndefined();
  });

  it('lists the site pages and the URL rules for the render route', () => {
    expect(source).toContain("export const pages = import.meta.glob('/src/pages/**/*.{astro,md,mdx,html}');");
    expect(source).toContain('export const urlRules = {"base":"/","trailingSlash":"ignore"};');
  });

  it('imports every image, keyed by its project path', () => {
    expect(source).toMatch(/"src\/content\/assets\/a\.png": image\d/);
    expect(source).toMatch(/"src\/assets\/nested\/c\.webp": image\d/);
    expect(source).not.toContain('notes.txt');
  });

  it('exports the media folder', () => {
    expect(source).toContain(`export const mediaDir = "${posix(site.mediaDir)}";`);
  });

  it('exports the manifest folder, for routes to read the manifests from', () => {
    expect(source).toContain(`export const manifestDir = "${posix(site.manifestDir)}";`);
  });

  it('has no CMS collections when the site has no content config', () => {
    expect(source).toContain('export const cmsCollections = undefined;');
  });

  it('re-exports the content config as CMS collections (flavor 2 stubs apply to it)', () => {
    const config = path.join(root, 'src/content.config.ts');
    const withConfig = hook(siteModule(site, config), 'load').call({}, RESOLVED_ID) as string;
    expect(withConfig).toContain(`export { collections as cmsCollections } from "${posix(config)}?preview-cms-schema";`);
  });
});

describe('regionWrappers', () => {
  const component = posix(path.join(root, 'src/components/BlockList.astro'));
  const wrapper = posix(path.join(site.regionsDir, 'blocks.astro'));
  const plugin = regionWrappers(new Map([[normalizeId(component), wrapper]]));
  const context = { resolve: vi.fn(async (source: string) => ({ id: source.startsWith('/') ? source : component })) };
  const resolveId = (source: string, importer: string | undefined) =>
    hook(plugin, 'resolveId').call(context, source, importer, {});

  it('runs before other resolvers', () => {
    expect(plugin.enforce).toBe('pre');
  });

  it("redirects a page's import of a region component to its wrapper", async () => {
    expect(await resolveId('../components/BlockList.astro', posix(path.join(root, 'src/pages/index.astro')))).toBe(wrapper);
  });

  it("leaves the wrapper's own import and the render route's import alone", async () => {
    expect(await resolveId(component, wrapper)).toBeUndefined();
    expect(await resolveId(component, RESOLVED_ID)).toBeUndefined();
  });

  it('ignores other files and imports without an importer', async () => {
    expect(await resolveId('./styles.css', posix(path.join(root, 'src/pages/index.astro')))).toBeUndefined();
    expect(await resolveId('/other/Card.astro', posix(path.join(root, 'src/pages/index.astro')))).toBeUndefined();
    expect(await resolveId('../components/BlockList.astro', undefined)).toBeUndefined();
  });
});

describe('previewRenderServer', () => {
  it('adds the routes, the bridge script and the Vite plugins', async () => {
    const injectRoute = vi.fn();
    const injectScript = vi.fn();
    const updateConfig = vi.fn();
    const integration = previewRenderServer(site);
    const setup = integration.hooks['astro:config:setup'] as unknown as (options: object) => Promise<void>;

    await setup({ injectRoute, injectScript, updateConfig });

    expect(integration.name).toBe('preview-render-server');
    expect(injectRoute.mock.calls.map(([route]) => [route.pattern, route.prerender])).toEqual([
      ['/__preview/anchor', false],
      ['/__preview/render', false],
      ['/__preview/validate', false],
      ['/__preview-media/[file]', false],
      ['/__preview/warm', false],
      ['/__editor', undefined],
    ]);
    expect(injectScript).toHaveBeenCalledExactlyOnceWith('page', expect.stringMatching(/^import \{ startBridge \} from ".*\/client\/bridge\.ts"; startBridge\(window, window\.fetch\.bind\(window\), \{ editorOrigins: \[\] \}\);$/),
    );
    const plugins = updateConfig.mock.calls[0][0].vite.plugins as Plugin[];
    expect(plugins.map((plugin) => plugin.name)).toEqual([
      'preview-render-server:regions',
      'preview-render-server:region-wrappers',
      'preview-render-server:content-import-rewrite',
      'preview-render-server:image-service',
      'preview-render-server:data-modules',
    ]);
  });
});
