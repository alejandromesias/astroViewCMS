import { describe, expect, it } from 'vitest';
import {
  canonicalEntryText,
  revisionOf,
  revisionOfEntry,
  revisionOfKeyedEntry,
} from './revision.ts';

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

  it('sorts keys that come before and after each other in both directions', () => {
    expect(canonicalEntryText({ c: 1, a: 2, b: 3, d: 4 })).toBe(
      '{"a":2,"b":3,"c":1,"d":4}',
    );
  });
});

describe('revisionOfKeyedEntry', () => {
  it('counts an id field, since an object-keyed file takes the id from its key', () => {
    expect(revisionOfKeyedEntry({ id: 'x', n: 1 })).not.toBe(
      revisionOfKeyedEntry({ id: 'y', n: 1 }),
    );
    expect(revisionOfKeyedEntry({ slug: 'x', n: 1 })).not.toBe(
      revisionOfKeyedEntry({ slug: 'y', n: 1 }),
    );
  });

  it('does not depend on the key order', () => {
    expect(revisionOfKeyedEntry({ id: 'x', n: 1 })).toBe(
      revisionOfKeyedEntry({ n: 1, id: 'x' }),
    );
  });
});

describe('revisionOfEntry', () => {
  it('does not count the id, which Astro takes out of the data', () => {
    const withId = { id: 't-ana', name: 'Ana', quote: 'Great' };
    expect(revisionOfEntry(withId)).toBe(
      revisionOfEntry({ name: 'Ana', quote: 'Great' }),
    );
  });

  it('takes the id from slug when there is no id', () => {
    const withSlug = { slug: 'about', title: 'About' };
    expect(revisionOfEntry(withSlug)).toBe(revisionOfEntry({ title: 'About' }));
  });

  it('keeps slug when the id is set', () => {
    // Only `id` is dropped here, so the slug stays as content.
    expect(revisionOfEntry({ id: 'a', slug: 'b' })).toBe(
      revisionOf(canonicalEntryText({ slug: 'b' })),
    );
  });

  it('does not depend on the key order or on dates as strings', () => {
    const date = new Date('2026-09-01T00:00:00Z');
    expect(revisionOfEntry({ id: 'x', at: date, n: 1 })).toBe(
      revisionOfEntry({ n: 1, at: new Date('2026-09-01T00:00:00Z') }),
    );
    expect(revisionOfEntry({ at: date })).not.toBe(
      revisionOfEntry({ at: '2026-09-01' }),
    );
  });

  it('changes when a field changes', () => {
    expect(revisionOfEntry({ id: 'x', n: 1 })).not.toBe(
      revisionOfEntry({ id: 'x', n: 2 }),
    );
  });

  it.each([
    ['a string', 'text', '"text"'],
    ['a number', 7, '7'],
    ['null', null, 'null'],
    ['an array', [1, 'two'], '[1,"two"]'],
    ['a boolean', true, 'true'],
  ])(
    'hashes %s whole, since it has no id to take out',
    (_label, value, text) => {
      expect(revisionOfEntry(value)).toBe(revisionOf(text));
    },
  );

  it('treats a null id as no id, so the slug is taken out and the null id stays', () => {
    expect(revisionOfEntry({ id: null, slug: 'b' })).toBe(
      revisionOf('{"id":null}'),
    );
  });
});
