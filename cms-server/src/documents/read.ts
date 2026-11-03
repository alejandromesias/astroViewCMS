// Reads one document's file from the working copy and parses it with the codec of its format (WORKPLAN 2.4b).
// A request passes one `FileReads` memo to every read it makes, so a file shared by several `file()` documents is
// read once for the request. Nothing is kept across requests.
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { DocumentRecord } from 'preview-contract';
import { codecFor } from '../codecs/by-format.ts';
import { CodecError } from '../codecs/types.ts';

/** The outcome of parsing a file: its value, or the CodecError that says where it failed. */
export type ParseOutcome =
  | { readonly value: unknown }
  | { readonly error: CodecError };

/** One file of the working copy as it was read: its bytes, and its parse, which runs at most once. */
export interface FileRead {
  readonly bytes: Uint8Array;
  /** The parse of the bytes by the codec of the document's format. Null when that format has no codec. */
  parse(): ParseOutcome | null;
}

/** The files one request has read, by absolute path. A file that is missing is remembered as null. */
export type FileReads = Map<string, Promise<FileRead | null>>;

/**
 * The file `file` (a path relative to `root`) as it is now, read through `reads`. Resolves with null when the
 * file is missing, or when its path leaves `root`: a file name that comes from the bundle is data, not a trusted path.
 */
export function readFileOnce(
  root: string,
  file: string,
  format: DocumentRecord['format'],
  reads: FileReads,
): Promise<FileRead | null> {
  const path = resolve(root, file);
  if (!isInside(root, path)) return Promise.resolve(null);
  const memo = reads.get(path);
  if (memo !== undefined) return memo;
  const read = readFromDisk(root, path, format);
  reads.set(path, read);
  return read;
}

/** True when `path` is strictly inside `root`: not the root itself, not outside it, and not on another drive. */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..';
}

/** Reads the file at `path`, following symlinks: its real path must be inside the real `root`, else it is null
 *  (a symlink can point outside the working copy). A file that does not exist is null; any other read error is thrown. */
async function readFromDisk(
  root: string,
  path: string,
  format: DocumentRecord['format'],
): Promise<FileRead | null> {
  try {
    const real = await realpath(path);
    if (!isInside(await realpath(root), real)) return null;
    return fileRead(await readFile(real), format);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  }
}

/** A FileRead over `bytes`. The parse runs on first use and is kept, so the value and the error come from one parse. */
function fileRead(
  bytes: Uint8Array,
  format: DocumentRecord['format'],
): FileRead {
  let outcome: ParseOutcome | null | undefined;
  return {
    bytes,
    parse() {
      if (outcome === undefined) outcome = parseBytes(bytes, format);
      return outcome;
    },
  };
}

/** Parses `bytes` with the codec of `format`. The text is decoded with a byte-order mark kept, as a UTF-8 read of the file keeps it. A CodecError becomes the error outcome; any other error is thrown. */
function parseBytes(
  bytes: Uint8Array,
  format: DocumentRecord['format'],
): ParseOutcome | null {
  const codec = codecFor(format);
  if (codec === null) return null;
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  try {
    return { value: codec.parse(text) };
  } catch (error) {
    if (error instanceof CodecError) return { error };
    throw error;
  }
}

/**
 * The raw entry `key` of a `file()` file, as its parser reads it (WORKPLAN 2.4b). An array takes the first object
 * whose id (or slug, when it has no id) is the key. An object takes the own property named by the key, so a key such
 * as `toString` is not found. Undefined when there is no such entry.
 */
export function entryOf(parsed: unknown, key: string): unknown {
  if (Array.isArray(parsed)) {
    const items: readonly unknown[] = parsed;
    return items.find((item) => idOf(item) === key);
  }
  if (isRecord(parsed) && Object.hasOwn(parsed, key)) return parsed[key];
  return undefined;
}

/** The id of an entry as Astro's file loader reads it: `id ?? slug`, as text (`rawItem.id ?? rawItem.slug`). Undefined for a value that is not an object or has neither. */
function idOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  const id = item.id ?? item.slug;
  return id === undefined || id === null ? undefined : String(id);
}

/** True for a plain object: not null and not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
