// Walks a document value against its collection's JSON Schema and reports each field marked `cms: 'reference'`
// or `cms: 'image'` (WORKPLAN 2.4c). Read-only: the value is never changed and no site code runs. The schema is
// plain JSON, so each keyword is type-checked before it is used, and keys from the document are looked up with
// Object.hasOwn, never with a plain object lookup.

/** The markers a schema puts on a field (the `cms` keyword). */
type CmsMarker = 'reference' | 'image';

/** One segment of a path from the document root: an object key or an array index. */
type PathSegment = string | number;

/**
 * One marked field of a value: where it is, its marker, and the value there, passed untouched. A reference hit
 * also carries the `collection` its schema names (2.6a), when it names one. Image hits never carry it.
 */
export interface MarkerHit {
  readonly path: PathSegment[];
  readonly marker: CmsMarker;
  readonly value: unknown;
  readonly collection?: string;
}

/** Receives each marked field. It must not change the value. */
export type MarkerVisitor = (hit: MarkerHit) => void;

/** A JSON Schema node. Its keywords are unknown until each one is checked. */
export type SchemaNode = Readonly<Record<string, unknown>>;

/** What one walk shares: the root schema for `$ref` lookups, the visitor, and the (path, marker) pairs already reported. */
interface WalkState {
  readonly root: SchemaNode;
  readonly visit: MarkerVisitor;
  readonly reported: Set<string>;
}

const DEFS_PREFIX = '#/$defs/';

/**
 * Calls `visit` for each field of `value` that the schema marks `cms: 'reference'` or `cms: 'image'`.
 * An absent or null value is not reported. A marked array reports each of its items at the item's path.
 * A `$ref` into `$defs` is followed; a cycle that does not consume a value stops there. Union keywords
 * (`oneOf`, `anyOf`) use a `const` discriminator when there is one, and otherwise the branches whose type fits.
 * @throws {Error} when a `$ref` names no entry of `$defs`.
 */
export function walkMarkers(
  collectionSchema: SchemaNode,
  value: unknown,
  visit: MarkerVisitor,
): void {
  const state: WalkState = {
    root: collectionSchema,
    visit,
    reported: new Set(),
  };
  walkNode(collectionSchema, value, [], new Set(), state);
}

/**
 * Walks one value against one schema node. `refs` holds the `$ref`s already followed at this value, so a
 * cycle of references that does not consume the value is cut. A child value starts with an empty set.
 */
function walkNode(
  node: SchemaNode,
  value: unknown,
  path: PathSegment[],
  refs: ReadonlySet<string>,
  state: WalkState,
): void {
  if (value === undefined) return;
  const ref = node.$ref;
  if (typeof ref === 'string' && !refs.has(ref)) {
    walkNode(
      refTarget(state.root, ref),
      value,
      path,
      new Set(refs).add(ref),
      state,
    );
  }
  walkOwn(node, value, path, refs, state);
}

/** Applies a node's own keywords (its marker, properties, items and unions) to the value at `path`. */
function walkOwn(
  node: SchemaNode,
  value: unknown,
  path: PathSegment[],
  refs: ReadonlySet<string>,
  state: WalkState,
): void {
  const marker = markerOf(node.cms);
  if (marker !== undefined) reportMarked(node, marker, value, path, state);
  if (Array.isArray(value)) walkArray(node, value, path, state);
  else if (isObject(value)) walkObject(node, value, path, state);
  walkUnion(nodesOf(node.oneOf), value, path, refs, state);
  walkUnion(nodesOf(node.anyOf), value, path, refs, state);
}

/** Walks the declared properties of an object value, then `additionalProperties` for the other keys. */
function walkObject(
  node: SchemaNode,
  value: SchemaNode,
  path: PathSegment[],
  state: WalkState,
): void {
  const declared = propertiesOf(node);
  for (const [key, child] of Object.entries(declared)) {
    if (isObject(child) && Object.hasOwn(value, key)) {
      walkNode(child, value[key], [...path, key], new Set(), state);
    }
  }
  const extra = node.additionalProperties;
  if (!isObject(extra)) return;
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(declared, key)) {
      walkNode(extra, value[key], [...path, key], new Set(), state);
    }
  }
}

/** Walks an array value: the `prefixItems` schemas by index, then `items` for the rest. */
function walkArray(
  node: SchemaNode,
  value: readonly unknown[],
  path: PathSegment[],
  state: WalkState,
): void {
  const prefix: readonly unknown[] = Array.isArray(node.prefixItems)
    ? node.prefixItems
    : [];
  value.forEach((item, index) => {
    const schema = index < prefix.length ? prefix[index] : node.items;
    if (isObject(schema)) {
      walkNode(schema, item, [...path, index], new Set(), state);
    }
  });
}

/**
 * Walks the branches of one union keyword against the value. With a `const` discriminator only the branch
 * whose `const` equals the value's field is walked, and no match walks nothing. Without one, every branch
 * whose type fits the value is walked.
 */
