import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';
import previewRenderServer, {
  bridgeScript,
  devRoutes,
  findAstroConfig,
  findImages,
  normalizeId,
  RESOLVED_ID,
  regionWrappers,
  siteModule,
  VIRTUAL_ID,
  wrapperSource,
  writeRegionWrappers,
} from './integration.ts';
import type { ResolvedSiteConfig } from './types.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-integration-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A tiny site on disk: two regions and some images.
const root = path.join(tmp, 'site');
for (const file of [
  'src/components/BlockList.astro',
  'src/components/Nav.astro',
]) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), '<div />');
}
for (const file of [
  'src/content/assets/a.png',
  'src/content/assets/b.JPG',
  'src/assets/nested/c.webp',
  'src/content/notes.txt',
]) {
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
    expect(
      devRoutes({ PREVIEW_DEV: '1' }).map((route) => route.pattern),
    ).toEqual(['/__dev/documents']);
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
    expect(normalizeId('C:\\Site\\src\\A.astro?astro&type=style')).toBe(
      'c:/site/src/a.astro',
    );
  });
});

describe('wrapperSource', () => {
  it('imports the component and wraps it in a display:contents marker', () => {
    expect(
      wrapperSource('blocks', 'C:\\site\\src\\components\\BlockList.astro'),
    ).toMatchInlineSnapshot(`
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
    expect(fs.readdirSync(site.regionsDir).sort()).toEqual([
      'blocks.astro',
      'nav.astro',
    ]);
    expect(
      fs.readFileSync(path.join(site.regionsDir, 'nav.astro'), 'utf8'),
    ).toContain('data-preview-region="nav"');
  });

  it('maps each normalized component id to its wrapper', () => {
    expect(
      wrappers.get(
        normalizeId(path.join(root, 'src/components/BlockList.astro')),
      ),
    ).toBe(posix(path.join(site.regionsDir, 'blocks.astro')));
  });
});

describe('findImages', () => {
  it('finds images in any folder, any extension case, and nothing else', () => {
    const found = findImages(path.join(root, 'src'))
      .map((file) => posix(path.relative(root, file)))
      .sort();
    expect(found).toEqual([
      'src/assets/nested/c.webp',
      'src/content/assets/a.png',
      'src/content/assets/b.JPG',
    ]);
  });
});

// Calls a Vite plugin hook with a fake plugin context.
type Hook = (this: unknown, ...args: unknown[]) => unknown;
const hook = (plugin: Plugin, name: 'resolveId' | 'load') =>
  plugin[name] as unknown as Hook;

describe('siteModule (virtual:preview-site)', () => {
  const plugin = siteModule(site);
  const source = hook(plugin, 'load').call({}, RESOLVED_ID) as string;

  it('resolves only the virtual id', () => {
    expect(hook(plugin, 'resolveId').call({}, VIRTUAL_ID)).toBe(RESOLVED_ID);
    expect(hook(plugin, 'resolveId').call({}, './other.ts')).toBeUndefined();
    expect(hook(plugin, 'load').call({}, '/some/file.ts')).toBeUndefined();
  });

  it('lists the site pages and the URL rules for the render route', () => {
    expect(source).toContain(
      "export const pages = import.meta.glob('/src/pages/**/*.{astro,md,mdx,html}');",
    );
    expect(source).toContain(
      'export const urlRules = {"base":"/","trailingSlash":"ignore"};',
    );
  });

  it('imports every image, keyed by its project path', () => {
    expect(source).toMatch(/"src\/content\/assets\/a\.png": image\d/);
    expect(source).toMatch(/"src\/assets\/nested\/c\.webp": image\d/);
    expect(source).not.toContain('notes.txt');
  });

  it('exports the media folder', () => {
    expect(source).toContain(
      `export const mediaDir = "${posix(site.mediaDir)}";`,
    );
  });

  it('exports the manifest folder, for routes to read the manifests from', () => {
    expect(source).toContain(
      `export const manifestDir = "${posix(site.manifestDir)}";`,
    );
  });

  it('has no CMS collections when the site has no content config', () => {
    expect(source).toContain('export const cmsCollections = undefined;');
  });

  it('re-exports the content config as CMS collections (flavor 2 stubs apply to it)', () => {
    const config = path.join(root, 'src/content.config.ts');
    const withConfig = hook(siteModule(site, config), 'load').call(
      {},
      RESOLVED_ID,
    ) as string;
    expect(withConfig).toContain(
      `export { collections as cmsCollections } from "${posix(config)}?preview-cms-schema";`,
    );
  });
});

describe('regionWrappers', () => {
  const component = posix(path.join(root, 'src/components/BlockList.astro'));
  const wrapper = posix(path.join(site.regionsDir, 'blocks.astro'));
  const plugin = regionWrappers(new Map([[normalizeId(component), wrapper]]));
  const context = {
    resolve: vi.fn(async (source: string) => ({
      id: source.startsWith('/') ? source : component,
    })),
  };
  const resolveId = (source: string, importer: string | undefined) =>
    hook(plugin, 'resolveId').call(context, source, importer, {});

  it('runs before other resolvers', () => {
    expect(plugin.enforce).toBe('pre');
  });

  it("redirects a page's import of a region component to its wrapper", async () => {
    expect(
      await resolveId(
        '../components/BlockList.astro',
        posix(path.join(root, 'src/pages/index.astro')),
      ),
    ).toBe(wrapper);
  });

  it("leaves the wrapper's own import and the render route's import alone", async () => {
    expect(await resolveId(component, wrapper)).toBeUndefined();
    expect(await resolveId(component, RESOLVED_ID)).toBeUndefined();
  });

  it('ignores other files and imports without an importer', async () => {
    expect(
      await resolveId(
        './styles.css',
        posix(path.join(root, 'src/pages/index.astro')),
      ),
    ).toBeUndefined();
    expect(
      await resolveId(
        '/other/Card.astro',
        posix(path.join(root, 'src/pages/index.astro')),
      ),
    ).toBeUndefined();
    expect(
      await resolveId('../components/BlockList.astro', undefined),
    ).toBeUndefined();
  });
});

describe('previewRenderServer', () => {
  it('adds the routes, the bridge script and the Vite plugins', async () => {
    const injectRoute = vi.fn();
    const injectScript = vi.fn();
    const updateConfig = vi.fn();
    const integration = previewRenderServer(site);
    const setup = integration.hooks['astro:config:setup'] as unknown as (
      options: object,
    ) => Promise<void>;

    await setup({ injectRoute, injectScript, updateConfig });

    expect(integration.name).toBe('preview-render-server');
    expect(
      injectRoute.mock.calls.map(([route]) => [route.pattern, route.prerender]),
    ).toEqual([
      ['/__preview/anchor', false],
      ['/__preview/render', false],
      ['/__preview/validate', false],
      ['/__preview-media/[file]', false],
      ['/__preview/warm', false],
      ['/__editor', undefined],
    ]);
    expect(injectScript).toHaveBeenCalledExactlyOnceWith(
      'page',
      expect.stringMatching(
        /^import \{ startBridge \} from ".*\/client\/bridge\.ts"; startBridge\(window, window\.fetch\.bind\(window\), \{ editorOrigins: \[\] \}\);$/,
      ),
    );
    const plugins = updateConfig.mock.calls[0]![0].vite!.plugins as Plugin[];
    expect(plugins.map((plugin) => plugin.name)).toEqual([
      'preview-render-server:regions',
      'preview-render-server:region-wrappers',
      'preview-render-server:content-import-rewrite',
      'preview-render-server:image-service',
      'preview-render-server:data-modules',
    ]);
  });
});

describe('previewRenderServer hooks', () => {
  type Hook = (options: object) => unknown;
  // Its own manifest folder, so the writes don't touch the other tests' site.
  const hookSite: ResolvedSiteConfig = {
    ...site,
    manifestDir: path.join(tmp, '.build/hooks-manifest'),
  };
  const hooksOf = (target: ResolvedSiteConfig) =>
    previewRenderServer(target).hooks as unknown as Record<string, Hook>;
  const manifest = (name: string) =>
    JSON.parse(
      fs.readFileSync(path.join(hookSite.manifestDir, name), 'utf8'),
    ) as unknown;

  it('writes routes.json from the routes Astro resolved', () => {
    hooksOf(hookSite)['astro:routes:resolved']!({ routes: [] });
    expect(manifest('routes.json')).toEqual([]);
  });

  it('writes documents.json and code-languages.json when the build is done', () => {
    const integration = hooksOf(hookSite);
    integration['astro:config:done']!({
      config: {
        cacheDir: new URL(`file:///${posix(path.join(tmp, 'no-cache'))}/`),
        base: '/',
        trailingSlash: 'ignore',
      },
    });
    const warn = vi.fn();
    integration['astro:build:done']!({ logger: { warn } });
    expect(manifest('documents.json')).toEqual([]);
    expect(manifest('code-languages.json')).toHaveProperty('languages');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns instead of failing when the manifests cannot be written', () => {
    const warn = vi.fn();
    const blocked = path.join(tmp, 'blocked');
    fs.writeFileSync(blocked, '');
    hooksOf({ ...hookSite, manifestDir: path.join(blocked, 'manifest') })[
      'astro:build:done'
    ]!({ logger: { warn } });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('documents.json not written'),
    );
  });
});

