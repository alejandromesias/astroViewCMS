import fs from 'node:fs';
import path from 'node:path';

const VIRTUAL_ID = 'virtual:preview-islands';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);

// Added only to the preview build. It injects the /__preview/[island] route
// and a virtual module that hands the route the site's island components plus
// every image under src/, so drafts can point at images that exist at build
// time.
export default function previewRenderServer({ root, islands }) {
  return {
    name: 'preview-render-server',
    hooks: {
      'astro:config:setup': ({ injectRoute, updateConfig }) => {
        injectRoute({
          pattern: '/__preview/[island]',
          entrypoint: new URL('./preview-route.js', import.meta.url),
          prerender: false,
        });
        updateConfig({
          vite: { plugins: [islandsModule(root, islands)] },
        });
      },
    },
  };
}

function islandsModule(root, islands) {
  return {
    name: 'preview-render-server:islands',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;

      const lines = [];
      const islandEntries = Object.entries(islands).map(([name, island], i) => {
        lines.push(`import island${i} from ${importPath(root, island.component)};`);
        return `${JSON.stringify(name)}: { component: island${i}, contentDir: ${JSON.stringify(island.contentDir ?? '')} }`;
      });
      const imageEntries = findImages(path.join(root, 'src')).map((file, i) => {
        lines.push(`import image${i} from ${importPath(root, file)};`);
        return `${JSON.stringify(toPosix(path.relative(root, file)))}: image${i}`;
      });

      return [
        ...lines,
        `export const islands = { ${islandEntries.join(', ')} };`,
        `export const images = { ${imageEntries.join(', ')} };`,
      ].join('\n');
    },
  };
}

function findImages(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function importPath(root, file) {
  return JSON.stringify(toPosix(path.resolve(root, file)));
}

function toPosix(p) {
  return p.replaceAll('\\', '/');
}
