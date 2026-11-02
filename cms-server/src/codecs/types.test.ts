import { describe, expect, it } from 'vitest';
import { CodecError } from './types.ts';

describe('CodecError', () => {
  it('keeps the format and the 1-based position it was given', () => {
    const error = new CodecError('bad', { format: 'json', line: 2, column: 5 });
    expect({
      name: error.name,
      message: error.message,
      format: error.format,
      line: error.line,
      column: error.column,
    }).toEqual({
      name: 'CodecError',
      message: 'bad',
      format: 'json',
      line: 2,
      column: 5,
    });
  });

  it('leaves line and column undefined when no position is given', () => {
    const error = new CodecError('bad', { format: 'yaml' });
    expect(error.line).toBeUndefined();
    expect(error.column).toBeUndefined();
  });

  it('is an Error', () => {
    const error = new CodecError('bad', { format: 'json' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CodecError);
  });
});