// -- Mutation-testing additions ---------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../test/fixtures');
let extraCount = 0;
/** A fresh output folder set, so one test's manifests never reach another's. */
function outputs(): Pick<
  ResolvedSiteConfig,
  'outDir' | 'regionsDir' | 'mediaDir' | 'manifestDir'
> {
  const base = path.join(tmp, `out${extraCount++}`);
  return {
    outDir: path.join(base, 'site'),
    regionsDir: path.join(base, 'regions'),
    mediaDir: path.join(base, 'media'),
    manifestDir: path.join(base, 'manifest'),
  };
}
const runSetup = async (target: ResolvedSiteConfig) => {
  const injectRoute = vi.fn();
  const injectScript = vi.fn();
  const updateConfig = vi.fn();
  const integration = previewRenderServer(target);
  const hooks = integration.hooks as unknown as Record<
    string,
    (options: object) => unknown
  >;
  await hooks['astro:config:setup']!({
    injectRoute,
    injectScript,
    updateConfig,
  });
  const plugins = updateConfig.mock.calls[0]![0].vite!.plugins as Plugin[];
  return { integration, hooks, injectRoute, injectScript, plugins };
};

describe('findAstroConfig', () => {
  const siteWith = (...files: string[]) => {
    const dir = path.join(tmp, `astro-config-${extraCount++}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(dir, file), '');
    return dir;
  };

  it('finds none in a site without one', () => {
    expect(findAstroConfig(siteWith('package.json'))).toBeUndefined();
    expect(
      findAstroConfig(
        siteWith('astro.config.cjs', 'astro.config.json', 'astro.config'),
      ),
    ).toBeUndefined();
  });

  it.each(['mjs', 'js', 'ts', 'mts'])('finds astro.config.%s', (ext) => {
    const dir = siteWith(`astro.config.${ext}`);
    expect(findAstroConfig(dir)).toBe(path.join(dir, `astro.config.${ext}`));
  });

  it('prefers .mjs, then .js, then .ts, then .mts', () => {
    expect(
      findAstroConfig(
        siteWith(
          'astro.config.mts',
          'astro.config.ts',
          'astro.config.js',
          'astro.config.mjs',
        ),
      ),
    ).toMatch(/astro\.config\.mjs$/);
    expect(
      findAstroConfig(
        siteWith('astro.config.mts', 'astro.config.ts', 'astro.config.js'),
      ),
    ).toMatch(/astro\.config\.js$/);
    expect(
      findAstroConfig(siteWith('astro.config.mts', 'astro.config.ts')),
    ).toMatch(/astro\.config\.ts$/);
  });
});

describe('findImages details', () => {
  it.each(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'])(
    'finds .%s in any case',
    (ext) => {
      const dir = path.join(tmp, `images-${ext}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `a.${ext}`), '');
      fs.writeFileSync(path.join(dir, `b.${ext.toUpperCase()}`), '');
      expect(
        findImages(dir)
          .map((file) => path.basename(file))
          .sort(),
      ).toEqual([`a.${ext}`, `b.${ext.toUpperCase()}`]);
    },
  );

  it('skips other extensions, folders named like images, and files without an extension', () => {
    const dir = path.join(tmp, 'images-skip');
    fs.mkdirSync(path.join(dir, 'folder.png'), { recursive: true });
    for (const file of [
      'a.svg',
      'b.bmp',
      'c.png.txt',
      'png',
      '.png',
      'd.pngx',
      'e.xpng',
    ])
      fs.writeFileSync(path.join(dir, file), '');
    expect(findImages(dir).map((file) => path.basename(file))).toEqual([]);
  });

  it('gives full paths, also from nested folders', () => {
    const dir = path.join(tmp, 'images-nested');
    fs.mkdirSync(path.join(dir, 'a/b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a/b/c.png'), '');
    expect(findImages(dir)).toEqual([path.join(dir, 'a/b/c.png')]);
  });
});

