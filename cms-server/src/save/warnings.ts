// The warnings stage of a save (WORKPLAN 2.7c, PHASE-2-DESIGN 5.5): a new or changed string of a created or updated
// document that looks like an image path under `<siteFolder>/public/`, and whose file is not there, adds a
// `public-image-missing` warning. A warning never blocks a save, so the stage always passes. Only the strings that
// differ from the stored value are checked. A Markdown document is checked by its `data`, never its body. The image()
// fields are skipped (2.7b copies their staged images). A `data:` document has no schema, so all its strings are
// checked. Keys and values come from content, so the stage uses Maps and Sets for them, never a plain object lookup.
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionOf, formatOfExtension } from '../documents/paths.ts';
import { type SchemaNode, walkMarkers } from '../schema/walk.ts';
import type { SaveChange } from './body.ts';
import type { SaveContext, SaveStage } from './context.ts';

/** The code of the warning of a missing image (WORKPLAN 2.7c). */
const PUBLIC_IMAGE_MISSING = 'public-image-missing';

/** The formats whose value is `{ data, body }`: only `data` is checked (as delete-guard.ts reads them). */
const MARKDOWN: ReadonlySet<string> = new Set(['md', 'mdx']);

/** An image extension at the end of a path, in any case. The dot is required (WORKPLAN 2.7c, rule 3). */
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i;

/** One step of a field path: an object key or an array index, as walkMarkers gives it. */
type PathSegment = string | number;

/**
 * The warnings stage (WORKPLAN 2.7c). Appends one warning for each missing `public/` image among the new or changed
 * strings of the created and updated documents, and passes, so that no warning blocks the save.
 */
export const collectWarnings: SaveStage = async (ctx) => {
  for (const change of ctx.changes) {
    if (change.deleted) continue;
    for (const path of await missingImagesOf(change, ctx)) {
      ctx.warnings.push({
        key: change.document,
        path,
        code: PUBLIC_IMAGE_MISSING,
      });
    }
  }
  return undefined;
};

/**
 * The paths of the missing images among the new or changed strings of one change. A document whose collection has no
 * schema is skipped, as its image() fields are unknown. A schema that cannot be walked is logged and skipped, so that a
 * broken schema never fails the save.
 */
async function missingImagesOf(
  change: SaveChange,
  ctx: SaveContext,
): Promise<PathSegment[][]> {
  const { document } = change;
  const isData = document.startsWith('data:');
  const schema = isData ? undefined : schemaOf(document, ctx);
  if (!isData && schema === undefined) return [];
  const markdown = isMarkdownDocument(document, ctx);
  const fields = markdown ? dataOf(change.data) : change.data;
  const stored = ctx.stored.get(document);
  const storedFields =
    stored === undefined ? undefined : markdown ? dataOf(stored) : stored;
  let images: ReadonlySet<string>;
  try {
    images = new Set([
      ...imageShapesOf(schema, fields),
      ...imageShapesOf(schema, storedFields),
    ]);
  } catch (error) {
    ctx.log.warn(
      'the image check of a document is skipped: its schema cannot be walked',
      {
        document,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
    return [];
  }
  const before = countsByShape(storedFields, images);
  const candidates: { readonly path: PathSegment[]; readonly text: string }[] =
    [];
  forEachString(fields, (path, text) => {
    if (images.has(shapeKeyOf(path)) || takeUnchanged(before, path, text))
      return;
    if (looksLikeImagePath(text)) candidates.push({ path, text });
  });
  const missing: PathSegment[][] = [];
  for (const { path, text } of candidates) {
    if (await isMissingImage(text, ctx.siteFolder)) missing.push(path);
  }
  return missing;
}

/** The schema of a document's collection, or undefined when the collection has none. */
function schemaOf(document: string, ctx: SaveContext): SchemaNode | undefined {
  const collection = collectionOf(document);
  if (collection === undefined) return undefined;
  return ctx.bundle.collections.get(collection)?.schema;
}

/**
 * The shapes of the paths that the schema marks `image()`. walkMarkers throws when a `$ref` names no `$defs` entry, so
 * the caller catches it. Without a schema or a value there are no image fields.
 */
function imageShapesOf(
  schema: SchemaNode | undefined,
  value: unknown,
): ReadonlySet<string> {
  const shapes = new Set<string>();
  if (schema === undefined || value === undefined) return shapes;
  walkMarkers(schema, value, (hit) => {
    if (hit.marker === 'image') shapes.add(shapeKeyOf(hit.path));
  });
  return shapes;
}

/**
 * Whether a document holds Markdown values (`{ data, body }`). A document the bundle holds has its format, unless it is
 * one entry of a shared file (a raw value). A create has the format its new file gets (see `createdFormatOf`).
 */
function isMarkdownDocument(document: string, ctx: SaveContext): boolean {
  const known = ctx.documents.get(document);
  if (known !== undefined)
    return MARKDOWN.has(known.format) && known.entryKey === undefined;
  const format = createdFormatOf(document, ctx);
  return format !== undefined && MARKDOWN.has(format);
}

/**
 * The format a create of `document` gets from the planner: the collection's `newEntryFormat`, or else the first
 * extension of its glob pattern (plan-write's rule, as in delete-guard.ts). Undefined when the planner refuses it.
 */
function createdFormatOf(
  document: string,
  ctx: SaveContext,
): string | undefined {
  const collection = collectionOf(document);
  if (collection === undefined) return undefined;
  const loader = ctx.bundle.collections.get(collection)?.loader;
  if (loader?.kind !== 'glob') return undefined;
  const configured = Object.hasOwn(ctx.config.collections, collection)
    ? ctx.config.collections[collection]?.newEntryFormat
    : undefined;
  const extension = configured ?? extensionOfPattern(loader.pattern);
  return extension === undefined ? undefined : formatOfExtension(extension);
}

/** The extension a glob names first: `md` for `*.{md,mdx}`, `json` for `*.json`. Undefined when the pattern names none. */
function extensionOfPattern(pattern: string): string | undefined {
  const brace = /\.\{([^}]*)\}$/.exec(pattern);
  if (brace !== null) return brace[1]?.split(',')[0];
  return /\.([A-Za-z0-9]+)$/.exec(pattern)?.[1];
}

/** The `data` of a Markdown value. A value with no `data` has no fields to check. */
function dataOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'data' in value
    ? value.data
    : undefined;
}

