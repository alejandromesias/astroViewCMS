import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import type { Plugin } from 'vite';
import { readDataStore, shapeDocuments } from './manifest/documents.ts';
import type { ProjectScan } from './manifest/import-scan.ts';
import { scanProject } from './manifest/import-scan.ts';
import { collectLanguages, LANGUAGES_FILE } from './manifest/languages.ts';
import { shapeRoutes } from './manifest/routes.ts';
import { previewImageService } from './overlay/image-service.ts';
import { contentImportRewrite, dataModules } from './overlay/plugins.ts';
import {
  findContentConfig,
  loadCmsCollections,
  STUB_QUERY,
  STUBS,
  schemaStubs,
} from './schema/config-bundle.ts';
import { shapeSchemas } from './schema/json-schema.ts';
import type { ResolvedSiteConfig } from './types.ts';

export const VIRTUAL_ID = 'virtual:preview-site';
export const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
]);

// Added only to the preview build. It:
// - injects the render routes /__preview/render, /__preview/validate and
//   /__preview/warm, the draft image route /__preview-media/[file] (a stopgap
//   until the CMS app stages media, phase 2) and the test editor page
//   /__editor (and, with PREVIEW_DEV=1, /__dev/documents, the editor's
//   stopgap data source), plus an on-demand page that keeps the site's renderers in the
//   server bundle;
// - wraps each region component in <div data-preview-region> on the site's
//   pages, by redirecting the pages' imports to a generated wrapper (the site's
//   source stays untouched);
// - adds the bridge script to every page;
// - writes the build manifests (schema.json, routes.json, documents.json) to
//   site.manifestDir;
// - generates a virtual module that hands the routes the site's pages, every
//   image under src/, where to keep uploads and the site's CMS schemas.
export default function previewRenderServer(
  site: ResolvedSiteConfig,
): AstroIntegration {
  const contentConfig = findContentConfig(site.root);
  // Filled in by astro:config:setup, used when the build is done.
  let scan: ProjectScan = { buildTimeFiles: [], dataModules: [] };
  let loaderKinds: Record<string, 'glob' | 'file' | undefined> = {};
  // Where the build keeps its content data store.
  let cacheDir = path.join(site.root, 'node_modules', '.astro');
  let urlRules = { base: '/', trailingSlash: 'ignore' };

  return {
    name: 'preview-render-server',
    hooks: {
      // Runs once per build, before Astro resolves its config: everything the
      // preview needs is added here, nothing is written into the site.
      'astro:config:setup': async ({
        injectRoute,
        injectScript,
        updateConfig,
      }) => {
        // Server-rendered routes (the built server answers them on demand).
        // Keeps the site's renderers in the server bundle (see the page).
        injectRoute({
          pattern: '/__preview/anchor',
          entrypoint: new URL(
            './render/renderers-anchor.astro',
            import.meta.url,
          ),
          prerender: false,
        });
        injectRoute({
          pattern: '/__preview/render',
          entrypoint: new URL('./render-route.ts', import.meta.url),
          prerender: false,
        });
        injectRoute({
          pattern: '/__preview/validate',
          entrypoint: new URL('./validate-route.ts', import.meta.url),
          prerender: false,
        });
        injectRoute({
          pattern: '/__preview-media/[file]',
          entrypoint: new URL('./media-route.ts', import.meta.url),
          prerender: false,
        });
        injectRoute({
          pattern: '/__preview/warm',
          entrypoint: new URL('./warmup-route.ts', import.meta.url),
          prerender: false,
        });
        for (const route of devRoutes())
          injectRoute({ ...route, prerender: false });
        // The test editor is a plain prerendered page.
        injectRoute({
          pattern: '/__editor',
          entrypoint: new URL('../test-editor/editor.astro', import.meta.url),
        });
        // The bridge: a script added to every page; it does nothing unless the
        // page is inside an iframe.
        const bridge = fileURLToPath(
          new URL('./client/bridge.ts', import.meta.url),
        );
        injectScript('page', bridgeScript(toPosix(bridge), site.editorOrigins));

        // The import scan (kept for documents.json) says which JSON files the
        // site's code imports; the overlay turns those into proxy modules.
        fs.mkdirSync(site.manifestDir, { recursive: true });
        scan = await scanProject(site.root);

        // Wrapper files first, then the Vite plugins that use them.
        const wrappers = writeRegionWrappers(site);
        const srcDir = path.join(site.root, 'src');
        updateConfig({
          vite: {
            plugins: [
              siteModule(
                site,
                contentConfig,
                findAstroConfig(site.root),
                () => urlRules,
              ),
              regionWrappers(wrappers),
              ...(contentConfig
                ? [schemaStubs(contentConfig, STUBS[2], STUB_QUERY) as Plugin]
                : []),
              contentImportRewrite({
                srcDir,
                shimFile: fileURLToPath(
                  new URL('./overlay/content-shim.ts', import.meta.url),
                ),
              }),
              previewImageService({
                wrapperFile: fileURLToPath(
                  new URL('./overlay/image-service.ts', import.meta.url),
                ),
              }),
              dataModules({
                root: site.root,
                srcDir,
                files: scan.dataModules.map((file) =>
                  path.join(site.root, file),
                ),
                proxyFile: fileURLToPath(
                  new URL('./overlay/data-proxy.ts', import.meta.url),
                ),
              }),
            ],
          },
        });

        // schema.json from the flavor 1 pass.
        if (contentConfig) {
          const collections = await loadCmsCollections(
            site.root,
            contentConfig,
            path.join(site.manifestDir, 'content-config.flavor1.mjs'),
          );
          loaderKinds = Object.fromEntries(
            Object.entries(collections).map(([name, c]) => [
              name,
              c.loader?.kind,
            ]),
          );
          writeManifest(site, 'schema.json', shapeSchemas(collections));
        }
      },
      'astro:config:done': ({ config }) => {
        cacheDir = fileURLToPath(config.cacheDir);
        urlRules = { base: config.base, trailingSlash: config.trailingSlash };
      },
      'astro:routes:resolved': ({ routes }) => {
        writeManifest(site, 'routes.json', shapeRoutes(routes, site.root));
      },
      // The content data store is complete once the build is done.
      'astro:build:done': ({ logger }) => {
        try {
          const store = readDataStore(cacheDir);
          const documents = shapeDocuments({
            store,
            loaderKinds,
            scan,
            ...(site.buildTimeFields === undefined
              ? {}
              : { buildTimeFields: site.buildTimeFields }),
          });
          writeManifest(site, 'documents.json', documents);
          writeManifest(site, LANGUAGES_FILE, {
            languages: collectLanguages(site.root, store, site.extraLanguages),
          });
        } catch (error) {
          logger.warn(
            `documents.json not written: ${(error as Error).message}`,
          );
        }
      },
    },
  };
}