describe('writeRegionWrappers details', () => {
  it('creates the folder, handles no regions and writes exact wrapper files', () => {
    const out = outputs();
    expect(
      writeRegionWrappers({ root, regions: {}, regionsDir: out.regionsDir })
        .size,
    ).toBe(0);
    expect(fs.existsSync(out.regionsDir)).toBe(true);
    const wrappers = writeRegionWrappers({
      root,
      regions: { nav: { component: 'src/components/Nav.astro' } },
      regionsDir: out.regionsDir,
    });
    const component = path.resolve(root, 'src/components/Nav.astro');
    expect(
      fs.readFileSync(path.join(out.regionsDir, 'nav.astro'), 'utf8'),
    ).toBe(wrapperSource('nav', component));
    expect([...wrappers]).toEqual([
      [normalizeId(component), posix(path.join(out.regionsDir, 'nav.astro'))],
    ]);
  });
});

describe('regionWrappers details', () => {
  const component = posix(path.join(root, 'src/components/Nav.astro'));
  const wrapper = posix(path.join(tmp, 'regions-x/nav.astro'));
  const make = () =>
    regionWrappers(new Map([[normalizeId(component), wrapper]]));
  const call = (plugin: Plugin, resolve: unknown, ...args: unknown[]) =>
    hook(plugin, 'resolveId').call({ resolve }, ...args);

  it('is named', () => {
    expect(make().name).toBe('preview-render-server:region-wrappers');
  });

  it('resolves the import with skipSelf and the options it got', async () => {
    const resolve = vi.fn(async () => ({ id: component }));
    expect(
      await call(
        make(),
        resolve,
        '../Nav.astro',
        '/site/src/pages/index.astro',
        { ssr: true },
      ),
    ).toBe(wrapper);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(
      '../Nav.astro',
      '/site/src/pages/index.astro',
      { ssr: true, skipSelf: true },
    );
  });

  it('recognizes the wrapper as importer whatever its spelling', async () => {
    const resolve = vi.fn(async () => ({ id: component }));
    expect(
      await call(
        make(),
        resolve,
        './Nav.astro',
        `${wrapper.toUpperCase().replaceAll('/', '\\')}?x`,
        {},
      ),
    ).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('only looks at .astro imports', async () => {
    for (const source of [
      './Nav.astro?raw',
      './Nav.ts',
      './Nav.astro.css',
      'astro',
    ]) {
      const resolve = vi.fn(async () => ({ id: component }));
      expect(
        await call(make(), resolve, source, '/site/src/pages/index.astro', {}),
      ).toBeUndefined();
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it('does nothing when the import cannot be resolved or is not a region', async () => {
    expect(
      await call(
        make(),
        async () => null,
        './Nav.astro',
        '/site/src/pages/index.astro',
        {},
      ),
    ).toBeUndefined();
    expect(
      await call(
        make(),
        async () => ({ id: '/site/src/components/Other.astro' }),
        './Other.astro',
        '/site/src/pages/index.astro',
        {},
      ),
    ).toBeUndefined();
  });

  it('matches the resolved file whatever its case or query', async () => {
    const resolved = `${component.toUpperCase()}?astro`;
    expect(
      await call(
        make(),
        async () => ({ id: resolved }),
        './Nav.astro',
        '/site/src/pages/index.astro',
        {},
      ),
    ).toBe(wrapper);
  });
});

describe('normalizeId details', () => {
  it('keeps text after a second question mark out and handles ids without a query', () => {
    expect(normalizeId('/A/B.ts')).toBe('/a/b.ts');
    expect(normalizeId('/A/B.ts?x?y')).toBe('/a/b.ts');
    expect(normalizeId('a\\b\\c')).toBe('a/b/c');
    expect(normalizeId('?only')).toBe('');
  });
});

describe('siteModule details', () => {
  const miniRoot = path.join(tmp, 'mini');
  fs.mkdirSync(path.join(miniRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(miniRoot, 'src/a.png'), '');
  const mini = {
    root: miniRoot,
    mediaDir: path.join(tmp, 'mini-media'),
    manifestDir: path.join(tmp, 'mini-manifest'),
  };
  const quoted = (p: string) => JSON.stringify(posix(p));
  const load = (
    ...args: Parameters<typeof siteModule> extends [infer _, ...infer R]
      ? R
      : never
  ) =>
    (
      hook(siteModule(mini, ...args), 'load').call({}, RESOLVED_ID) as string
    ).split('\n');
  const common = [
    `export const mediaDir = ${quoted(mini.mediaDir)};`,
    `export const siteRoot = ${quoted(miniRoot)};`,
    `export const manifestDir = ${quoted(mini.manifestDir)};`,
    "export const pages = import.meta.glob('/src/pages/**/*.{astro,md,mdx,html}');",
    'export const urlRules = {"base":"/","trailingSlash":"ignore"};',
  ];
  const head = [
    `import image0 from ${quoted(path.join(miniRoot, 'src/a.png'))};`,
    'export const images = { "src/a.png": image0 };',
  ];

  it('generates exactly these lines, in this order, without config files', () => {
    expect(load()).toEqual([
      ...head,
      ...common,
      'export const markdownConfig = undefined;',
      'export const cmsCollections = undefined;',
    ]);
  });

  it('imports the markdown config of the astro config, but only with both a content config and an astro config', () => {
    const astroConfig = path.join(miniRoot, 'astro.config.mjs');
    const contentConfig = path.join(miniRoot, 'src/content.config.ts');
    const markdown = `import siteConfig from ${quoted(astroConfig)}; export const markdownConfig = siteConfig?.markdown;`;
    const collections = `export { collections as cmsCollections } from ${JSON.stringify(`${posix(contentConfig)}?preview-cms-schema`)};`;
    expect(load(contentConfig, astroConfig)).toEqual([
      ...head,
      ...common,
      markdown,
      collections,
    ]);
    expect(load(contentConfig, undefined)).toEqual([
      ...head,
      ...common,
      'export const markdownConfig = undefined;',
      collections,
    ]);
    expect(load(undefined, astroConfig)).toEqual([
      ...head,
      ...common,
      'export const markdownConfig = undefined;',
      'export const cmsCollections = undefined;',
    ]);
  });

  it('reads the URL rules when the module is loaded, not before', () => {
    let rules = { base: '/', trailingSlash: 'ignore' };
    const plugin = siteModule(mini, undefined, undefined, () => rules);
    rules = { base: '/docs', trailingSlash: 'always' };
    expect(hook(plugin, 'load').call({}, RESOLVED_ID)).toContain(
      'export const urlRules = {"base":"/docs","trailingSlash":"always"};',
    );
  });

  it('is named, and resolves nothing but its id', () => {
    const plugin = siteModule(mini);
    expect(plugin.name).toBe('preview-render-server:regions');
    expect(
      hook(plugin, 'resolveId').call({}, `${VIRTUAL_ID}x`),
    ).toBeUndefined();
    expect(hook(plugin, 'load').call({}, `${RESOLVED_ID}x`)).toBeUndefined();
  });

  it('numbers the images and keys each by its project path', () => {
    const lines = hook(siteModule(site), 'load').call(
      {},
      RESOLVED_ID,
    ) as string;
    const [first, second, third] = [0, 1, 2].map(
      (i) => new RegExp(`^import image${i} from "[^"]+";$`, 'm'),
    );
    expect([first, second, third].map((re) => re!.test(lines))).toEqual([
      true,
      true,
      true,
    ]);
    expect(lines).toMatch(
      /^export const images = \{ ("[^"]+": image\d, ){2}"[^"]+": image\d \};$/m,
    );
  });
});

describe('previewRenderServer setup', () => {
  it('injects each route with its page, in this order, none of them prerendered except the editor', async () => {
    const { injectRoute } = await runSetup({ ...site, ...outputs() });
    const routes = injectRoute.mock.calls.map(
      ([route]) =>
        route as { pattern: string; entrypoint: URL; prerender?: boolean },
    );
    expect(
      routes.map((route) => [
        route.pattern,
        posix(path.relative(here, fileURLToPath(route.entrypoint))),
      ]),
    ).toEqual([
      ['/__preview/anchor', 'render/renderers-anchor.astro'],
      ['/__preview/render', 'render-route.ts'],
      ['/__preview/validate', 'validate-route.ts'],
      ['/__preview-media/[file]', 'media-route.ts'],
      ['/__preview/warm', 'warmup-route.ts'],
      ['/__editor', '../test-editor/editor.astro'],
    ]);
    for (const route of routes)
      expect(fs.existsSync(fileURLToPath(route.entrypoint))).toBe(true);
    expect(routes.map((route) => route.prerender)).toEqual([
      false,
      false,
      false,
      false,
      false,
      undefined,
    ]);
  });

  it('adds the development routes only with PREVIEW_DEV=1', async () => {
    vi.stubEnv('PREVIEW_DEV', '1');
    try {
      const { injectRoute } = await runSetup({ ...site, ...outputs() });
      const routes = injectRoute.mock.calls.map(
        ([route]) =>
          route as { pattern: string; entrypoint: URL; prerender?: boolean },
      );
      expect(routes.map((route) => route.pattern)).toEqual([
        '/__preview/anchor',
        '/__preview/render',
        '/__preview/validate',
        '/__preview-media/[file]',
        '/__preview/warm',
        '/__dev/documents',
        '/__editor',
      ]);
      const dev = routes[5];
      expect(dev!.prerender).toBe(false);
      expect(posix(path.relative(here, fileURLToPath(dev!.entrypoint)))).toBe(
        'dev/documents-route.ts',
      );
      expect(fs.existsSync(fileURLToPath(dev!.entrypoint))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('adds the bridge script with the editor origins and a bridge file that exists', async () => {
    const { injectScript } = await runSetup({
      ...site,
      ...outputs(),
      editorOrigins: ['https://editor.example', 'http://localhost:3000'],
    });
    const [stage, code] = injectScript.mock.calls[0] as [string, string];
    expect(stage).toBe('page');
    expect(code).toContain(
      '{ editorOrigins: ["https://editor.example","http://localhost:3000"] }',
    );
    const bridge = /from "([^"]+)"/.exec(code)![1];
    expect(bridge).not.toContain('\\');
    expect(fs.existsSync(bridge!)).toBe(true);
  });

  it('creates the manifest folder and writes the region wrappers', async () => {
    const out = outputs();
    await runSetup({ ...site, ...out });
    expect(fs.existsSync(out.manifestDir)).toBe(true);
    expect(fs.readdirSync(out.regionsDir).sort()).toEqual([
      'blocks.astro',
      'nav.astro',
    ]);
  });

  it('passes the scanned data modules to the data-module plugin', async () => {
    const scanRoot = path.join(fixtures, 'scan-site');
    const { plugins } = await runSetup({
      ...site,
      ...outputs(),
      root: scanRoot,
      regions: {},
    });
    const dataPlugin = plugins.find(
      (plugin) => plugin.name === 'preview-render-server:data-modules',
    )!;
    const importer = path.join(scanRoot, 'src/layouts/Header.astro');
    const resolveWith = (file: string) =>
      hook(dataPlugin, 'resolveId').call(
        { resolve: async () => ({ id: path.join(scanRoot, file) }) },
        './x.json',
        importer,
        {},
      ) as Promise<string | undefined>;
    expect(await resolveWith('src/config/menu.json')).toBe(
      `\0preview-data:${path.join(scanRoot, 'src/config/menu.json')}.js`,
    );
    expect(await resolveWith('src/data/unused.json')).toBeUndefined();
  });

  it('adds the schema plugin, in its place, and writes schema.json when the site has a content config', async () => {
    const schemaRoot = path.join(fixtures, 'schema-site');
    const out = outputs();
    const { plugins } = await runSetup({
      ...site,
      ...out,
      root: schemaRoot,
      regions: {},
    });
    expect(plugins.map((plugin) => plugin.name)).toEqual([
      'preview-render-server:regions',
      'preview-render-server:region-wrappers',
      'preview-render-server:schema-stubs',
      'preview-render-server:content-import-rewrite',
      'preview-render-server:image-service',
      'preview-render-server:data-modules',
    ]);
    const schema = JSON.parse(
      fs.readFileSync(path.join(out.manifestDir, 'schema.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(schema).sort()).toEqual(['authors', 'posts', 'quotes']);
    expect(
      fs.existsSync(path.join(out.manifestDir, 'content-config.flavor1.mjs')),
    ).toBe(true);
  });

  it('writes no schema.json for a site without a content config', async () => {
    const out = outputs();
    await runSetup({ ...site, ...out });
    expect(fs.existsSync(path.join(out.manifestDir, 'schema.json'))).toBe(
      false,
    );
  });
});

describe('previewRenderServer build hooks', () => {
  it('uses the URL rules and the cache folder that Astro resolved', async () => {
    const out = outputs();
    const { hooks, plugins } = await runSetup({ ...site, ...out });
    const cache = path.join(tmp, `cache-${extraCount++}`);
    fs.mkdirSync(cache, { recursive: true });
    hooks['astro:config:done']!({
      config: {
        cacheDir: new URL(`file:///${posix(cache)}/`),
        base: '/docs',
        trailingSlash: 'always',
      },
    });
    const source = hook(plugins[0]!, 'load').call({}, RESOLVED_ID) as string;
    expect(source).toContain(
      'export const urlRules = {"base":"/docs","trailingSlash":"always"};',
    );
  });

  it('writes the routes it is given, shaped, into routes.json', async () => {
    const out = outputs();
    const { hooks } = await runSetup({ ...site, ...out });
    hooks['astro:routes:resolved']!({
      routes: [
        {
          pattern: '/about',
          entrypoint: 'src/pages/about.astro',
          type: 'page',
          params: [],
        },
      ],
    });
    const routes = JSON.parse(
      fs.readFileSync(path.join(out.manifestDir, 'routes.json'), 'utf8'),
    ) as Array<{ pattern: string; component: string }>;
    expect(routes.map((route) => [route.pattern, route.component])).toEqual([
      ['/about', 'src/pages/about.astro'],
    ]);
    expect(
      fs.readFileSync(path.join(out.manifestDir, 'routes.json'), 'utf8'),
    ).toMatch(/\n$/);
    expect(
      fs.readFileSync(path.join(out.manifestDir, 'routes.json'), 'utf8'),
    ).toContain('\n  {\n    "');
  });

  it('writes the languages from extraLanguages, and says why a manifest was not written', async () => {
    const out = outputs();
    const { hooks } = await runSetup({
      ...site,
      ...out,
      extraLanguages: ['Ruby'],
    });
    const warn = vi.fn();
    hooks['astro:config:done']!({
      config: {
        cacheDir: new URL(`file:///${posix(path.join(tmp, 'no-cache'))}/`),
        base: '/',
        trailingSlash: 'ignore',
      },
    });
    hooks['astro:build:done']!({ logger: { warn } });
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(out.manifestDir, 'code-languages.json'),
          'utf8',
        ),
      ).languages,
    ).toContain('ruby');
    expect(warn).not.toHaveBeenCalled();

    fs.writeFileSync(path.join(tmp, `blocked-${extraCount}`), '');
    const blocked = path.join(tmp, `blocked-${extraCount++}`, 'manifest');
    const broken = previewRenderServer({
      ...site,
      ...out,
      manifestDir: blocked,
    }).hooks as unknown as Record<string, (o: object) => unknown>;
    broken['astro:build:done']!({ logger: { warn } });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^documents\.json not written: \S/),
    );
  });
});
