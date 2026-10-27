import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import type { Plugin } from 'vite';
import type { ResolvedSiteConfig } from './types.ts';

export const VIRTUAL_ID = 'virtual:preview-site';
export const RESOLVED_ID = '\0' + VIRTUAL_ID;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);

// Added only to the preview build. It:
// - injects the render route /__preview/[region], the draft image route
//   /__preview-media/[file] (a stopgap until the CMS app stages media, phase 2)
//   and the test editor page /__editor;
// - wraps each region component in <div data-preview-region> on the site's
//   pages, by redirecting the pages' imports to a generated wrapper (the site's
//   source stays untouched);
// - adds the bridge script to every page;
// - generates a virtual module that hands the routes the region components,
//   every image under src/, and where to keep uploads.
export default function previewRenderServer(site: ResolvedSiteConfig): AstroIntegration {
  return {
    name: 'preview-render-server',
    hooks: {
      // Runs once per build, before Astro resolves its config: everything the
      // preview needs is added here, nothing is written into the site.
      'astro:config:setup': ({ injectRoute, injectScript, updateConfig }) => {
        // Server-rendered routes (the built server answers them on demand).
        injectRoute({
          pattern: '/__preview/[region]',
          entrypoint: new URL('./preview-route.ts', import.meta.url),
          prerender: false,
        });
        injectRoute({
          pattern: '/__preview-media/[file]',
          entrypoint: new URL('./media-route.ts', import.meta.url),
          prerender: false,
        });
        // The test editor is a plain prerendered page.
        injectRoute({
          pattern: '/__editor',
          entrypoint: new URL('../test-editor/editor.astro', import.meta.url),
        });
        // The bridge: a script added to every page; it does nothing unless the
        // page is inside an iframe.
        const bridge = fileURLToPath(new URL('./client/bridge-entry.ts', import.meta.url));
        injectScript('page', `import ${JSON.stringify(toPosix(bridge))};`);

        // Wrapper files first, then the Vite plugins that use them.
        const wrappers = writeRegionWrappers(site);
        updateConfig({
          vite: { plugins: [siteModule(site), regionWrappers(wrappers)] },
        });
      },
    },
  };
}

/** Writes one wrapper .astro file per region into `regionsDir` (outside the
 *  site) and returns normalized component id -> wrapper path, which
 *  `regionWrappers` uses to redirect imports. `display: contents` keeps the
 *  wrapper out of the layout, so the page renders exactly as before. */
export function writeRegionWrappers({
  root,
  regions,
  regionsDir,
}: Pick<ResolvedSiteConfig, 'root' | 'regions' | 'regionsDir'>): Map<string, string> {
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
      if (!importer || importer === RESOLVED_ID || wrapperFiles.has(normalizeId(importer))) return;
      if (!source.endsWith('.astro')) return;
      // Resolve the import the normal way to learn which file it points at;
      // `skipSelf` avoids calling this hook again for the same import.
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
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
export function siteModule({
  root,
  regions,
  mediaDir,
}: Pick<ResolvedSiteConfig, 'root' | 'regions' | 'mediaDir'>): Plugin {
  return {
    name: 'preview-render-server:regions',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;

      // `lines` collects the import statements; the exports below use them.
      const lines: string[] = [];
      // One entry per region: the component (imported) plus plain settings.
      const regionEntries = Object.entries(regions).map(([name, region], i) => {
        lines.push(`import region${i} from ${importPath(root, region.component)};`);
        const fields = { contentDir: region.contentDir ?? '' };
        return `${JSON.stringify(name)}: { component: region${i}, ...${JSON.stringify(fields)} }`;
      });
      // Importing an image makes Vite emit it and gives back its ImageMetadata.
      const imageEntries = findImages(path.join(root, 'src')).map((file, i) => {
        lines.push(`import image${i} from ${importPath(root, file)};`);
        return `${JSON.stringify(toPosix(path.relative(root, file)))}: image${i}`;
      });

      return [
        ...lines,
        `export const regions = { ${regionEntries.join(', ')} };`,
        `export const images = { ${imageEntries.join(', ')} };`,
        `export const mediaDir = ${JSON.stringify(toPosix(mediaDir))};`,
      ].join('\n');
    },
  };
}

export function findImages(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function importPath(root: string, file: string): string {
  return JSON.stringify(toPosix(path.resolve(root, file)));
}

/** Vite ids use forward slashes and may carry a ?query; Windows paths are
 *  case-insensitive. */
export function normalizeId(id: string): string {
  return toPosix(id.split('?')[0]).toLowerCase();
}

function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}
