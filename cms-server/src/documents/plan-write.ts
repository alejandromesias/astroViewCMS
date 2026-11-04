// Plans the files one save writes (WORKPLAN 2.5a, PHASE-2-DESIGN 5.2). A save is a list of changes: an update or a
// delete of a document by its key, or a create of `collection/id`. The planner reads the working copy only through
// `ctx.readText` and returns one file operation per path. It writes nothing: 2.5c joins the paths to the repo root.
import { posix } from 'node:path';
import type { CollectionSchemaJson } from 'preview-contract';
import type { DocumentEntry } from '../bundle/read.ts';
import { codecFor } from '../codecs/by-format.ts';
import { changeEntry, type EntryChange } from '../codecs/file-entries.ts';
import { CodecError } from '../codecs/types.ts';
import type { CmsConfig } from '../config/schema.ts';
import { formatOfExtension, globIdOf, slugOf } from './paths.ts';
import { entryOf } from './read.ts';

/** One change in a save: an update or a delete of a document by its key, or a create of `collection/id`. */
export type WriteChange =
  | { readonly op: 'update'; readonly key: string; readonly value: unknown }
  | { readonly op: 'delete'; readonly key: string }
  | {
      readonly op: 'create';
      readonly collection: string;
      readonly id: string;
      readonly value: unknown;
    };

/** One file operation: write `text` to `path`, or delete the file at `path`. Paths are relative to siteDir. */
export type FileOp =
  | { readonly op: 'write'; readonly path: string; readonly text: string }
  | { readonly op: 'delete'; readonly path: string };

/** What the planner knows: the working copy (through `readText`), the bundle's documents and loaders, and the config. */
export interface PlanContext {
  /** The text of the file at `path` (relative to siteDir), or null when it is missing. May reject. */
  readonly readText: (path: string) => Promise<string | null>;
  /** The bundle's documents by key (documents.json). */
  readonly documents: ReadonlyMap<string, DocumentEntry>;
  /** The bundle's collections by name (schema.json). A collection without a loader has no `loader`. */
  readonly collections: ReadonlyMap<string, CollectionSchemaJson>;
  /** The config, for `newEntryFormat` of each collection. */
  readonly config: Pick<CmsConfig, 'collections'>;
}

/** Why a save is refused (the codes of the 2026-11-03 gaps block). */
export type WritePlanCode =
  | 'read-only'
  | 'unreadable'
  | 'outside-site'
  | 'pattern-mismatch'
  | 'exists'
  | 'file-missing'
  | 'duplicate-key'
  | 'unwritable';

/** A save the planner refuses. `file`, `line` and `column` are set when a CodecError caused the refusal. */
export class WritePlanError extends Error {
  readonly code: WritePlanCode;
  readonly key: string;
  readonly file: string | undefined;
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(
    code: WritePlanCode,
    key: string,
    message: string,
    where: {
      file?: string | undefined;
      line?: number | undefined;
      column?: number | undefined;
    } = {},
  ) {
    super(message);
    this.name = 'WritePlanError';
    this.code = code;
    this.key = key;
    this.file = where.file;
    this.line = where.line;
    this.column = where.column;
  }
}

/** The running text of each path the save touches: a string, or null when this save deletes the file. */
type Running = Map<string, string | null>;

/** Plans the file operations of one save. Throws a WritePlanError for the first change that cannot be saved. */
export async function planWrite(
  changes: readonly WriteChange[],
  ctx: PlanContext,
): Promise<FileOp[]> {
  const keys = new Set<string>();
  const running: Running = new Map();
  for (const change of changes) {
    const key =
      change.op === 'create' ? `${change.collection}/${change.id}` : change.key;
    if (keys.has(key))
      throw new WritePlanError(
        'duplicate-key',
        key,
        `More than one change to "${key}" in one save`,
      );
    keys.add(key);
    if (change.op === 'create') await planCreate(change, key, ctx, running);
    else await planExisting(change, ctx, running);
  }
  return [...running].map(
    ([path, text]): FileOp =>
      text === null ? { op: 'delete', path } : { op: 'write', path, text },
  );
}

