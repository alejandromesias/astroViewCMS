// Changes one entry of a `file()` collection (PHASE-2-DESIGN 5.2). Astro's file loader reads two shapes
// (`astro/dist/content/loaders/file.js`): an array of objects, each with an `id` (or `slug`), or an object
// keyed by id. This layer parses the whole file, changes the one entry and hands the whole value to the
// file's own codec, which keeps the text of every other entry. It edits no text itself.
import { type Codec, CodecError } from './types.ts';

/** A file's format: its name (the `format` of any CodecError) and its codec. */
export interface EntryFormat {
  readonly name: string;
  readonly codec: Codec;
}

/** One change to a single entry. `value` is the entry's new value, and `remove` takes none. */
export type EntryChange =
  | { readonly op: 'replace'; readonly key: string; readonly value: unknown }
  | { readonly op: 'add'; readonly key: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly key: string };

// Astro ignores a string `$schema` key in the keyed shape, so it is not an entry and is refused as a key.
const SCHEMA_KEY = '$schema';

/** Returns `original` with one entry changed. Throws a `CodecError` when the change cannot be made. */
export function changeEntry(
  format: EntryFormat,
  original: string,
  change: EntryChange,
): string {
  if ('value' in change && change.value === undefined)
    throw new CodecError('An entry value cannot be undefined', {
      format: format.name,
    });
  const whole: unknown = format.codec.parse(original);
  if (Array.isArray(whole)) {
    const items: readonly unknown[] = whole;
    return format.codec.write(original, changeArray(items, change, format));
  }
  if (isRecord(whole))
    return format.codec.write(original, changeKeyed(whole, change, format));
  throw new CodecError('Entries must be an array or an object', {
    format: format.name,
  });
}

// The array shape. Items without an id or slug are not entries (Astro skips them), so they are left alone.
function changeArray(
  items: readonly unknown[],
  change: EntryChange,
  format: EntryFormat,
): unknown[] {
  const ids = items.map(idOf);
  checkUnique(ids, format);
  const index = ids.indexOf(change.key);
  if (change.op === 'add') {
    if (index !== -1) throw exists(change.key, format);
    return [...items, arrayEntry(change, usesNumberIds(items), format)];
  }
  if (index === -1) throw missing(change.key, format);
  if (change.op === 'remove')
    return items.filter((_, position) => position !== index);
  const next = [...items];
  next[index] = arrayEntry(change, hasNumberId(items[index]), format);
  return next;
}

// The object that goes into the array. A `value.id` or `slug` must equal the key. When there is none, `id` is
// added first. Its type is passed in: a replace keeps the replaced entry's type, and an add uses the file's.
function arrayEntry(
  change: { readonly key: string; readonly value: unknown },
  numericId: boolean,
  format: EntryFormat,
): Record<string, unknown> {
  const { key, value } = change;
  if (!isRecord(value))
    throw new CodecError('An array entry must be an object', {
      format: format.name,
    });
  const own = idOf(value);
  if (own !== undefined) {
    if (own !== key)
      throw new CodecError(
        `Entry id "${own}" does not match the key "${key}"`,
        { format: format.name },
      );
    return value;
  }
  const id = numericId ? numberId(key, format) : key;
  const pairs: [string, unknown][] = [
    ['id', id],
    ...Object.entries(value).filter(([name]) => name !== 'id'),
  ];
  return Object.fromEntries(pairs);
}

// The keyed shape. Keys are looked up with Object.hasOwn and built with Object.fromEntries (hostile keys).
function changeKeyed(
  entries: Record<string, unknown>,
  change: EntryChange,
  format: EntryFormat,
): Record<string, unknown> {
  const { key } = change;
  if (key === SCHEMA_KEY)
    throw new CodecError(`"${SCHEMA_KEY}" is not an entry`, {
      format: format.name,
    });
  const present = Object.hasOwn(entries, key);
  if (change.op === 'add') {
    if (present) throw exists(key, format);
    const added: [string, unknown][] = [
      ...Object.entries(entries),
      [key, change.value],
    ];
    return Object.fromEntries(added);
  }
  if (!present) throw missing(key, format);
  if (change.op === 'remove')
    return Object.fromEntries(
      Object.entries(entries).filter(([name]) => name !== key),
    );
  const replaced = Object.entries(entries).map(
    ([name, current]): [string, unknown] => [
      name,
      name === key ? change.value : current,
    ],
  );
  return Object.fromEntries(replaced);
}

// Astro's id: `(item.id ?? item.slug)?.toString()`, and an empty id is no id. Non-objects have none.
function idOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  const raw = item.id ?? item.slug;
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw);
  return text === '' ? undefined : text;
}

// Astro throws DuplicateContentEntrySlugError for a repeated id, so the site does not build. The file is read-only.
function checkUnique(
  ids: readonly (string | undefined)[],
  format: EntryFormat,
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id === undefined) continue;
    if (seen.has(id))
      throw new CodecError(
        `Duplicate entry id "${id}": the site does not build with duplicate ids`,
        { format: format.name },
      );
    seen.add(id);
  }
}

function usesNumberIds(items: readonly unknown[]): boolean {
  return items.some(hasNumberId);
}

function hasNumberId(item: unknown): boolean {
  return isRecord(item) && typeof item.id === 'number';
}

// A key that is not a number in its exact text (`03`, `abc`) cannot be a numeric id.
function numberId(key: string, format: EntryFormat): number {
  const number = Number(key);
  if (!Number.isFinite(number) || String(number) !== key)
    throw new CodecError(
      `Entry id "${key}" must be a number, as the file's other ids are`,
      { format: format.name },
    );
  return number;
}

function missing(key: string, format: EntryFormat): CodecError {
  return new CodecError(`No entry with the id "${key}"`, {
    format: format.name,
  });
}

function exists(key: string, format: EntryFormat): CodecError {
  return new CodecError(`An entry with the id "${key}" already exists`, {
    format: format.name,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