function walkUnion(
  branches: readonly SchemaNode[],
  value: unknown,
  path: PathSegment[],
  refs: ReadonlySet<string>,
  state: WalkState,
): void {
  const key = discriminatorOf(branches, state.root);
  if (key !== undefined) {
    if (!isObject(value) || !Object.hasOwn(value, key)) return;
    for (const branch of branches) {
      if (constOf(branch, key, state.root) === value[key]) {
        walkNode(branch, value, path, refs, state);
      }
    }
    return;
  }
  for (const branch of branches) {
    const target = resolved(branch, state.root);
    if (target !== undefined && typeFits(target.type, value)) {
      walkNode(branch, value, path, refs, state);
    }
  }
}

/**
 * Reports a marked value. A marked array reports each item, at the item's own path. A reference names the
 * collection its node's `collection` keyword gives, if that keyword is a string.
 */
function reportMarked(
  node: SchemaNode,
  marker: CmsMarker,
  value: unknown,
  path: PathSegment[],
  state: WalkState,
): void {
  const collection =
    marker === 'reference' && typeof node.collection === 'string'
      ? node.collection
      : undefined;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      reportOne(marker, collection, item, [...path, index], state);
    });
    return;
  }
  reportOne(marker, collection, value, path, state);
}

/** Reports one value once per path and marker. A null or undefined value is not a reference or an image. */
function reportOne(
  marker: CmsMarker,
  collection: string | undefined,
  value: unknown,
  path: PathSegment[],
  state: WalkState,
): void {
  if (value === null || value === undefined) return;
  const key = JSON.stringify([path, marker]);
  if (state.reported.has(key)) return;
  state.reported.add(key);
  state.visit(
    collection === undefined
      ? { path: [...path], marker, value }
      : { path: [...path], marker, value, collection },
  );
}

/** Follows the `$ref` links of a node to the schema they name. A cycle of links that never reaches a schema gives undefined. */
function resolved(node: SchemaNode, root: SchemaNode): SchemaNode | undefined {
  let current = node;
  const seen = new Set<string>();
  while (typeof current.$ref === 'string') {
    const ref = current.$ref;
    if (seen.has(ref)) return undefined;
    seen.add(ref);
    current = refTarget(root, ref);
  }
  return current;
}

/** The schema a `$ref` names in `$defs`. Only the form `#/$defs/<name>` is supported. */
function refTarget(root: SchemaNode, ref: string): SchemaNode {
  const defs = isObject(root.$defs) ? root.$defs : {};
  const name = ref.startsWith(DEFS_PREFIX)
    ? ref.slice(DEFS_PREFIX.length)
    : undefined;
  const target =
    name !== undefined && Object.hasOwn(defs, name) ? defs[name] : undefined;
  if (!isObject(target)) throw new Error(`unresolved $ref "${ref}"`);
  return target;
}

/**
 * The name of a property that every branch fixes with a `const`, or undefined when there is none. The name
 * is taken from the first branch's properties, in their order.
 */
function discriminatorOf(
  branches: readonly SchemaNode[],
  root: SchemaNode,
): string | undefined {
  const targets: SchemaNode[] = [];
  for (const branch of branches) {
    const target = resolved(branch, root);
    if (target === undefined) return undefined;
    targets.push(target);
  }
  const [first] = targets;
  if (first === undefined) return undefined;
  return Object.keys(propertiesOf(first)).find((key) =>
    targets.every((target) => constOf(target, key, root) !== undefined),
  );
}

/** The `const` that a branch sets for one of its properties, or undefined when it sets none. */
function constOf(node: SchemaNode, key: string, root: SchemaNode): unknown {
  const target = resolved(node, root);
  if (target === undefined) return undefined;
  const declared = propertiesOf(target);
  if (!Object.hasOwn(declared, key)) return undefined;
  const property = declared[key];
  if (!isObject(property)) return undefined;
  return resolved(property, root)?.const;
}

/**
 * Whether a value fits a schema `type`: a name, or a list of names such as `['object', 'null']`. A schema with
 * no `type` fits any value, as in JSON Schema.
 */
function typeFits(type: unknown, value: unknown): boolean {
  if (type === undefined) return true;
  const names: readonly unknown[] = Array.isArray(type) ? type : [type];
  return names.some((name) => matchesType(name, value));
}

/** Whether a value has one JSON Schema type name. An unknown name fits nothing. */
function matchesType(name: unknown, value: unknown): boolean {
  switch (name) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    default:
      return false;
  }
}

/** The `cms` marker of a node, or undefined when it is not one this walker reports. */
function markerOf(value: unknown): CmsMarker | undefined {
  if (value === 'reference') return 'reference';
  if (value === 'image') return 'image';
  return undefined;
}

/** A node's `properties`, or an empty schema when it has none. */
function propertiesOf(node: SchemaNode): SchemaNode {
  return isObject(node.properties) ? node.properties : {};
}

/** The schema nodes in a list keyword such as `oneOf`. Anything else in the list is skipped. */
function nodesOf(list: unknown): SchemaNode[] {
  return Array.isArray(list) ? list.filter(isObject) : [];
}

/** Whether a value is a plain JSON object (not null, not an array). */
function isObject(value: unknown): value is SchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