/** Calls `visit` with the path and the text of each string in `value`, in document order. */
function forEachString(
  value: unknown,
  visit: (path: PathSegment[], text: string) => void,
  path: PathSegment[] = [],
): void {
  if (typeof value === 'string') {
    visit(path, value);
  } else if (Array.isArray(value)) {
    value.forEach((item: unknown, index: number) => {
      forEachString(item, visit, [...path, index]);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      forEachString(item, visit, [...path, key]);
    }
  }
}

/**
 * The shape of a path as a Map key: its object keys, with each array index as `null`, so an item keeps its shape when
 * it moves. JSON keeps `null` (an index) and a key of the text `"null"` apart.
 */
function shapeKeyOf(path: readonly PathSegment[]): string {
  return JSON.stringify(
    path.map((segment) => (typeof segment === 'number' ? null : segment)),
  );
}

/**
 * The stored strings of `value` as counts by shape and then text, left out of the image shapes. Counting, not
 * matching by index, is what lets a stored string match a new one wherever it sits in its array: an item that moves,
 * or one inserted in front of it, is not checked again. Duplicates count too, so a new copy of a value is checked.
 */
function countsByShape(
  value: unknown,
  images: ReadonlySet<string>,
): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  forEachString(value, (path, text) => {
    const shape = shapeKeyOf(path);
    if (images.has(shape)) return;
    const byText = counts.get(shape) ?? new Map<string, number>();
    byText.set(text, (byText.get(text) ?? 0) + 1);
    counts.set(shape, byText);
  });
  return counts;
}

/**
 * Whether a stored string has this text at this shape, and uses that stored string up: each stored string matches once.
 */
function takeUnchanged(
  before: Map<string, Map<string, number>>,
  path: readonly PathSegment[],
  text: string,
): boolean {
  const byText = before.get(shapeKeyOf(path));
  const count = byText?.get(text) ?? 0;
  if (byText === undefined || count === 0) return false;
  byText.set(text, count - 1);
  return true;
}

/**
 * Whether a string looks like the path of an image (WORKPLAN 2.7c, rule 3): one leading `/` (not `//`), no `\`, and an
 * image extension once `?query` and `#hash` are cut off.
 */
function looksLikeImagePath(text: string): boolean {
  if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\'))
    return false;
  return IMAGE_EXTENSION.test(cutQueryAndHash(text));
}

/** The text before its first `?` or `#`. */
function cutQueryAndHash(text: string): string {
  const cut = text.search(/[?#]/);
  return cut === -1 ? text : text.slice(0, cut);
}

/**
 * Whether the image that `text` names is missing from `<siteFolder>/public/`. The name is percent-decoded first. A
 * decoded name with a `\`, or one that climbs above `public/`, is missing without a check on disk, so nothing outside
 * the folder is read. (posix.normalize would clamp `/../x.png` to `/x.png`, so the climb is checked on the segments.)
 */
async function isMissingImage(
  text: string,
  siteFolder: string,
): Promise<boolean> {
  const name = decodedOf(cutQueryAndHash(text));
  if (name.includes('\\')) return true;
  const segments = segmentsUnder(name);
  if (segments === undefined) return true;
  return !(await isFile(join(siteFolder, 'public', ...segments)));
}

/** The text percent-decoded. Text that is not valid percent-encoding stays as it is, a name with a literal `%`. */
function decodedOf(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The segments of a decoded path below `public/`, or undefined when the path climbs above `public/`. */
function segmentsUnder(name: string): string[] | undefined {
  const segments: string[] = [];
  for (const part of name.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') segments.push(part);
    else if (segments.length > 0) segments.pop();
    else return undefined;
  }
  return segments;
}

/** Whether `path` is a file. A path that cannot be looked up is not a file. */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