/** Plans an update or a delete of a document the bundle holds. */
async function planExisting(
  change: Extract<WriteChange, { op: 'update' | 'delete' }>,
  ctx: PlanContext,
  running: Running,
): Promise<void> {
  const { key } = change;
  const record = ctx.documents.get(key);
  if (record === undefined)
    throw new WritePlanError(
      'unwritable',
      key,
      `There is no document "${key}"`,
    );
  if (record.editable === false)
    throw new WritePlanError(
      'read-only',
      key,
      `The document "${key}" is read-only`,
    );
  const { file, entryKey } = record;
  if (file === undefined)
    throw new WritePlanError(
      'unwritable',
      key,
      `The document "${key}" has no file`,
    );
  if (!isSafePath(file))
    throw new WritePlanError(
      'outside-site',
      key,
      `"${file}" is outside the site`,
    );
  const codec = codecFor(record.format);
  if (codec === null)
    throw new WritePlanError(
      'unwritable',
      key,
      `The format "${record.format}" cannot be written`,
    );
  if (entryKey !== undefined) {
    // An entry of a `file()` collection: only that entry changes inside the shared file.
    const entry: EntryChange =
      change.op === 'delete'
        ? { op: 'remove', key: entryKey }
        : { op: 'replace', key: entryKey, value: change.value };
    const text = await editableText(file, key, ctx, running);
    running.set(
      file,
      codecStep(key, file, () =>
        changeEntry({ name: record.format, codec }, text, entry),
      ),
    );
    return;
  }
  if (change.op === 'delete') {
    // A document that is a file of its own: the file goes.
    await editableText(file, key, ctx, running);
    running.set(file, null);
    return;
  }
  // A document that is a file of its own: its value is written in place of the file's text.
  const value = change.value;
  const text = await editableText(file, key, ctx, running);
  running.set(
    file,
    codecStep(key, file, () => codec.write(text, value)),
  );
}

