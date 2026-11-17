// The rebuild flag of a save (WORKPLAN 2.5c item 7, PHASE-2-DESIGN 5.3, D1). A save asks for a rebuild when the value
// at a build-time field of a document changed (canonical JSON, so key order does not count), or when a document that
// has build-time fields is deleted. A create never asks the save for a rebuild: its record has `buildTime: false`. The build check (2.10k) reads the configured fields of a created document itself.
import { canonicalEntryText } from 'preview-contract';
import type { DocumentEntry } from '../bundle/read.ts';
import type { SaveChange } from './body.ts';

/**
 * True when a change touches a build-time field. `documents` are the documents the save sees, and `stored` the values
 * they had before the save. A field path is dotted (`site.base_url`), and `*` is the whole value (D1).
 */
export function needsRebuild(
  changes: readonly SaveChange[],
  documents: ReadonlyMap<string, DocumentEntry>,
  stored: ReadonlyMap<string, unknown>,
): boolean {
  return changes.some((change) =>
    touches(change, documents.get(change.document)?.buildTimeFields, stored),
  );
}

/**
 * True when a change touches one of `fields`: a deletion does when there are fields, and an update does when the value at
 * one of them differs from its stored value. The build check (2.10k) runs it with a document's build-time fields, and with
 * `body` for an MDX document, over the changeset.
 */
export function touches(
  change: Pick<SaveChange, 'document' | 'deleted' | 'data'>,
  fields: readonly string[] | undefined,
  stored: ReadonlyMap<string, unknown>,
): boolean {
  if (fields === undefined || fields.length === 0) return false;
  if (change.deleted) return true;
  const before = stored.get(change.document);
  return fields.some((path) => differs(before, change.data, path));
}

// True when the value at `path` differs between the two values. A missing value only equals another missing value.
function differs(before: unknown, after: unknown, path: string): boolean {
  const was = valueAt(before, path);
  const now = valueAt(after, path);
  if (was === undefined || now === undefined) return was !== now;
  return canonicalEntryText(was) !== canonicalEntryText(now);
}

// The value at a dotted path of a plain object. Own properties only, so `constructor` finds nothing.
function valueAt(value: unknown, path: string): unknown {
  if (path === '*') return value;
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment))
      return undefined;
    current = current[segment];
  }
  return current;
}

/** True for a plain object: not null and not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
