import { describe, expect, it } from 'vitest';
import { canonicalEntryText, revisionOf } from './revision.ts';

describe('revisionOf', () => {
  it('is the first 16 hex characters of SHA-256 (known vectors)', () => {
    expect(revisionOf('abc')).toBe('ba7816bf8f01cfea');
    expect(revisionOf('')).toBe('e3b0c44298fc1c14');
  });

  it('hashes a string as its UTF-8 bytes', () => {
    expect(revisionOf(new TextEncoder().encode('abc'))).toBe(revisionOf('abc'));
  });

  it('tells apart binary content that differs only in invalid UTF-8', () => {
    expect(revisionOf(Uint8Array.of(0xff))).not.toBe(
      revisionOf(Uint8Array.of(0xfe)),
    );
  });

  it('is always 16 lowercase hex characters', () => {
    expect(revisionOf('any text at all')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('canonicalEntryText', () => {
  it('sorts the keys at every level, so key order never shows', () => {
    const one = { b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } };
    const two = { a: { c: [{ y: 2, z: 1 }], d: 2 }, b: 1 };
    expect(canonicalEntryText(one)).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}',
    );
    expect(canonicalEntryText(two)).toBe(canonicalEntryText(one));
  });

  it('writes dates as ISO strings', () => {
    expect(
      canonicalEntryText({ at: new Date('2026-01-02T03:04:05.000Z') }),
    ).toBe('{"at":"2026-01-02T03:04:05.000Z"}');
  });

  it('keeps a key named __proto__ as an ordinary key', () => {
    const parsed = JSON.parse('{"__proto__": 1, "a": 2}') as unknown;
    expect(canonicalEntryText(parsed)).toBe('{"__proto__":1,"a":2}');
  });

  it('leaves primitives and arrays in their order', () => {
    expect(canonicalEntryText([3, 'x', null, true])).toBe('[3,"x",null,true]');
    expect(canonicalEntryText('text')).toBe('"text"');
  });
});
