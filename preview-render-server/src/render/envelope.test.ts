import { describe, expect, it } from 'vitest';
import { parseEnvelope } from './envelope.ts';

const message = (body: unknown) => {
  const result = parseEnvelope(body);
  return result.ok ? undefined : result.message;
};
const entry = { url: '/__preview-media/0123456789abcdef.png', width: 10, height: 20, format: 'png' };

describe('parseEnvelope', () => {
  it('accepts documents alone, and documents with media', () => {
    expect(parseEnvelope({ documents: {} })).toEqual({ ok: true, documents: {}, media: {} });
    expect(parseEnvelope({ documents: { 'a/b': null }, media: { 'x.png': entry } })).toEqual({
      ok: true,
      documents: { 'a/b': null },
      media: { 'x.png': entry },
    });
  });

  it('names the part that failed', () => {
    expect(message('text')).toMatch(/JSON object/);
    expect(message([])).toMatch(/JSON object/);
    expect(message({})).toMatch(/"documents" must be an object/);
    expect(message({ documents: [] })).toMatch(/"documents" must be an object/);
    expect(message({ documents: null })).toMatch(/"documents" must be an object/);
    expect(message({ documents: {}, media: [] })).toMatch(/"media" must be an object/);
    expect(message({ documents: {}, media: { 'x.png': 'no' } })).toMatch(/"media" entry "x.png" must be an object/);
  });

  it.each([
    ['url is not a string', { url: 5 }, /"url" must be a string/],
    ['url is empty', { url: '' }, /"url" must be a string/],
    ['width is zero', { width: 0 }, /"width" must be a positive integer/],
    ['width is fractional', { width: 1.5 }, /"width" must be a positive integer/],
    ['height is negative', { height: -2 }, /"height" must be a positive integer/],
    ['format is unknown', { format: 'bmp' }, /"format" must be one of/],
    ['format is missing', { format: undefined }, /"format" must be one of/],
  ])('a media entry whose %s is refused', (_name, change, pattern) => {
    expect(message({ documents: {}, media: { 'x.png': { ...entry, ...change } } })).toMatch(pattern);
  });
});

describe('parseEnvelope: media refs that are names of Object.prototype', () => {
  it('keeps __proto__ as an ordinary key and does not change the prototype of the map', () => {
    const body = JSON.parse(`{"documents": {}, "media": {"__proto__": ${JSON.stringify(entry)}, "constructor": ${JSON.stringify(entry)}}}`);
    const result = parseEnvelope(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.media).sort()).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(result.media)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).url).toBeUndefined();
    expect((result.media as Record<string, unknown>).url).toBeUndefined();
  });
});
