// The reference index (WORKPLAN 2.6a, PHASE-2-DESIGN 4.3): for each document, the documents that point at it. A document
// points where its value has a `cms: 'reference'` field (2.4c walks the schema along those markers), so no site code
// runs. Keys and ids come from content, so the index uses only Maps and Sets. It is kept in memory and never written.
import { collectionOf, documentKey } from '../documents/paths.ts';
import { type SchemaNode, walkMarkers } from '../schema/walk.ts';

/** A document as the index reads it: its key, and its value (the whole file's value, or one entry of a shared file). */
interface IndexedDocument {
  readonly key: string;
  readonly value: unknown;
}

/** The JSON Schema of a collection by its name, or undefined when the collection has none. */
export type CollectionSchemaOf = (collection: string) => SchemaNode | undefined;

/** Which documents point at which. The keys it returns and takes are document keys (`collection/id`). */
export interface ReferenceIndex {
  /** The keys of the documents that point at `key`, sorted. Empty when no document does. */
  referrersOf(key: string): readonly string[];
  /** Records a document's current value, replacing what the document pointed at before. */
  update(key: string, value: unknown): void;
  /**
   * Forgets what a document points at, because it was deleted. Documents that still point at its key stay listed
   * as its referrers: the delete guard (2.6b) needs to see those dangling references.
   */
  remove(key: string): void;
  /** Replaces the whole index with the given documents: at startup, and after a sync. */
  rebuild(documents: Iterable<IndexedDocument>): void;
}

/** A new, empty index. `schemaOf` gives each collection's schema, as schema.json has it. */
export function createReferenceIndex(
  schemaOf: CollectionSchemaOf,
): ReferenceIndex {
  // Referrer key to the target keys it points at, and the reverse. Both are kept, so that an update or a removal
  // finds the old edges without a scan. An update records its targets even when there are none, and a set is never
  // deleted: an empty set answers the same as a missing one.
  const pointsAt = new Map<string, ReadonlySet<string>>();
  const referrers = new Map<string, Set<string>>();

  function unlink(key: string): void {
    for (const target of pointsAt.get(key) ?? new Set<string>()) {
      setOf(referrers, target).delete(key);
    }
    pointsAt.delete(key);
  }

  function update(key: string, value: unknown): void {
    unlink(key);
    const targets = targetsOf(key, value, schemaOf);
    pointsAt.set(key, targets);
    for (const target of targets) setOf(referrers, target).add(key);
  }

  return {
    referrersOf(key) {
      return [...(referrers.get(key) ?? [])].sort();
    },
    update,
    remove: unlink,
    rebuild(documents) {
      pointsAt.clear();
      referrers.clear();
      for (const { key, value } of documents) update(key, value);
    },
  };
}

/** The set under `key` in `map`, created empty when there is none yet. */
function setOf(map: Map<string, Set<string>>, key: string): Set<string> {
  const set = map.get(key) ?? new Set<string>();
  map.set(key, set);
  return set;
}

/**
 * The keys of the documents that a document with `key` and `value` points at. A key with no collection, a `data:` key
 * (its collection is `data:<folder>`, which has no schema) or a collection with no schema points at nothing. A
 * reference hit with no collection (the schema names none) names no document either.
 */
function targetsOf(
  key: string,
  value: unknown,
  schemaOf: CollectionSchemaOf,
): Set<string> {
  const targets = new Set<string>();
  const collection = collectionOf(key);
  const schema = collection === undefined ? undefined : schemaOf(collection);
  if (schema === undefined) return targets;
  walkMarkers(schema, value, (hit) => {
    if (hit.collection === undefined) return;
    const id = idOfReference(hit.value);
    if (id !== undefined) targets.add(documentKey(hit.collection, id));
  });
  return targets;
}

/**
 * The id a reference value names: the string itself, or the `id` of an object (`{ id }`). Any other value names none.
 * `Object(value)` wraps a number, a boolean or an array, whose `id` is undefined, so those need no type check.
 */
function idOfReference(value: unknown): string | undefined {
  const id: unknown = typeof value === 'string' ? value : Object(value).id;
  return typeof id === 'string' ? id : undefined;
}
