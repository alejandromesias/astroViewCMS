// The codec contract shared by every format (PHASE-2-DESIGN 5.4). A codec turns a file's text into a
// value, and writes a value back into the original text while keeping what it can.

/** One format's codec. `write` returns `original` itself when `value` is what `parse(original)` gives. */
export interface Codec {
  parse(text: string): unknown;
  write(original: string, value: unknown): string;
}

/** A parse or write failure in one format. `line` and `column` are 1-based, and absent when there is no position. */
export class CodecError extends Error {
  readonly format: string;
  readonly line: number | undefined;
  readonly column: number | undefined;

  constructor(
    message: string,
    options: { format: string; line?: number; column?: number },
  ) {
    super(message);
    this.name = 'CodecError';
    this.format = options.format;
    this.line = options.line;
    this.column = options.column;
  }
}
