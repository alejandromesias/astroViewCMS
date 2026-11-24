// The node kinds of a form field (WORKPLAN 2.14c). A test helper only: phase 3 owns the form model. A node the sample
// does not use (a z.record, for one) classifies as 'unknown', and no kind is added for it. Every key is read with
// Object.hasOwn, and a `$ref` is resolved only into the root's `$defs`.

/** The kinds a field can have, in the order the done-when test lists them. */
const NODE_KINDS = [
  'string',
  'number',
  'boolean',
  'enum',
  'date',
  'image',
  'reference',
  'object',
  'array',
  'union',
  'unknown',
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

/** One field of a schema: its path (`blocks[].title`, `[]` for array items) and its kind. */
export interface FieldKind {
  readonly path: string;
  readonly kind: NodeKind;
}

/** A JSON Schema node. Its keywords are unknown until each one is checked. */
type SchemaNode = Readonly<Record<string, unknown>>;

/** The kind of one schema node. A node whose `$ref` names nothing is 'unknown'. */
export function kindOf(node: SchemaNode, root: SchemaNode): NodeKind {
  const target = resolved(node, root);
  if (target === undefined) return 'unknown';
  if (target.cms === 'date') return 'date';
  if (target.cms === 'image') return 'image';
  if (target.cms === 'reference') return 'reference';
  if (Array.isArray(target.enum)) return 'enum';
  if (Array.isArray(target.oneOf) || Array.isArray(target.anyOf)) {
    return 'union';
  }
  const type = singleType(target.type);
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return isNode(target.items) ? 'array' : 'unknown';
    case 'object':
      return isNode(target.properties) ? 'object' : 'unknown';
    default:
      return 'unknown';
  }
}

/**
 * Every field below a schema node, depth first: each property, the items of each array (path `[]`), and the properties of
 * each union branch at the same path. A field's kind is its node's kind.
 */
export function fieldKinds(
  schema: SchemaNode,
  root: SchemaNode = schema,
): FieldKind[] {
  const out: FieldKind[] = [];
  collect(schema, '', root, out, new Set());
  return out;
}

/** Walks one node below `prefix`. A `$ref` already followed on this path is cut, so a cycle ends. */
function collect(
  node: SchemaNode,
  prefix: string,
  root: SchemaNode,
  out: FieldKind[],
  refs: ReadonlySet<string>,
): void {
  if (typeof node.$ref !== 'string') {
    walkTarget(node, prefix, root, out, refs);
    return;
  }
  if (refs.has(node.$ref)) return;
  const target = resolved(node, root);
  if (target !== undefined) {
    walkTarget(target, prefix, root, out, new Set(refs).add(node.$ref));
  }
}

function walkTarget(
  target: SchemaNode,
  prefix: string,
  root: SchemaNode,
  out: FieldKind[],
  refs: ReadonlySet<string>,
): void {
  if (isNode(target.properties)) {
    for (const [key, child] of Object.entries(target.properties)) {
      if (!isNode(child)) continue;
      const path = prefix === '' ? key : `${prefix}.${key}`;
      out.push({ path, kind: kindOf(child, root) });
      collect(child, path, root, out, refs);
    }
  }
  if (isNode(target.items)) {
    const path = `${prefix}[]`;
    out.push({ path, kind: kindOf(target.items, root) });
    collect(target.items, path, root, out, refs);
  }
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const branches: unknown = target[keyword];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      if (isNode(branch)) collect(branch, prefix, root, out, refs);
    }
  }
}

/** The node a `$ref` names in `$defs`, or the node itself. Undefined when a `$ref` names nothing. */
function resolved(node: SchemaNode, root: SchemaNode): SchemaNode | undefined {
  if (typeof node.$ref !== 'string') return node;
  const prefix = '#/$defs/';
  if (!node.$ref.startsWith(prefix)) return undefined;
  const name = node.$ref.slice(prefix.length);
  const defs: unknown = root.$defs;
  if (!isNode(defs) || !Object.hasOwn(defs, name)) return undefined;
  const target: unknown = defs[name];
  return isNode(target) ? target : undefined;
}

/** The one JSON type a node names, ignoring `null` (a nullable field). Undefined when there is none or several. */
function singleType(type: unknown): string | undefined {
  const names: unknown[] = Array.isArray(type) ? type : [type];
  const others = names.filter((name) => name !== 'null');
  const [only] = others;
  return others.length === 1 && typeof only === 'string' ? only : undefined;
}

/** Whether a value is a plain JSON object (not null, not an array). */
function isNode(value: unknown): value is SchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
