import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRenderRequest, renderRequestSchema } from './envelope.ts';

// The same cases as preview-render-server/src/render/envelope.test.ts (the
// renderer's own check). Keep the two tables in step. No test checks that they
// do: the exact-message tests below pin this copy's messages only, so a message
// changed on one side passes both suites unless the other side is updated too.
const message = (body: unknown) => {
  const result = parseRenderRequest(body);
  return result.ok ? undefined : result.message;
};
const entry = {
  url: '/__preview-media/0123456789abcdef.png',
  width: 10,
  height: 20,
  format: 'png',
};

describe('parseRenderRequest', () => {
  it('accepts documents alone, and documents with media', () => {
    expect(parseRenderRequest({ documents: {} })).toEqual({
      ok: true,
      documents: {},
      media: {},
    });
    expect(
      parseRenderRequest({
        documents: { 'a/b': null },
        media: { 'x.png': entry },
      }),
    ).toEqual({
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
    expect(message({ documents: null })).toMatch(
      /"documents" must be an object/,
    );
    expect(message({ documents: {}, media: [] })).toMatch(
      /"media" must be an object/,
    );
    expect(message({ documents: {}, media: { 'x.png': 'no' } })).toMatch(
      /"media" entry "x.png" must be an object/,
    );
  });

  it.each([
    ['url is not a string', { url: 5 }, /"url" must be a string/],
    ['url is empty', { url: '' }, /"url" must be a string/],
    ['width is zero', { width: 0 }, /"width" must be a positive integer/],
    [
      'width is fractional',
      { width: 1.5 },
      /"width" must be a positive integer/,
    ],
    [
      'height is negative',
      { height: -2 },
      /"height" must be a positive integer/,
    ],
    ['format is unknown', { format: 'bmp' }, /"format" must be one of/],
    ['format is missing', { format: undefined }, /"format" must be one of/],
  ])('a media entry whose %s is refused', (_name, change, pattern) => {
    expect(
      message({ documents: {}, media: { 'x.png': { ...entry, ...change } } }),
    ).toMatch(pattern);
  });
});

describe('parseRenderRequest: media refs that are names of Object.prototype', () => {
  it('keeps __proto__ as an ordinary key and does not change the prototype of the map', () => {
    const body = JSON.parse(
      `{"documents": {}, "media": {"__proto__": ${JSON.stringify(entry)}, "constructor": ${JSON.stringify(entry)}}}`,
    );
    const result = parseRenderRequest(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.media).sort()).toEqual([
      '__proto__',
      'constructor',
    ]);
    expect(Object.getPrototypeOf(result.media)).toBe(Object.prototype);
    expect((result.media as Record<string, unknown>).url).toBeUndefined();
  });
});

describe('parseRenderRequest: exact messages and every image format', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['png', 'jpg', 'jpeg', 'tiff', 'webp', 'gif', 'svg', 'avif'])(
    'accepts the image format %s',
    (format) => {
      const media = { 'x.png': { ...entry, format } };
      expect(parseRenderRequest({ documents: {}, media })).toEqual({
        ok: true,
        documents: {},
        media,
      });
    },
  );

  it('names the entry and the field on one line', () => {
    expect(
      message({ documents: {}, media: { 'x.png': { ...entry, width: 0 } } }),
    ).toBe('"media" entry "x.png": "width" must be a positive integer');
    expect(
      message({ documents: {}, media: { 'x.png': { ...entry, url: 5 } } }),
    ).toBe('"media" entry "x.png": "url" must be a string');
  });

  it('refuses an empty url with the same message as a non-string url', () => {
    expect(
      message({ documents: {}, media: { 'x.png': { ...entry, url: '' } } }),
    ).toBe('"media" entry "x.png": "url" must be a string');
  });

  it('accepts a one-character url', () => {
    const media = { 'x.png': { ...entry, url: 'x' } };
    expect(parseRenderRequest({ documents: {}, media })).toEqual({
      ok: true,
      documents: {},
      media,
    });
  });

  it('lists every accepted format when the format is refused', () => {
    expect(
      message({
        documents: {},
        media: { 'x.png': { ...entry, format: 'bmp' } },
      }),
    ).toBe(
      '"media" entry "x.png": "format" must be one of png, jpg, jpeg, tiff, webp, gif, svg, avif',
    );
  });

  it('names an entry that is not an object, with no field after it', () => {
    expect(message({ documents: {}, media: { 'x.png': 'no' } })).toBe(
      '"media" entry "x.png" must be an object',
    );
  });

  it('gives the exact message of each refused part of the body', () => {
    expect(message('text')).toBe('Body must be a JSON object with "documents"');
    expect(message({})).toBe('"documents" must be an object');
    expect(message({ documents: {}, media: [] })).toBe(
      '"media" must be an object',
    );
  });

  it('answers the fallback message when Zod gives no issue', () => {
    vi.spyOn(renderRequestSchema, 'safeParse').mockReturnValueOnce({
      success: false,
      error: { issues: [] },
    } as unknown as ReturnType<typeof renderRequestSchema.safeParse>);
    expect(parseRenderRequest({ documents: {} })).toEqual({
      ok: false,
      message: 'Invalid body',
    });
  });
});
