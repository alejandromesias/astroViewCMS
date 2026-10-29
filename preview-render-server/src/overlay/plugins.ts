// Vite plugins of the content overlay (WORKPLAN task 1.4, SYSTEM-DESIGN.md D8):
// - contentImportRewrite points the site's `astro:content` imports at the shim;
// - dataModules turns imported JSON files into overlay-aware modules.
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { dataKey } from './keys.ts';

const REWRITTEN_EXTENSIONS = new Set([
  '.astro',
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
  '.mdx',
]);
const CONTENT_CONFIG = /^content\.config\.[cm]?[jt]s$/;
// from "astro:content", import "astro:content", import("astro:content")
const IMPORT_PATTERNS = [
  /(\bfrom\s*)(["'])astro:content\2/g,
  /(\bimport\s*\(?\s*)(["'])astro:content\2/g,
];

/** Replaces every import of `astro:content` in `code` with `shimImport`. */
export function rewriteContentImports(
  code: string,
  shimImport: string,
): string {
  const target = JSON.stringify(shimImport);
  return IMPORT_PATTERNS.reduce(
    (out, pattern) => out.replace(pattern, `$1${target}`),
    code,
  );
}

function isInside(file: string, dir: string): boolean {
  const relative = path.relative(dir, file);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Does a module belong to the rewrite? Everything under the site's `src/`
 *  that Vite compiles, except the content config (D8). */
export function isRewritten(file: string, srcDir: string): boolean {
  if (!isInside(file, srcDir)) return false;
  return (
    REWRITTEN_EXTENSIONS.has(path.extname(file)) &&
    !CONTENT_CONFIG.test(path.basename(file))
  );
}

/** `enforce: 'post'`, so it sees the compiled code of `.astro` and `.mdx`
 *  files. Modules outside `src/` (npm packages, integration components) are
 *  not rewritten, so their reads aren't overlaid: they get a build warning
 *  (D8). */
export function contentImportRewrite({
  srcDir,
  shimFile,
}: {
  srcDir: string;
  shimFile: string;
}): Plugin {
  const shim = normalize(shimFile);
  const warned = new Set<string>();
  return {
    name: 'preview-render-server:content-import-rewrite',
    enforce: 'post',
    transform(code, id) {
      if (!code.includes('astro:content') || id.startsWith('\0')) return;
      const file = id.replace(/\?.*/s, '');
      if (normalize(file) === shim) return;
      if (isInside(path.normalize(file), path.normalize(srcDir))) {
        if (!isRewritten(path.normalize(file), path.normalize(srcDir))) return; // the content config
        const out = rewriteContentImports(code, shimFile.replaceAll('\\', '/'));
        return out === code ? undefined : { code: out, map: null };
      }
      // Astro's own runtime and its generated files (.astro/) read
      // `astro:content` legitimately.
      const legitimate =
        /[\\/]node_modules[\\/]astro[\\/]/.test(file) ||
        /[\\/]\.astro[\\/]/.test(file);
      if (!legitimate && !warned.has(file)) {
        warned.add(file);
        this.warn(
          `${file} imports astro:content but is outside src/: its reads won't be overlaid in previews`,
        );
      }
    },
  };
}

/** Turns each JSON file in `files` (absolute paths) that the site's code
 *  imports into a module of Proxies (data-proxy.ts). Only imports from inside
 *  `srcDir` are affected. Primitive top-level values stay as built: a Proxy
 *  can't wrap them (documented limit). */
export function dataModules({
  root,
  srcDir,
  files,
  proxyFile,
}: {
  root: string;
  srcDir: string;
  files: string[];
  proxyFile: string;
}): Plugin {
  const wanted = new Set(files.map((file) => normalize(file)));
  const PREFIX = '\0preview-data:';
  return {
    name: 'preview-render-server:data-modules',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.endsWith('.json') || importer.startsWith('\0'))
        return;
      const from = path.normalize(importer.replace(/\?.*/s, ''));
      if (path.relative(srcDir, from).startsWith('..')) return;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved || !wanted.has(normalize(resolved.id))) return;
      // A suffix that is not .json, so Vite's own JSON plugin leaves it alone.
      return `${PREFIX}${path.normalize(resolved.id.replace(/\?.*/s, ''))}.js`;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return;
      const file = id.slice(PREFIX.length, -'.js'.length);
      return dataModuleSource(
        JSON.parse(fs.readFileSync(file, 'utf8')),
        dataKey(toPosix(path.relative(root, file))),
        proxyFile,
      );
    },
  };
}

/** The source of a data module for `built` (the parsed JSON file). */
export function dataModuleSource(
  built: unknown,
  key: string,
  proxyFile: string,
): string {
  const lines = [
    `import { proxyData } from ${JSON.stringify(proxyFile.replaceAll('\\', '/'))};`,
    `const built = ${JSON.stringify(built)};`,
    `export default (typeof built === 'object' && built !== null) ? proxyData(${JSON.stringify(key)}, built) : built;`,
  ];
  if (typeof built === 'object' && built !== null && !Array.isArray(built)) {
    for (const [name, value] of Object.entries(built)) {
      if (!/^[A-Za-z_$][\w$]*$/.test(name) || RESERVED.has(name)) continue;
      lines.push(
        typeof value === 'object' && value !== null
          ? `export const ${name} = proxyData(${JSON.stringify(key)}, built[${JSON.stringify(name)}], ${JSON.stringify(name)});`
          : `export const ${name} = built[${JSON.stringify(name)}];`,
      );
    }
  }
  return lines.join('\n');
}

const RESERVED = new Set([
  'default',
  'class',
  'function',
  'var',
  'let',
  'const',
  'import',
  'export',
  'new',
  'delete',
  'if',
  'else',
  'return',
  'switch',
  'case',
  'for',
  'while',
  'do',
  'break',
  'continue',
  'typeof',
  'void',
  'null',
  'true',
  'false',
  'this',
  'super',
  'in',
  'of',
  'try',
  'catch',
  'throw',
  'with',
  'yield',
  'await',
  'enum',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'eval',
  'arguments',
  'debugger',
  'instanceof',
  'extends',
]);

function normalize(p: string): string {
  return p.replaceAll('\\', '/').replace(/\?.*/s, '').toLowerCase();
}

function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}
