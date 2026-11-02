// The Markdown and MDX codec (PHASE-2-DESIGN 5.4, D2, D13). A file's value is `{ data, body }`: `data`
// is the YAML between the `---` fences, read and written through yamlCodec, and `body` is the text after
// the closing fence, kept exactly. The fence rules follow Astro's frontmatter parsing (`parseFrontmatter`
// in @astrojs/markdown-remark, the reference for this codec): a byte-order mark, blank lines before the
// opening fence, trailing spaces on a fence line, and CRLF line endings are all allowed. TOML (`+++`) and
// JSON (`;;;`) frontmatter are refused, since Astro reads YAML only and the file cannot be written back.
import { type Codec, CodecError } from './types.ts';
import { yamlCodec } from './yaml.ts';

const FORMAT = 'markdown';
const BOM = '﻿';
const FENCE = /^---[ \t]*\r?$/;
const TOML_FENCE = /^\+\+\+[ \t]*\r?$/;
const JSON_FENCE = /^;;;[ \t]*\r?$/;

/** The value of a Markdown or MDX file (D2): the frontmatter's map and the body after it. */
interface MarkdownValue {
  readonly data: Record<string, unknown>;
  readonly body: string;
}

export const markdownCodec: Codec = {
  parse: parseMarkdown,
  write: writeMarkdown,
};

/** A file with frontmatter, split in file order. Joined back, the parts give the file. */
interface Fenced {
  /** The byte-order mark and the blank lines before the opening fence. */
  prefix: string;
  /** The opening fence line, with its line ending. */
  open: string;
  /** The YAML between the fences, including the line ending of its last line. */
  raw: string;
  /** The closing fence line, with its line ending (empty at the end of the file). */
  close: string;
  /** Everything after the closing fence line. */
  body: string;
}

interface Line {
  content: string;
  next: number;
  terminated: boolean;
}

function parseMarkdown(text: string): MarkdownValue {
  const parts = split(text);
  if (parts === undefined) return { data: {}, body: text };
  return { data: dataOf(parts.raw, lineOffset(parts)), body: parts.body };
}

function writeMarkdown(original: string, value: unknown): string {
  const next = asMarkdownValue(value);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const parts = split(original);
  if (parts === undefined) {
    if (isEmpty(next.data)) {
      // Without frontmatter, the body must not start a block that reads as frontmatter.
      if (split(next.body) !== undefined) {
        throw new CodecError(
          'The body would read as frontmatter: it starts with a --- block',
          { format: FORMAT },
        );
      }
      return next.body;
    }
    return `---${eol}${newYaml(next.data, eol)}---${eol}${next.body}`;
  }
  const current = dataOf(parts.raw, lineOffset(parts));
  return (
    parts.prefix +
    parts.open +
    frontmatterText(parts, current, next.data, eol) +
    parts.close +
    next.body
  );
}

// The frontmatter text that goes between the fences for the new data.
function frontmatterText(
  parts: Fenced,
  current: Record<string, unknown>,
  data: Record<string, unknown>,
  eol: string,
): string {
  if (isEmpty(data)) return isEmpty(current) ? parts.raw : '';
  if (isEmpty(current)) return newYaml(data, eol);
  try {
    return yamlCodec.write(parts.raw, data);
  } catch (error) {
    throw shiftLine(error, lineOffset(parts));
  }
}

// Splits a file at its fences. `undefined` when the file has no frontmatter: its first line after
// the blank lines is not a fence. A fence that is not closed, or a TOML or JSON fence, is a CodecError.
function split(text: string): Fenced | undefined {
  let start = text.startsWith(BOM) ? BOM.length : 0;
  let line = lineAt(text, start);
  while (line.terminated && line.content.trim() === '') {
    start = line.next;
    line = lineAt(text, start);
  }
  if (TOML_FENCE.test(line.content)) {
    throw refuse(
      'TOML frontmatter (+++) is not supported: the document is read-only',
    );
  }
  if (JSON_FENCE.test(line.content)) {
    throw refuse(
      'JSON frontmatter (;;;) is not supported: the document is read-only',
    );
  }
  if (!FENCE.test(line.content)) return undefined;
  const open = line;
  let p = open.next;
  for (;;) {
    if (p >= text.length)
      throw refuse('Frontmatter is not closed: no closing --- line');
    const candidate = lineAt(text, p);
    if (FENCE.test(candidate.content)) {
      return {
        prefix: text.slice(0, start),
        open: text.slice(start, open.next),
        raw: text.slice(open.next, p),
        close: text.slice(p, candidate.next),
        body: text.slice(candidate.next),
      };
    }
    p = candidate.next;
  }
}

function lineAt(text: string, from: number): Line {
  const end = text.indexOf('\n', from);
  if (end === -1)
    return { content: text.slice(from), next: text.length, terminated: false };
  return { content: text.slice(from, end), next: end + 1, terminated: true };
}

// The number of lines before the YAML, so that YAML error lines point into the file.
function lineOffset(parts: Fenced): number {
  return (parts.prefix + parts.open).split('\n').length - 1;
}

// The data of the YAML between the fences. Blank or comment-only frontmatter is an empty map, as in
// Astro. Anything else must read as a map.
function dataOf(raw: string, offset: number): Record<string, unknown> {
  if (
    raw
      .split(/\r?\n/)
      .every((line) => line.trim() === '' || line.trim().startsWith('#'))
  ) {
    return {};
  }
  let value: unknown;
  try {
    value = yamlCodec.parse(raw);
  } catch (error) {
    throw shiftLine(error, offset);
  }
  if (!isRecord(value)) {
    throw refuse('Frontmatter must be a YAML map: the document is read-only');
  }
  return value;
}

// Brings a YAML error's line from the frontmatter to the file. Any other error passes unchanged.
function shiftLine(error: unknown, offset: number): unknown {
  if (!(error instanceof CodecError) || error.line === undefined) return error;
  const line = error.line + offset;
  const message = error.message.replace(
    `at line ${error.line},`,
    `at line ${line},`,
  );
  const column = error.column === undefined ? {} : { column: error.column };
  return new CodecError(message, { format: error.format, line, ...column });
}

// New frontmatter text for data that had none. The YAML codec writes LF; CRLF files get CRLF.
function newYaml(data: Record<string, unknown>, eol: string): string {
  const yaml = yamlCodec.write('', data);
  return eol === '\r\n' ? yaml.replace(/\n/g, '\r\n') : yaml;
}

function asMarkdownValue(value: unknown): MarkdownValue {
  if (
    isRecord(value) &&
    isRecord(value.data) &&
    typeof value.body === 'string'
  ) {
    return { data: value.data, body: value.body };
  }
  throw new CodecError('Value must be { data, body }: data a map, body text', {
    format: FORMAT,
  });
}

function refuse(message: string): CodecError {
  return new CodecError(message, { format: FORMAT });
}

function isEmpty(data: Record<string, unknown>): boolean {
  return Object.keys(data).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
