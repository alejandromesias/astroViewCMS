// Static import scan (SYSTEM-DESIGN.md D1): which JSON files under the site's
// src/ are imported by build code, and which by the site's pages and
// components. Build code is anything that runs to produce the build rather
// than inside a page render: astro.config.* and the Tailwind plugins that CSS
// `@plugin` / `@config` directives load, with the local modules they import.
import fs from 'node:fs';
import path from 'node:path';
import { init, parse } from 'es-module-lexer';

const CODE_EXTENSIONS = new Set([
  '.astro',
  '.ts',
  '.mts',
  '.js',
  '.mjs',
  '.cjs',
  '.tsx',
  '.jsx',
  '.mdx',
]);
const RESOLVE_EXTENSIONS = [
  '.ts',
  '.mts',
  '.js',
  '.mjs',
  '.cjs',
  '.tsx',
  '.jsx',
  '.astro',
  '.json',
];
const CONFIG_NAMES = ['mjs', 'js', 'ts', 'mts', 'cjs'].map(
  (ext) => `astro.config.${ext}`,
);

export interface ProjectScan {
  /** JSON files under src/ imported (directly or through helper modules) by
   *  build code. Project-relative, forward slashes. */
  buildTimeFiles: string[];
  /** JSON files under src/ imported by any code under src/ (data modules),
   *  plus the build-time ones. */
  dataModules: string[];
}

export async function scanProject(root: string): Promise<ProjectScan> {
  await init;
  const aliases = readAliases(root);
  const srcDir = path.join(root, 'src');
  const sourceFiles = walk(srcDir).filter((file) =>
    CODE_EXTENSIONS.has(path.extname(file)),
  );

  // Everything any source file imports (one level), for the data modules.
  const dataModules = new Set<string>();
  for (const file of sourceFiles) {
    for (const target of importTargets(file, aliases, root)) {
      if (isJsonUnder(target, srcDir)) dataModules.add(target);
    }
  }

  // The graph from the build roots, recursively.
  const buildTime = new Set<string>();
  const seen = new Set<string>();
  const queue = [...buildRoots(root, srcDir)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const target of importTargets(file, aliases, root)) {
      if (target.endsWith('.json')) {
        if (isJsonUnder(target, srcDir)) buildTime.add(target);
      } else {
        queue.push(target);
      }
    }
  }

  const relative = (files: Set<string>) =>
    [...files].map((file) => toPosix(path.relative(root, file))).sort();
  return {
    buildTimeFiles: relative(buildTime),
    dataModules: relative(new Set([...dataModules, ...buildTime])),
  };
}

/** astro.config.*, plus the targets of `@plugin` / `@config` in the CSS. */
function buildRoots(root: string, srcDir: string): string[] {
  const roots = CONFIG_NAMES.map((name) => path.join(root, name)).filter(
    (file) => fs.existsSync(file),
  );
  for (const css of walk(srcDir).filter((file) => file.endsWith('.css'))) {
    for (const spec of cssDirectiveTargets(fs.readFileSync(css, 'utf8'))) {
      if (!spec.startsWith('.')) continue; // npm packages aren't local code
      const target = resolveFile(path.resolve(path.dirname(css), spec));
      if (target) roots.push(target);
    }
  }
  return roots;
}

/** Targets of `@plugin "x"` and `@config "x"` in a stylesheet. */
export function cssDirectiveTargets(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [
    ...withoutComments.matchAll(/@(?:plugin|config)\s+["']([^"']+)["']/g),
  ].map((match) => match[1]!);
}

/** Specifiers that a source file imports, as written. JavaScript goes through
 *  es-module-lexer; TypeScript and `.astro` files (not valid JavaScript) fall
 *  back to a pattern match on their import statements. */
export function importSpecifiers(file: string, source: string): string[] {
  if (['.js', '.mjs', '.cjs'].includes(path.extname(file))) {
    try {
      const [imports] = parse(source);
      return imports.flatMap((entry) =>
        entry.specifier ? [entry.specifier] : [],
      );
    } catch {
      // Not parseable as plain JavaScript (JSX in a .js file, say): match instead.
    }
  }
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((match) => match[1]!);
}

function importTargets(file: string, aliases: Alias[], root: string): string[] {
  const specifiers = importSpecifiers(file, fs.readFileSync(file, 'utf8'));
  const targets: string[] = [];
  for (const spec of specifiers) {
    const target = resolveSpecifier(spec, file, aliases, root);
    if (target) targets.push(target);
  }
  return targets;
}

// -- Resolution -------------------------------------------------------------

export interface Alias {
  /** Text before the `*` ("@/components/"), or the whole specifier. */
  prefix: string;
  wildcard: boolean;
  /** Absolute targets, with `*` still in them. */
  targets: string[];
}

/** The `paths` aliases of the site's tsconfig.json (best effort: comments and
 *  trailing commas are tolerated, `extends` is not followed). */
export function readAliases(root: string): Alias[] {
  const tsconfig = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(tsconfig)) return [];
  try {
    const text = stripJsonComments(fs.readFileSync(tsconfig, 'utf8'));
    const { compilerOptions = {} } = JSON.parse(text) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    const base = path.resolve(root, compilerOptions.baseUrl ?? '.');
    return Object.entries(compilerOptions.paths ?? {}).map(
      ([pattern, targets]) => ({
        prefix: pattern.replace(/\*$/, ''),
        wildcard: pattern.endsWith('*'),
        targets: targets.map((target) => path.resolve(base, target)),
      }),
    );
  } catch {
    return [];
  }
}

/** Removes comments and trailing commas from JSON-with-comments, leaving
 *  strings alone: the globs in "include" contain what looks like a comment
 *  terminator. */
export function stripJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"')
        end += text[end] === '\\' ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      i = i === -1 ? text.length : i + 1;
    } else {
      out += char;
    }
  }
  return dropTrailingCommas(out);
}

/** Removes a comma followed only by whitespace and a closing bracket, except
 *  inside strings. */
function dropTrailingCommas(text: string): string {
  const trailing = /,(?=\s*[}\]])/y;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"')
        end += text[end] === '\\' ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end;
    } else {
      trailing.lastIndex = i;
      if (!trailing.test(text)) out += char;
    }
  }
  return out;
}

/** The local file a specifier points at, or undefined for packages, URLs and
 *  anything outside the site. */
export function resolveSpecifier(
  spec: string,
  from: string,
  aliases: Alias[],
  root: string,
): string | undefined {
  if (spec.startsWith('.'))
    return inside(resolveFile(path.resolve(path.dirname(from), spec)), root);
  // The longest matching alias prefix wins, as in TypeScript.
  const alias = aliases
    .filter((a) => (a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!alias) return undefined;
  const rest = alias.wildcard ? spec.slice(alias.prefix.length) : '';
  for (const target of alias.targets) {
    const found = resolveFile(path.normalize(target.replace('*', rest)));
    if (found) return inside(found, root);
  }
}

/** Adds the extension or index file that makes `base` a real file. */
function resolveFile(base: string): string | undefined {
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => base + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
}

function inside(file: string | undefined, root: string): string | undefined {
  if (!file) return undefined;
  const relative = path.relative(root, file);
  return relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes('node_modules')
    ? undefined
    : file;
}

function isJsonUnder(file: string, dir: string): boolean {
  return file.endsWith('.json') && !path.relative(dir, file).startsWith('..');
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}
