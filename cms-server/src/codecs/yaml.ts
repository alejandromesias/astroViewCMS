// The YAML codec (PHASE-2-DESIGN 5.4). Parsing uses the options of Astro's loader (`parseYaml` in
// @astrojs/internal-helpers), so the value is what the site reads: `<<` merge keys are expanded, and
// unquoted dates are Date objects. Writing diffs the new value against `toJS()` of the original, then
// changes only the nodes that differ, through the yaml Document API, so comments, key order and
// quoting survive. The library re-serialises the whole document, so the text differs from the original
// only on the edited lines; the layout (indent, indentSeq, line ending, final newline) is read back from
// the original to keep that true.
import {
  Document,
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';
import { type Codec, CodecError } from './types.ts';

const FORMAT = 'yaml';

export const yamlCodec: Codec = { parse: parseYaml, write: writeYaml };

/** How the original is laid out. `indent` and `indentSeq` are the library's serialising options. */
interface Layout {
  eol: string;
  indent: number;
  indentSeq: boolean;
  finalNewline: boolean;
}

function parseYaml(text: string): unknown {
  const value = readDocument(text).toJS();
  if (!isContainer(value)) throw notContainer();
  return value;
}

function writeYaml(original: string, value: unknown): string {
  if (!isContainer(value)) throw notContainer();
  if (original.trim() === '') {
    const doc = new Document(value, {
      customTags: ['timestamp'],
      schema: 'core',
    });
    return serialize(doc, {
      eol: '\n',
      indent: 2,
      indentSeq: true,
      finalNewline: true,
    });
  }
  const doc = readDocument(original);
  const before = doc.toJS();
  if (sameValue(before, value)) return original;
  doc.contents = patchNode(
    doc,
    doc.contents,
    before,
    value,
  ) as typeof doc.contents;
  if (!sameValue(doc.toJS(), value)) {
    throw new CodecError(
      'Value cannot be written as YAML: it does not read back as given',
      {
        format: FORMAT,
      },
    );
  }
  return serialize(doc, layoutOf(original));
}

// Parses with Astro's options. Any parse error (duplicate keys included) is a CodecError at its line.
function readDocument(text: string): Document.Parsed {
  const doc = parseDocument(text, {
    customTags: ['timestamp'],
    merge: true,
    schema: 'core',
  });
  const [error] = doc.errors;
  if (error !== undefined) {
    // The library sets linePos on every parse error; the fallback only keeps the types total.
    const start = error.linePos?.[0];
    const line = start?.line ?? 1;
    const column = start?.col ?? 1;
    throw new CodecError(
      `Invalid YAML at line ${line}, column ${column}: ${error.code}`,
      {
        format: FORMAT,
        line,
        column,
      },
    );
  }
  return doc;
}

// Changes `node` (the node at one position of the document) so that it reads back as `after`, and
// returns the node to keep in that position. `before` is what `node` reads as now.
function patchNode(
  doc: Document,
  node: unknown,
  before: unknown,
  after: unknown,
): unknown {
  if (sameValue(before, after)) return node;
  if (canDiff(before, after)) {
    if (isAlias(node)) {
      throw new CodecError(
        'A change inside an alias cannot be written as YAML',
        { format: FORMAT },
      );
    }
    if (isMap(node) && isRecord(before) && isRecord(after)) {
      patchMap(doc, node, before, after);
      return node;
    }
    if (isSeq(node) && Array.isArray(before) && Array.isArray(after)) {
      patchSeq(doc, node, before, after);
      return node;
    }
  }
  // A changed string keeps its quote style. Anything else becomes a new node. An inline comment moves
  // to it only when it is a scalar too: a map or list would print the comment inside itself, so it
  // is dropped.
  if (
    isScalar(node) &&
    typeof before === 'string' &&
    typeof after === 'string'
  ) {
    node.value = after;
    return node;
  }
  const next = newNode(doc, after);
  if (isScalar(node) && isScalar(next)) {
    next.comment = node.comment ?? null;
    next.commentBefore = node.commentBefore ?? null;
  }
  return next;
}

// Keys come from `before` and `after` through Map and Object.entries, never assigned onto a plain
// object. A key that came in through `<<` is not an own pair: a change to it is written as an own pair,
// which overrides the merged one.
function patchMap(
  doc: Document,
  map: YAMLMap,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  const next = definedEntries(after);
  for (const [key, previous] of Object.entries(before)) {
    const value = next.get(key);
    const pair = map.items.find((item) => keyText(item.key) === key);
    if (value === undefined) {
      if (pair === undefined) {
        throw new CodecError(
          `Key "${key}" comes from a merge and cannot be removed`,
          {
            format: FORMAT,
          },
        );
      }
      map.items.splice(map.items.indexOf(pair), 1);
    } else if (pair === undefined) {
      if (!sameValue(previous, value))
        map.items.push(doc.createPair(key, value));
    } else {
      pair.value = patchNode(doc, pair.value, previous, value);
    }
  }
  for (const [key, value] of next) {
    if (!Object.hasOwn(before, key)) map.items.push(doc.createPair(key, value));
  }
}

// Items are matched first by longest common subsequence, so a removed or reordered item keeps its node
// and its comments. An unmatched new item that equals an unmatched old one takes that node (a move).
// The rest are paired in order: a pair is patched in place, an extra new item is created, and an extra
// old item is dropped.
function patchSeq(
  doc: Document,
  seq: YAMLSeq,
  before: unknown[],
  after: unknown[],
): void {
  const nodes = new Array<unknown>(after.length);
  const usedOld = new Set<number>();
  for (const [oldIndex, newIndex] of matchItems(before, after)) {
    nodes[newIndex] = seq.items[oldIndex];
    usedOld.add(oldIndex);
  }
  for (let newIndex = 0; newIndex < after.length; newIndex++) {
    if (nodes[newIndex] !== undefined) continue;
    const oldIndex = before.findIndex(
      (item, index) => !usedOld.has(index) && sameValue(item, after[newIndex]),
    );
    if (oldIndex === -1) continue;
    nodes[newIndex] = seq.items[oldIndex];
    usedOld.add(oldIndex);
  }
  const leftoverOld = before
    .map((_, index) => index)
    .filter((index) => !usedOld.has(index));
  const leftoverNew = after
    .map((_, index) => index)
    .filter((index) => nodes[index] === undefined);
  leftoverNew.forEach((newIndex, k) => {
    const oldIndex = leftoverOld[k];
    nodes[newIndex] =
      oldIndex === undefined
        ? newNode(doc, after[newIndex])
        : patchNode(
            doc,
            seq.items[oldIndex],
            before[oldIndex],
            after[newIndex],
          );
  });
  moveLeadingComment(seq.items[0], nodes[0]);
  seq.items = nodes;
}

// The comment above a list's first item reads as the list's header. When another item takes the first
// place, the comment moves to it, so the header stays on top.
function moveLeadingComment(from: unknown, to: unknown): void {
  if (from === to || !isNode(from) || !isNode(to) || !from.commentBefore)
    return;
  to.commentBefore = to.commentBefore
    ? `${from.commentBefore}\n${to.commentBefore}`
    : from.commentBefore;
  from.commentBefore = null;
}

// Pairs of indexes (old, new) of a longest common subsequence under sameValue, in order.
function matchItems(before: unknown[], after: unknown[]): [number, number][] {
  const length = (i: number, j: number): number => table[i]?.[j] ?? 0;
  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      const row = table[i];
      if (row === undefined) continue;
      row[j] = sameValue(before[i], after[j])
        ? length(i + 1, j + 1) + 1
        : Math.max(length(i + 1, j), length(i, j + 1));
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (
      sameValue(before[i], after[j]) &&
      length(i, j) === length(i + 1, j + 1) + 1
    ) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (length(i + 1, j) >= length(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

// Reads the layout back from the original text, so the library writes the same indent, sequence
// indentation, line ending and final newline. Defaults: 2 spaces, indented sequences, LF.
function layoutOf(text: string): Layout {
  const eol = /\r?\n/.exec(text)?.[0] ?? '\n';
  const indent = (/^( +)[^\s#]/m.exec(text)?.[1] ?? '  ').length;
  const seq = /^( *)[^\s#-][^\n]*:[ \t]*(?:#[^\n]*)?\r?\n( *)- /m.exec(text);
  const indentSeq =
    seq === null ? true : (seq[2]?.length ?? 0) > (seq[1]?.length ?? 0);
  return { eol, indent, indentSeq, finalNewline: text.endsWith('\n') };
}

function serialize(doc: Document, layout: Layout): string {
  const text = doc.toString({
    indent: layout.indent,
    indentSeq: layout.indentSeq,
    lineWidth: 0,
  });
  const withEol = layout.eol === '\r\n' ? text.replaceAll('\n', '\r\n') : text;
  return layout.finalNewline ? withEol : withEol.slice(0, -layout.eol.length);
}

function newNode(doc: Document, value: unknown): unknown {
  if (value === undefined)
    throw new CodecError('Value cannot be written as YAML', { format: FORMAT });
  return doc.createNode(value);
}

function notContainer(): CodecError {
  return new CodecError('YAML document must be a map or a sequence', {
    format: FORMAT,
  });
}

// The text of a pair's key, for matching it against a key of toJS(): 1 and '1' are the same key there.
function keyText(key: unknown): string {
  return String(isScalar(key) ? key.value : key);
}

function definedEntries(value: Record<string, unknown>): Map<string, unknown> {
  return new Map(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

// Only two containers of the same kind are diffed in place.
function canDiff(before: unknown, after: unknown): boolean {
  return (
    (Array.isArray(before) && Array.isArray(after)) ||
    (isRecord(before) && isRecord(after))
  );
}

// Deep equality. Dates compare by time, objects ignore key order and undefined values, and NaN equals
// NaN.
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  if (isRecord(a) && isRecord(b)) {
    const left = definedEntries(a);
    const right = definedEntries(b);
    return (
      left.size === right.size &&
      [...left].every(
        ([key, item]) => right.has(key) && sameValue(item, right.get(key)),
      )
    );
  }
  return Object.is(a, b);
}
