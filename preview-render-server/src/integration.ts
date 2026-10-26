import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import type { Plugin } from 'vite';
import type { ResolvedSiteConfig } from './types.ts';

export const VIRTUAL_ID = 'virtual:preview-islands';
export const RESOLVED_ID = '\0' + VIRTUAL_ID;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);

// Added only to the preview build. It:
// - injects the render route /__preview/[island], the draft image route
//   /__preview-media/[file] and the test editor page /__editor;
// - wraps each island component in <div data-preview-island> on the site's
//   pages, by redirecting the pages' imports to a generated wrapper (the site's
//   source stays untouched);
// - adds the bridge script to every page;
// - generates a virtual module that hands the routes the island components,
//   every image under src/, and where to keep uploads.
export default function previewRenderServer(site: ResolvedSiteConfig): AstroIntegration {
  return {
    name: 'preview-render-server',
    hooks: {
      'astro:config:setup': ({ injectRoute, injectScript, updateConfig }) => {
        injectRoute({
          pattern: '/__preview/[island]',
          entrypoint: new URL('./preview-route.ts', import.meta.url),
          prerender: false,
        });
        injectRoute({
          pattern: '/__preview-media/[file]',
          entrypoint: new URL('./media-route.ts', import.meta.url),
          prerender: false,
        });
        injectRoute({
          pattern: '/__editor',
          entrypoint: new URL('../test-editor/editor.astro', import.meta.url),
        });
        const bridge = fileURLToPath(new URL('./client/bridge-entry.ts', import.meta.url));
        injectScript('page', `import ${JSON.stringify(toPosix(bridge))};`);

        const wrappers = writeIslandWrappers(site);
        updateConfig({
          vite: { plugins: [islandsModule(site), islandWrappers(wrappers)] },
        });
      },
    },
  };
}

/** Writes one wrapper .astro file per island and returns
 *  normalized component id -> wrapper path. `display: contents` keeps the
 *  wrapper out of the layout, so the page renders exactly as before. */
export function writeIslandWrappers({
  root,
  islands,
  islandsDir,
}: Pick<ResolvedSiteConfig, 'root' | 'islands' | 'islandsDir'>): Map<string, string> {
  fs.mkdirSync(islandsDir, { recursive: true });
  const wrappers = new Map<string, string>();
  for (const [name, island] of Object.entries(islands)) {
    const component = path.resolve(root, island.component);
    const wrapper = path.join(islandsDir, `${name}.astro`);
    fs.writeFileSync(wrapper, wrapperSource(name, component));
    wrappers.set(normalizeId(component), toPosix(wrapper));
  }
  return wrappers;
}

export function wrapperSource(name: string, component: string): string {
  return [
    '---',
    `import Island from ${JSON.stringify(toPosix(component))};`,
    '---',
    `<div style="display: contents" data-preview-island=${JSON.stringify(name)}><Island {...Astro.props} /></div>`,
    '',
  ].join('\n');
}

/** Points every import of an island component at its wrapper, except the
 *  wrapper's own import and the render route's (through the virtual module),
 *  which need the bare component. */
export function islandWrappers(wrappers: Map<string, string>): Plugin {
  const wrapperFiles = new Set([...wrappers.values()].map(normalizeId));
  return {
    name: 'preview-render-server:island-wrappers',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer === RESOLVED_ID || wrapperFiles.has(normalizeId(importer))) return;
      if (!source.endsWith('.astro')) return;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return;
      return wrappers.get(normalizeId(resolved.id));
    },
  };
}

/** The `virtual:preview-islands` module (typed in virtual.d.ts). */
export function islandsModule({
  root,
  islands,
  mediaDir,
}: Pick<ResolvedSiteConfig, 'root' | 'islands' | 'mediaDir'>): Plugin {
  return {
    name: 'preview-render-server:islands',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;

      const lines: string[] = [];
      const islandEntries = Object.entries(islands).map(([name, island], i) => {
        lines.push(`import island${i} from ${importPath(root, island.component)};`);
        const fields = {
          contentDir: island.contentDir ?? '',
          contentFile: island.content ? toPosix(path.resolve(root, island.content.file)) : null,
          contentProps: island.content?.props ?? [],
        };
        return `${JSON.stringify(name)}: { component: island${i}, ...${JSON.stringify(fields)} }`;
      });
      const imageEntries = findImages(path.join(root, 'src')).map((file, i) => {
        lines.push(`import image${i} from ${importPath(root, file)};`);
        return `${JSON.stringify(toPosix(path.relative(root, file)))}: image${i}`;
      });

      return [
        ...lines,
        `export const islands = { ${islandEntries.join(', ')} };`,
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
