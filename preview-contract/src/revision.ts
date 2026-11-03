// Revisions (SYSTEM design 5.3, WORKPLAN 2.0c): a short SHA-256 of a document's
// content. The build writes them into documents.json and cms-server computes
// them from the working copy, so both sides agree without sharing a codec.
import { createHash } from 'node:crypto';

/** SHA-256 of the content, in hex, cut to its first 16 characters. A string is
 *  hashed as UTF-8. Bytes are hashed as they are: an image or any other binary
 *  file must not go through a text decoder, which would make files that differ
 *  only in invalid UTF-8 look the same. */
export function revisionOf(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** The canonical text of one `file()` entry's parsed value: JSON with the keys
 *  sorted at every level and dates as ISO strings. Formatting in the shared
 *  file does not reach it, so it can't change the entry's revision. */
export function canonicalEntryText(value: unknown): string {
  return JSON.stringify(canonical(value));
}

/** The revision of one item of an array `file()`, from its raw value as the file's parser
 *  reads it: the value without its id (`id`, or `slug` when there is no `id`,
 *  as Astro's file loader takes the id). The schema is not applied, so a
 *  default or a key the schema drops can't change the revision (WORKPLAN 2.4b). */
export function revisionOfEntry(entry: unknown): string {
  return revisionOf(canonicalEntryText(withoutId(entry)));
}

/** The revision of one value of an object-keyed `file()`. Astro takes the id from
 *  the object key, so an `id` or `slug` field in the value is data and stays in the
 *  hash: changing it changes the revision. */
export function revisionOfKeyedEntry(value: unknown): string {
  return revisionOf(canonicalEntryText(value));
}

/** A copy of `entry` without the key its id came from: `id` when it is set,
 *  otherwise `slug`. Non-objects are returned as they are. */
function withoutId(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
    return entry;
  const record = entry as Record<string, unknown>;
  if (record.id !== undefined && record.id !== null) {
    const { id: _id, ...rest } = record;
    return rest;
  }
  const { slug: _slug, ...rest } = record;
  return rest;
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    // Object.fromEntries defines each key as an own property, so a key named
    // __proto__ stays a key (see DOCS/IMPLEMENTATION-RECOMMENDATIONS.md, 1).
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}
