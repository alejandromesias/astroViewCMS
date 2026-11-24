// UI hints from the site config (WORKPLAN 2.14c, U8). Each hint is copied as `ui` onto the schema node of the field it
// names. The keys come from the site config, so every lookup uses a Map or Object.hasOwn, and the result is built with
// Object.fromEntries. A Zod cycle is exported as `$ref`. A hint can name a `$ref` field itself, but a path that goes on
// past one is not followed: it matches nothing and fails the build, so it is never dropped silently.
import type { UiHint } from '../types.ts';
import type { CollectionSchema } from './json-schema.ts';

/** A JSON Schema node. Its keywords are unknown until each one is checked. */
type SchemaNode = Readonly<Record<string, unknown>>;

/** One step of a hint path: a property name, or the items of an array (the `[]` after a name). */
type Step =
  | { readonly kind: 'property'; readonly name: string }
  | { readonly kind: 'items' };

/** The list keywords a union uses. A path through a union continues into each of its branches. */
const UNION_KEYWORDS = ['oneOf', 'anyOf'] as const;

/**
 * Copies each hint onto the schema node of the field it names. A key is `<collection>.<path>`: the path is dot separated,
 * and `[]` after a name steps into that array's items (`landing.blocks[].title`). A path through a union applies to every
 * branch that has the field. The collections are not changed; the result is new.
 * @throws {Error} `ui hint "<key>" matches no field` when a key is malformed or its path reaches no field.
 */
export function applyUiHints(
  collections: Readonly<Record<string, CollectionSchema>>,
  hints: Readonly<Record<string, UiHint>>,
): Record<string, CollectionSchema> {
  const result = new Map<string, CollectionSchema>(Object.entries(collections));
  for (const [key, hint] of Object.entries(hints)) {
    const parsed = parseKey(key);
    const entry =
      parsed === undefined ? undefined : result.get(parsed.collection);
    const applied =
      entry !== undefined && isNode(entry.schema) && parsed !== undefined
        ? applyAt(entry.schema, parsed.steps, hint)
        : undefined;
    if (parsed === undefined || entry === undefined || applied === undefined) {
      throw new Error(`ui hint "${key}" matches no field`);
    }
    result.set(parsed.collection, { ...entry, schema: applied });
  }
  return Object.fromEntries(result);
}

/** Splits a hint key into its collection and the steps of its path, or undefined when the key is malformed. */
function parseKey(
  key: string,
):
  | { readonly collection: string; readonly steps: readonly Step[] }
  | undefined {
  const dot = key.indexOf('.');
  if (dot <= 0) return undefined;
  const steps: Step[] = [];
  for (const part of key.slice(dot + 1).split('.')) {
    const items = part.endsWith('[]');
    const name = items ? part.slice(0, -2) : part;
    if (name === '') return undefined;
    steps.push({ kind: 'property', name });
    if (items) steps.push({ kind: 'items' });
  }
  return { collection: key.slice(0, dot), steps };
}

/**
 * The node that `steps` reach from `node`, with `hint` copied onto it; undefined when they reach no field. Each union
 * branch is walked with the same steps, and a branch without the field is left as it is.
 */
function applyAt(
  node: SchemaNode,
  steps: readonly Step[],
  hint: UiHint,
): SchemaNode | undefined {
  const [step, ...rest] = steps;
  if (step === undefined) return { ...node, ui: { ...hint } };
  let next: SchemaNode = node;
  let matched = false;
  if (step.kind === 'property') {
    const properties: unknown = node.properties;
    const child: unknown =
      isNode(properties) && Object.hasOwn(properties, step.name)
        ? properties[step.name]
        : undefined;
    const applied = isNode(child) ? applyAt(child, rest, hint) : undefined;
    if (isNode(properties) && applied !== undefined) {
      next = { ...next, properties: { ...properties, [step.name]: applied } };
      matched = true;
    }
  } else if (isNode(node.items)) {
    const applied = applyAt(node.items, rest, hint);
    if (applied !== undefined) {
      next = { ...next, items: applied };
      matched = true;
    }
  }
  for (const keyword of UNION_KEYWORDS) {
    const branches: unknown = node[keyword];
    if (!Array.isArray(branches)) continue;
    const applied = branches.map((branch: unknown): unknown => {
      if (!isNode(branch)) return branch;
      const target = applyAt(branch, steps, hint);
      if (target === undefined) return branch;
      matched = true;
      return target;
    });
    next = { ...next, [keyword]: applied };
  }
  return matched ? next : undefined;
}

/** Whether a value is a plain JSON object (not null, not an array). */
function isNode(value: unknown): value is SchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
