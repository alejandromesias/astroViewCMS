import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';
import previewRenderServer, {
  RESOLVED_ID,
  VIRTUAL_ID,
  findImages,
  islandWrappers,
  islandsModule,
  normalizeId,
  wrapperSource,
  writeIslandWrappers,
} from './integration.ts';
import type { ResolvedSiteConfig } from './types.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-integration-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A tiny site on disk: two islands and some images.
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
  islandsDir: path.join(tmp, '.build/site-islands'),
  mediaDir: path.join(tmp, '.build/site-media'),
  islands: {
    blocks: {
      component: 'src/components/BlockList.astro',
      contentDir: 'src/content/pages',
    },
    nav: { component: 'src/components/Nav.astro' },
  },
};

const posix = (p: string) => p.replaceAll('\\', '/');

describe('normalizeId', () => {
  it('uses forward slashes, drops the query and lowercases', () => {
    expect(normalizeId('C:\\Site\\src\\A.astro?astro&type=style')).toBe('c:/site/src/a.astro');
  });
});

describe('wrapperSource', () => {
  it('imports the component and wraps it in a display:contents marker', () => {
    expect(wrapperSource('blocks', 'C:\\site\\src\\components\\BlockList.astro')).toMatchInlineSnapshot(`
      "---
      import Island from "C:/site/src/components/BlockList.astro";
      ---
      <div style="display: contents" data-preview-island="blocks"><Island {...Astro.props} /></div>
      "
    `);
  });
});

describe('writeIslandWrappers', () => {
  const wrappers = writeIslandWrappers(site);

  it('writes one wrapper per island', () => {
    expect(fs.readdirSync(site.islandsDir).sort()).toEqual(['blocks.astro', 'nav.astro']);
    expect(fs.readFileSync(path.join(site.islandsDir, 'nav.astro'), 'utf8')).toContain('data-preview-island="nav"');
  });

  it('maps each normalized component id to its wrapper', () => {
    expect(wrappers.get(normalizeId(path.join(root, 'src/components/BlockList.astro')))).toBe(
      posix(path.join(site.islandsDir, 'blocks.astro')),
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

describe('islandsModule (virtual:preview-islands)', () => {
  const plugin = islandsModule(site);
  const source = hook(plugin, 'load').call({}, RESOLVED_ID) as string;

  it('resolves only the virtual id', () => {
    expect(hook(plugin, 'resolveId').call({}, VIRTUAL_ID)).toBe(RESOLVED_ID);
    expect(hook(plugin, 'resolveId').call({}, './other.ts')).toBeUndefined();
    expect(hook(plugin, 'load').call({}, '/some/file.ts')).toBeUndefined();
  });

  it('imports each island component and lists its image folder', () => {
    expect(source).toContain(`import island0 from "${posix(path.join(root, 'src/components/BlockList.astro'))}";`);
    expect(source).toContain(`"blocks": { component: island0, ...{"contentDir":"src/content/pages"} }`);
    expect(source).toContain(`"nav": { component: island1, ...{"contentDir":""} }`);
  });

  it('imports every image, keyed by its project path', () => {
    expect(source).toMatch(/"src\/content\/assets\/a\.png": image\d/);
    expect(source).toMatch(/"src\/assets\/nested\/c\.webp": image\d/);
    expect(source).not.toContain('notes.txt');
  });

  it('exports the media folder', () => {
    expect(source).toContain(`export const mediaDir = "${posix(site.mediaDir)}";`);
  });
});

describe('islandWrappers', () => {
  const component = posix(path.join(root, 'src/components/BlockList.astro'));
  const wrapper = posix(path.join(site.islandsDir, 'blocks.astro'));
  const plugin = islandWrappers(new Map([[normalizeId(component), wrapper]]));
  const context = { resolve: vi.fn(async (source: string) => ({ id: source.startsWith('/') ? source : component })) };
  const resolveId = (source: string, importer: string | undefined) =>
    hook(plugin, 'resolveId').call(context, source, importer, {});

  it('runs before other resolvers', () => {
    expect(plugin.enforce).toBe('pre');
  });

  it("redirects a page's import of an island component to its wrapper", async () => {
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
  it('adds the routes, the bridge script and both Vite plugins', () => {
    const injectRoute = vi.fn();
    const injectScript = vi.fn();
    const updateConfig = vi.fn();
    const integration = previewRenderServer(site);
    const setup = integration.hooks['astro:config:setup'] as unknown as (options: object) => void;

    setup({ injectRoute, injectScript, updateConfig });

    expect(integration.name).toBe('preview-render-server');
    expect(injectRoute.mock.calls.map(([route]) => [route.pattern, route.prerender])).toEqual([
      ['/__preview/[island]', false],
      ['/__preview-media/[file]', false],
      ['/__editor', undefined],
    ]);
    expect(injectScript).toHaveBeenCalledExactlyOnceWith('page', expect.stringMatching(/^import ".*\/client\/bridge-entry\.ts";$/));
    const plugins = updateConfig.mock.calls[0][0].vite.plugins as Plugin[];
    expect(plugins.map((plugin) => plugin.name)).toEqual([
      'preview-render-server:islands',
      'preview-render-server:island-wrappers',
    ]);
  });
});
