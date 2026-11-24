import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorMessage } from './error-message.ts';

describe('errorMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['an Error', new Error('boom'), 'boom'],
    ['a TypeError', new TypeError('bad type'), 'bad type'],
    ['a string', 'boom', 'boom'],
    ['an empty string', '', ''],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a number', 42, '42'],
    ['false', false, 'false'],
    ['a symbol', Symbol('s'), 'Symbol(s)'],
    ['a plain object', { code: 7 }, '[object Object]'],
    [
      'a plain object with a message',
      { message: 'not an error' },
      '[object Object]',
    ],
    [
      'an object with its own toString',
      { toString: () => 'custom text' },
      'custom text',
    ],
  ])('gives the text of %s', (_label, value, expected) => {
    expect(errorMessage(value)).toBe(expected);
  });

  it('does not throw for a value whose toString throws, and gives a fixed text', () => {
    const hostile = {
      toString: () => {
        throw new Error('no text');
      },
    };
    expect(errorMessage(hostile)).toBe(
      'unknown error (the thrown value has no text form)',
    );
  });

  it('does not throw for an object with no prototype', () => {
    expect(errorMessage(Object.create(null))).toBe(
      'unknown error (the thrown value has no text form)',
    );
  });

  it('takes a string as it is, without calling String()', () => {
    const realString = String;
    const spy = vi.fn((value?: unknown) => realString(value));
    vi.stubGlobal('String', spy);
    expect(errorMessage('boom')).toBe('boom');
    expect(spy).not.toHaveBeenCalled();
  });
});
