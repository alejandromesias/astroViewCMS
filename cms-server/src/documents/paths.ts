// The rules that give a file its document: its format by extension, and the id a glob loader gives it (WORKPLAN 2.5b).
// The id follows Astro 7 (`generateIdDefault` in astro/dist/content/loaders/glob.js, and `getContentEntryIdAndSlug`
// in astro/dist/content/utils.js), so a document created by a save has the key a build gives it. `planWrite` and the
// changeset both use these functions, so the round trip is checked with one rule.
import { posix } from 'node:path';
import { slug as githubSlug } from 'github-slugger';
import type { DocumentRecord } from 'preview-contract';

// The extensions the CMS names a format for (the formats of DocumentRecord). An extension not listed here has no format.
const FORMAT_OF_EXTENSION = new Map<string, DocumentRecord['format']>([
  ['json', 'json'],
  ['md', 'md'],
  ['mdx', 'mdx'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
]);

/** The format an extension names (without its dot), or undefined for an extension the CMS does not know. */
export function formatOfExtension(
  extension: string,
): DocumentRecord['format'] | undefined {
  return FORMAT_OF_EXTENSION.get(extension);
}

/** The format of a file by its extension. A file with no known extension is `other`, which the CMS cannot write. */
export function formatOfPath(path: string): DocumentRecord['format'] {
  return formatOfExtension(posix.extname(path).slice(1)) ?? 'other';
}

/** The collection a document key belongs to: the part before the first slash (D10). Undefined for a key with no slash. */
export function collectionOf(key: string): string | undefined {
  const slash = key.indexOf('/');
  return slash === -1 ? undefined : key.slice(0, slash);
}

/**
 * The key of a collection entry, `collection/id`: the same format preview-render-server writes (D10). The id is not
 * checked and may contain slashes; the collection must not, so that `collectionOf` reads it back.
 */
export function documentKey(collection: string, id: string): string {
  return `${collection}/${id}`;
}

/**
 * The path of `path` relative to a loader's `base` folder, or undefined when the file is not inside it. A base of `.`
 * (or none) is the site folder, so the path is its own relative path.
 */
export function relativeToBase(
  base: string | undefined,
  path: string,
): string | undefined {
  const folder =
    base === undefined ? '.' : posix.normalize(base).replace(/\/+$/, '');
  if (folder === '.') return path;
  return path.startsWith(`${folder}/`)
    ? path.slice(folder.length + 1)
    : undefined;
}

/**
 * The id a glob loader gives the file at `relativePath` (under its base). The frontmatter `slug` wins when it is
 * truthy, as text (Astro: `if (data.slug) return String(data.slug)`). Otherwise the path loses its last extension,
 * each segment goes through github-slugger, and a trailing `/index` is cut (so `blog/index.md` is `blog`).
 */
export function globIdOf(relativePath: string, slug: unknown): string {
  if (slug) return String(slug);
  const withoutExtension = relativePath.slice(
    0,
    relativePath.length - posix.extname(relativePath).length,
  );
  // An arrow, not `.map(githubSlug)`: map would pass the index as the slugger's `maintainCase` argument.
  return withoutExtension
    .split('/')
    .map((segment) => githubSlug(segment))
    .join('/')
    .replace(/\/index$/, '');
}

/**
 * The `slug` of a parsed document, which is what `globIdOf` reads. Markdown and MDX keep their fields under `data`;
 * the other formats keep them at the top. Undefined when there is no such object or no `slug`.
 */
export function slugOf(
  value: unknown,
  format: DocumentRecord['format'],
): unknown {
  const fields =
    (format === 'md' || format === 'mdx') && isRecord(value)
      ? value.data
      : value;
  return isRecord(fields) ? fields.slug : undefined;
}

/** True for a plain object: not null and not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