/** Plans a create of `collection/id`: a new file in a glob collection, or a new entry in a `file()` collection. */
async function planCreate(
  change: Extract<WriteChange, { op: 'create' }>,
  key: string,
  ctx: PlanContext,
  running: Running,
): Promise<void> {
  const { collection, id, value } = change;
  if (ctx.collections.get(collection)?.readOnly === true)
    throw new WritePlanError(
      'read-only',
      key,
      `The collection "${collection}" is read-only`,
    );
  if (!isSafePath(id))
    throw new WritePlanError(
      'outside-site',
      key,
      `The id "${id}" is not a path inside the site`,
    );
  const loader = ctx.collections.get(collection)?.loader;
  if (loader === undefined)
    throw new WritePlanError(
      'unwritable',
      key,
      `The collection "${collection}" has no loader to write into`,
    );
  if (loader.kind === 'file') {
    // The loader's pattern is the shared file itself, which must exist: the planner never creates it.
    const path = loader.pattern;
    if (!isSafePath(path))
      throw new WritePlanError(
        'outside-site',
        key,
        `"${path}" is outside the site`,
      );
    const format = formatOfExtension(posix.extname(path).slice(1));
    const codec = format === undefined ? null : codecFor(format);
    if (format === undefined || codec === null)
      throw new WritePlanError(
        'unwritable',
        key,
        `The file "${path}" has no format the CMS can write`,
      );
    const text = await currentText(path, key, ctx, running);
    if (text === null)
      throw new WritePlanError(
        'file-missing',
        key,
        `The file "${path}" is missing`,
        { file: path },
      );
    const existing = codecStep(key, path, () => entryOf(codec.parse(text), id));
    if (existing !== undefined)
      throw new WritePlanError(
        'exists',
        key,
        `An entry with the id "${id}" already exists`,
        { file: path },
      );
    running.set(
      path,
      codecStep(key, path, () =>
        changeEntry({ name: format, codec }, text, {
          op: 'add',
          key: id,
          value,
        }),
      ),
    );
    return;
  }
  // A glob with its own generateId (2.0j): the id is not a file name, so no file can be named for it.
  if (loader.customId === true)
    throw new WritePlanError(
      'unwritable',
      key,
      `The id "${id}" of "${collection}" cannot be turned into a path: its ids come from generateId`,
    );
  // A glob collection: each entry is a file of its own, `base/id.ext`, and the id must match the pattern.
  const configured = Object.hasOwn(ctx.config.collections, collection)
    ? ctx.config.collections[collection]?.newEntryFormat
    : undefined;
  const ext = configured ?? firstExtension(loader.pattern);
  const format = ext === undefined ? undefined : formatOfExtension(ext);
  const codec = format === undefined ? null : codecFor(format);
  if (ext === undefined || format === undefined || codec === null)
    throw new WritePlanError(
      'unwritable',
      key,
      `No format the CMS can write for the collection "${collection}"`,
    );
  const rel = `${id}.${ext}`;
  if (!posix.matchesGlob(rel, loader.pattern))
    throw new WritePlanError(
      'pattern-mismatch',
      key,
      `"${rel}" does not match the loader pattern "${loader.pattern}"`,
    );
  // The build gives the file its id from its frontmatter slug or its path (paths.ts). A id it would not give is refused,
  // so the saved document has the key that was asked for: a caller's "My Post" is refused, not saved as "my-post".
  const built = globIdOf(rel, slugOf(value, format));
  if (built !== id)
    throw new WritePlanError(
      'pattern-mismatch',
      key,
      `The id "${id}" would be saved as "${built}": the build gives a file its id from its frontmatter slug or its path`,
    );
  const path = posix.join(loader.base ?? '.', rel);
  if (!isSafePath(path))
    throw new WritePlanError(
      'outside-site',
      key,
      `"${path}" is outside the site`,
    );
  if ((await currentText(path, key, ctx, running)) !== null)
    throw new WritePlanError(
      'exists',
      key,
      `The file "${path}" already exists`,
      { file: path },
    );
  running.set(
    path,
    codecStep(key, path, () => codec.write('', value)),
  );
}

/** The running text of `path`, or the working copy's text when no change has touched it yet. Null when the file is missing or deleted. */
async function currentText(
  path: string,
  key: string,
  ctx: PlanContext,
  running: Running,
): Promise<string | null> {
  const known = running.get(path);
  if (known !== undefined) return known;
  try {
    return await ctx.readText(path);
  } catch {
    throw new WritePlanError(
      'unreadable',
      key,
      `The file "${path}" cannot be read`,
      { file: path },
    );
  }
}

/** The running text of `path` for an edit. The file must exist, else the refusal is file-missing. */
async function editableText(
  path: string,
  key: string,
  ctx: PlanContext,
  running: Running,
): Promise<string> {
  const text = await currentText(path, key, ctx, running);
  if (text === null)
    throw new WritePlanError(
      'file-missing',
      key,
      `The file "${path}" is missing`,
      { file: path },
    );
  return text;
}

/** Runs one codec call. A CodecError becomes an `unwritable` WritePlanError that names the file and the position. */
function codecStep<T>(key: string, file: string, step: () => T): T {
  try {
    return step();
  } catch (error) {
    if (error instanceof CodecError)
      throw new WritePlanError('unwritable', key, error.message, {
        file,
        line: error.line,
        column: error.column,
      });
    throw error;
  }
}

/** True for a relative path inside the site: no backslash, not absolute, and no empty, `.` or `..` segment. */
function isSafePath(path: string): boolean {
  if (path.includes('\\') || posix.isAbsolute(path)) return false;
  return path
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..');
}

/** The first extension a glob pattern names: `md` for a brace list such as `*.{md,mdx}`, `json` for `*.json`. Undefined when there is none. */
function firstExtension(pattern: string): string | undefined {
  const brace = /\.\{([^}]*)\}$/.exec(pattern);
  if (brace !== null) return brace[1]?.split(',')[0];
  return /\.([A-Za-z0-9]+)$/.exec(pattern)?.[1];
}
