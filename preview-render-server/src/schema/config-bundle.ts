import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import type { Plugin } from 'rolldown';
import type { CollectionInfo } from './stubs-flavor1.ts';

export const STUBS = {
  1: fileURLToPath(new URL('./stubs-flavor1.ts', import.meta.url)),
  2: fileURLToPath(new URL('./stubs-flavor2.ts', import.meta.url)),
};

/** Finds the site's content config (Astro accepts a few names). */
export function findContentConfig(root: string): string | undefined {
  for (const name of ['content.config.ts', 'content.config.mts', 'content.config.js', 'content.config.mjs']) {
    const candidate = path.join(root, 'src', name);
    if (fs.existsSync(candidate)) return candidate;
  }
}

/** Marks the copy of the content config (and of its local imports) that gets
 *  the flavor 2 stubs. Astro loads content.config.ts itself, through the same
 *  Vite plugins, and needs the real `astro:content` there, and pages keep the
 *  real modules too: only modules reached through this query are stubbed. */
export const STUB_QUERY = 'preview-cms-schema';

const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Bundler plugin for the schema pass. In the content config **and in every
 *  local module it imports, recursively**, the imports of `astro:content` and
 *  `astro/loaders` are rewritten to the stub file (sites often keep schema
 *  helpers in their own modules). The stub's own `astro/zod` resolves from the
 *  site, so the schemas use the site's Zod.
 *
 *  Without `query` (flavor 1, a standalone bundle) every module that isn't in
 *  node_modules is rewritten. With `query` (flavor 2, inside the Astro build)
 *  only the config imported with that query is, and the plugin carries the
 *  query onto its local imports, so the rest of the build is unaffected.
 *
 *  It rewrites the source instead of resolving the two specifiers: in an
 *  Astro build, Astro's own resolver for `astro:content` runs first. */
export function schemaStubs(configFile: string, stubFile: string, query?: string): Plugin & { enforce: 'pre' } {
  const config = normalize(configFile);
  const stub = normalize(stubFile);
  const stubImport = JSON.stringify(stubFile.replaceAll('\\', '/'));
  const marked = (id: string) => (query === undefined ? true : id.endsWith(`?${query}`));
  const local = (id: string) => normalize(id) !== stub && !id.includes('node_modules') && !id.startsWith('\0');
  return {
    name: 'preview-render-server:schema-stubs',
    enforce: 'pre',
    transform(code, id) {
      if (!local(id) || !marked(id) || !(query === undefined || CODE_FILE.test(id.split('?')[0]!))) return;
      return code.replace(/(\bfrom\s*)(["'])(?:astro:content|astro\/loaders)\2/g, `$1${stubImport}`);
    },
    async resolveId(source, importer, options) {
      if (!importer) return;
      if (source === 'astro/zod' && normalize(importer) === stub) {
        const resolved = await this.resolve(source, configFile, { ...options, skipSelf: true });
        return resolved ?? undefined;
      }
      // Flavor 2: the config's local imports are the same files with the query.
      if (query !== undefined && importer.endsWith(`?${query}`)) {
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (resolved && !resolved.external && local(resolved.id) && CODE_FILE.test(resolved.id.split('?')[0]!)) {
          return { ...resolved, id: `${resolved.id.split('?')[0]}?${query}` };
        }
        return resolved ?? undefined;
      }
    },
  };
}

/** Bundles the content config with the flavor 1 stubs into one ES module (Zod
 *  inlined) at `outFile`, loads it and returns its `collections`. This is the
 *  pass behind schema.json. */
export async function loadCmsCollections(
  root: string,
  configFile: string,
  outFile: string,
): Promise<Record<string, CollectionInfo>> {
  const tsconfig = path.join(root, 'tsconfig.json');
  const bundle = await rolldown({
    input: configFile,
    cwd: root,
    platform: 'node',
    ...(fs.existsSync(tsconfig) ? { tsconfig } : {}),
    plugins: [schemaStubs(configFile, STUBS[1])],
    logLevel: 'warn',
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await bundle.write({ file: outFile, format: 'esm' });
  await bundle.close();
  const mod = (await import(pathToFileURL(outFile).href + `?t=${Date.now()}`)) as {
    collections: Record<string, CollectionInfo>;
  };
  return mod.collections;
}

function normalize(p: string): string {
  return p.replaceAll('\\', '/').split('?')[0]!.toLowerCase();
}