/** Routes added only to a build made with PREVIEW_DEV=1: the editor's stopgap
 *  for the CMS app's GET /api/documents (phase 2). A normal build has none. */
export function devRoutes(
  env: NodeJS.ProcessEnv = process.env,
): Array<{ pattern: string; entrypoint: URL }> {
  if (env.PREVIEW_DEV !== '1') return [];
  return [
    {
      pattern: '/__dev/documents',
      entrypoint: new URL('./dev/documents-route.ts', import.meta.url),
    },
    {
      pattern: '/__dev/memory',
      entrypoint: new URL('./dev/memory-route.ts', import.meta.url),
    },
  ];
}

/** The page script that starts the bridge (client/bridge.ts) with the editor
 *  origins of the site config. */
export function bridgeScript(
  bridgeFile: string,
  editorOrigins: string[] = [],
): string {
  return `import { startBridge } from ${JSON.stringify(bridgeFile)}; startBridge(window, window.fetch.bind(window), { editorOrigins: ${JSON.stringify(editorOrigins)} });`;
}

function writeManifest(
  { manifestDir }: Pick<ResolvedSiteConfig, 'manifestDir'>,
  name: string,
  value: unknown,
): void {
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(
    path.join(manifestDir, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

/** Writes one wrapper .astro file per region into `regionsDir` (outside the
 *  site) and returns normalized component id -> wrapper path, which
 *  `regionWrappers` uses to redirect imports. `display: contents` keeps the
 *  wrapper out of the layout, so the page renders exactly as before. */
export function writeRegionWrappers({
  root,
  regions,
  regionsDir,
}: Pick<ResolvedSiteConfig, 'root' | 'regions' | 'regionsDir'>): Map<
  string,
  string
> {
  fs.mkdirSync(regionsDir, { recursive: true });
  const wrappers = new Map<string, string>();
  for (const [name, region] of Object.entries(regions)) {
    const component = path.resolve(root, region.component);
    const wrapper = path.join(regionsDir, `${name}.astro`);
    fs.writeFileSync(wrapper, wrapperSource(name, component));
    wrappers.set(normalizeId(component), toPosix(wrapper));
  }
  return wrappers;
}

/** Source of one wrapper: the region component inside the marker div the
 *  bridge looks for. Props pass straight through. */
export function wrapperSource(name: string, component: string): string {
  return [
    '---',
    `import Region from ${JSON.stringify(toPosix(component))};`,
    '---',
    `<div style="display: contents" data-preview-region=${JSON.stringify(name)}><Region {...Astro.props} /></div>`,
    '',
  ].join('\n');
}

/** Vite plugin that points every import of a region component at its wrapper,
 *  except the wrapper's own import and the render route's (through the
 *  virtual module), which need the bare component. That's how pages get the
 *  marker while the route renders the plain fragment. */
export function regionWrappers(wrappers: Map<string, string>): Plugin {
  const wrapperFiles = new Set([...wrappers.values()].map(normalizeId));
  return {
    name: 'preview-render-server:region-wrappers',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Skip entry points, the virtual module and the wrappers themselves.
      if (
        !importer ||
        importer === RESOLVED_ID ||
        wrapperFiles.has(normalizeId(importer))
      )
        return;
      if (!source.endsWith('.astro')) return;
      // Resolve the import the normal way to learn which file it points at;
      // `skipSelf` avoids calling this hook again for the same import.
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved) return;
      return wrappers.get(normalizeId(resolved.id));
    },
  };
}

/** Vite plugin that generates the `virtual:preview-site` module (typed in
 *  virtual.d.ts): the region components with their image folder, every
 *  image under the site's `src/` (so draft paths can become ImageMetadata),
 *  and the folder for uploads. The routes import it; it exists only during a
 *  build. */
export function siteModule(
  {
    root,
    mediaDir,
    manifestDir,
  }: Pick<ResolvedSiteConfig, 'root' | 'mediaDir' | 'manifestDir'>,
  contentConfig?: string,
  astroConfigFile?: string,
  /** The site's `base` and `trailingSlash`, known once Astro has resolved its config. */
  urlRules: () => { base: string; trailingSlash: string } = () => ({
    base: '/',
    trailingSlash: 'ignore',
  }),
): Plugin {
  return {
    name: 'preview-render-server:regions',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;

      // `lines` collects the import statements; the exports below use them.
      const lines: string[] = [];
      // Importing an image makes Vite emit it and gives back its ImageMetadata.
      const imageEntries = findImages(path.join(root, 'src')).map((file, i) => {
        lines.push(`import image${i} from ${importPath(root, file)};`);
        return `${JSON.stringify(toPosix(path.relative(root, file)))}: image${i}`;
      });

      return [
        ...lines,
        `export const images = { ${imageEntries.join(', ')} };`,
        `export const mediaDir = ${JSON.stringify(toPosix(mediaDir))};`,
        `export const siteRoot = ${JSON.stringify(toPosix(root))};`,
        `export const manifestDir = ${JSON.stringify(toPosix(manifestDir))};`,
        // The site's pages, loaded on demand by the render route.
        "export const pages = import.meta.glob('/src/pages/**/*.{astro,md,mdx,html}');",
        `export const urlRules = ${JSON.stringify(urlRules())};`,
        // The site's markdown config (remark/rehype plugins, Shiki), for Markdown drafts.
        contentConfig && astroConfigFile
          ? `import siteConfig from ${importPath(root, astroConfigFile)}; export const markdownConfig = siteConfig?.markdown;`
          : 'export const markdownConfig = undefined;',
        // The content config compiled with the flavor 2 stubs (schemaStubs).
        contentConfig
          ? `export { collections as cmsCollections } from ${JSON.stringify(`${toPosix(path.resolve(root, contentConfig))}?${STUB_QUERY}`)};`
          : 'export const cmsCollections = undefined;',
      ].join('\n');
    },
  };
}

/** The site's astro.config file, if it has one. */
export function findAstroConfig(root: string): string | undefined {
  return ['mjs', 'js', 'ts', 'mts']
    .map((ext) => path.join(root, `astro.config.${ext}`))
    .find((file) => fs.existsSync(file));
}

export function findImages(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function importPath(root: string, file: string): string {
  return JSON.stringify(toPosix(path.resolve(root, file)));
}

/** Vite ids use forward slashes and may carry a ?query; Windows paths are
 *  case-insensitive. */
export function normalizeId(id: string): string {
  return toPosix(id.replace(/\?.*/s, '')).toLowerCase();
}

function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}
