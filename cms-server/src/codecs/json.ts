// The JSON codec (PHASE-2-DESIGN 5.4). Parsing is strict JSON, with the rules of Astro's JSON.parse:
// comments and trailing commas are errors. Writing diffs the old and new values, then edits the
// original text with jsonc-parser's `modify`, one change at a time, so every byte outside a change
// stays as it was. Keys are read with Object.entries and Map, never assigned onto a plain object, so
// a key such as `__proto__` stays an ordinary key.
import {
  applyEdits,
  type JSONPath,
  type ModificationOptions,
  modify,
  type ParseError,
  parseTree,
  printParseErrorCode,
} from 'jsonc-parser';
import { type Codec, CodecError } from './types.ts';

const FORMAT = 'json';

export const jsonCodec: Codec = { parse: parseJson, write: writeJson };

/** How the file is laid out, read from its own text. `unit` is one indentation level. */
interface Style {
  eol: string;
  unit: string;
  finalNewline: boolean;
}

/** One change to the document: set the node at `path`, or remove it. */
type Op =
  | { kind: 'set'; path: JSONPath; value: unknown }
  | { kind: 'remove'; path: JSONPath };

function parseJson(text: string): unknown {
  const errors: ParseError[] = [];
  parseTree(text, errors, {
    disallowComments: true,
    allowTrailingComma: false,
  });
  const [first] = errors;
  if (first !== undefined) {
    const { line, column } = positionOf(text, first.offset);
    const reason = printParseErrorCode(first.error);
    throw new CodecError(
      `Invalid JSON at line ${line}, column ${column}: ${reason}`,
      {
        format: FORMAT,
        line,
        column,
      },
    );
  }
  return JSON.parse(text);
}

function writeJson(original: string, value: unknown): string {
  if (original.trim() === '')
    return serialize(value, { eol: '\n', unit: '  ', finalNewline: true });
  const style = styleOf(original);
  const before = parseJson(original);
  if (!canDiff(before, value))
    return before === value ? original : serialize(value, style);
  const ops: Op[] = [];
  collect(before, value, [], ops);
  return ops.reduce((text, op) => applyOp(text, op, style), original);
}

// The first line ending decides `eol`. The first indented line decides `unit`, so a file with no
// indented line gets 2 spaces. `finalNewline` says whether the text ends with a line ending.
function styleOf(text: string): Style {
  const eol = /\r?\n/.exec(text)?.[0] ?? '\n';
  const unit = /^([ \t]+)\S/m.exec(text)?.[1] ?? '  ';
  return {
    eol,
    unit: unit.startsWith('\t') ? '\t' : unit,
    finalNewline: text.endsWith('\n'),
  };
}

// A whole document, used for a new file and for a change of the root's type.
function serialize(value: unknown, style: Style): string {
  const json = JSON.stringify(value, null, style.unit);
  if (json === undefined) throw notJson();
  return (
    json.replaceAll('\n', style.eol) + (style.finalNewline ? style.eol : '')
  );
}

// Only two containers of the same kind are diffed in place. Anything else is replaced whole.
function canDiff(before: unknown, after: unknown): boolean {
  return (
    (Array.isArray(before) && Array.isArray(after)) ||
    (isRecord(before) && isRecord(after))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collect(
  before: unknown,
  after: unknown,
  path: JSONPath,
  ops: Op[],
): void {
  if (Array.isArray(before) && Array.isArray(after))
    collectArray(before, after, path, ops);
  else if (isRecord(before) && isRecord(after))
    collectRecord(before, after, path, ops);
  else if (before !== after) ops.push(setOp(path, after));
}

// Object key order is not an edit: existing keys keep their place, and new keys go last.
function collectRecord(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: JSONPath,
  ops: Op[],
): void {
  // An undefined value counts as an absent key, as in JSON.stringify.
  const next = new Map(
    Object.entries(after).filter(([, value]) => value !== undefined),
  );
  for (const [key, previous] of Object.entries(before)) {
    if (next.has(key)) collect(previous, next.get(key), [...path, key], ops);
    else ops.push({ kind: 'remove', path: [...path, key] });
  }
  for (const [key, value] of next) {
    if (!Object.hasOwn(before, key)) ops.push(setOp([...path, key], value));
  }
}

// Arrays are diffed by index. Shrinking removes the tail, last item first, so the indexes still hold.
function collectArray(
  before: readonly unknown[],
  after: readonly unknown[],
  path: JSONPath,
  ops: Op[],
): void {
  const shared = Math.min(before.length, after.length);
  for (let index = 0; index < shared; index++) {
    collect(before[index], after[index], [...path, index], ops);
  }
  for (let index = before.length - 1; index >= after.length; index--) {
    ops.push({ kind: 'remove', path: [...path, index] });
  }
  for (let index = before.length; index < after.length; index++) {
    ops.push(setOp([...path, index], after[index]));
  }
}

function setOp(path: JSONPath, value: unknown): Op {
  if (value === undefined) throw notJson();
  return { kind: 'set', path, value };
}

function applyOp(text: string, op: Op, style: Style): string {
  const options: ModificationOptions = {
    formattingOptions: {
      insertSpaces: style.unit !== '\t',
      tabSize: style.unit.length,
      eol: style.eol,
    },
  };
  const value = op.kind === 'set' ? op.value : undefined;
  return applyEdits(text, modify(text, op.path, value, options));
}

function notJson(): CodecError {
  return new CodecError('Value cannot be written as JSON', { format: FORMAT });
}

// 1-based line and column of `offset`. Without a line break before it, the column is offset + 1.
function positionOf(
  text: string,
  offset: number,
): { line: number; column: number } {
  const before = text.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: offset - before.lastIndexOf('\n'),
  };
}
