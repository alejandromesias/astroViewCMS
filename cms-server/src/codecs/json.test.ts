import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { jsonCodec } from './json.ts';
import { CodecError } from './types.ts';

// Copies of three of the sample site's JSON files (config, testimonials, a landing page).
const FIXTURES = fileURLToPath(
  new URL('../../test/fixtures/json/', import.meta.url),
);
const FIXTURE_NAMES = ['config.json', 'testimonials.json', 'home-v2.json'];

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), 'utf8');
}

// The CodecError that `run` throws. Fails the test if it returns, or throws anything else.
function codecErrorOf(run: () => unknown): CodecError {
  try {
    run();
  } catch (error) {
    if (error instanceof CodecError) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}

describe('jsonCodec.parse', () => {
  it('reads a document into plain values', () => {
    expect(jsonCodec.parse('{"a":[1,"x",null,true,{"b":-0.5e2}]}')).toEqual({
      a: [1, 'x', null, true, { b: -50 }],
    });
  });

  it('keeps __proto__ as an own key and leaves Object.prototype alone', () => {
    const value = jsonCodec.parse(
      '{"__proto__": {"polluted": true}}',
    ) as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toEqual({
      polluted: true,
    });
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it.each(FIXTURE_NAMES)('reads the sample file %s', async (name) => {
    const value = jsonCodec.parse(await fixture(name));
    expect(value).toEqual(JSON.parse(await fixture(name)));
  });

  it.each([
    [
      'a trailing comma',
      '{\n  "a": 1,\n}',
      'Invalid JSON at line 3, column 1: PropertyNameExpected',
      3,
      1,
    ],
    [
      'a comment',
      '{\n  // note\n  "a": 1\n}',
      'Invalid JSON at line 2, column 3: InvalidCommentToken',
      2,
      3,
    ],
    [
      'single quotes',
      "{'a': 1}",
      'Invalid JSON at line 1, column 2: InvalidSymbol',
      1,
      2,
    ],
    ['empty text', '', 'Invalid JSON at line 1, column 1: ValueExpected', 1, 1],
    [
      'a missing comma',
      '[1 2]',
      'Invalid JSON at line 1, column 4: CommaExpected',
      1,
      4,
    ],
    [
      'a missing comma on a later line',
      '{\n  "a": 1\n  "b": 2\n}',
      'Invalid JSON at line 3, column 3: CommaExpected',
      3,
      3,
    ],
  ])(
    'refuses %s with a CodecError that names the position',
    (_label, text, message, line, column) => {
      const error = codecErrorOf(() => jsonCodec.parse(text));
      expect({
        message: error.message,
        format: error.format,
        line: error.line,
        column: error.column,
      }).toEqual({
        message,
        format: 'json',
        line,
        column,
      });
    },
  );
});

describe('jsonCodec.write', () => {
  it.each(FIXTURE_NAMES)(
    'returns the original text when the value is unchanged (%s)',
    async (name) => {
      const text = await fixture(name);
      expect(jsonCodec.write(text, jsonCodec.parse(text))).toBe(text);
    },
  );

  it('returns the original text when only the key order differs', () => {
    const text = '{\n  "a": 1,\n  "b": 2\n}\n';
    expect(
      jsonCodec.write(
        text,
        Object.fromEntries([
          ['b', 2],
          ['a', 1],
        ]),
      ),
    ).toBe(text);
  });

  it('returns the original text for an unchanged root scalar', () => {
    expect(jsonCodec.write('5\n', 5)).toBe('5\n');
  });

  it('changes one scalar and leaves every other byte of config.json', async () => {
    const text = await fixture('config.json');
    const value = jsonCodec.parse(text) as { site: { title: string } };
    value.site.title = 'Renamed';
    expect(jsonCodec.write(text, value)).toBe(
      text.replace('"Bigspring Light Astro"', '"Renamed"'),
    );
  });

  it('replaces a scalar that changes type', async () => {
    const text = await fixture('config.json');
    const value = jsonCodec.parse(text) as {
      settings: { pagination: unknown };
    };
    value.settings.pagination = 'four';
    expect(jsonCodec.write(text, value)).toBe(
      text.replace('"pagination": 4', '"pagination": "four"'),
    );
  });

  it('adds a key last in an object of testimonials.json', async () => {
    const text = await fixture('testimonials.json');
    const value = jsonCodec.parse(text) as Record<string, unknown>[];
    value[0] = { ...value[0], featured: true };
    expect(jsonCodec.write(text, value)).toBe(
      text.replace(
        '"avatar": "../assets/authors/ana-torres.png"\n',
        '"avatar": "../assets/authors/ana-torres.png",\n    "featured": true\n',
      ),
    );
  });

  it('removes the last key of an object in config.json', async () => {
    const text = await fixture('config.json');
    const value = jsonCodec.parse(text) as { params: Record<string, unknown> };
    delete value.params.copyright;
    expect(jsonCodec.write(text, value)).toBe(
      text.replace(
        ',\n    "copyright": "Designed and Developed By [Themefisher](https://themefisher.com/)"',
        '',
      ),
    );
  });

  it('removes items from the tail of an array', () => {
    expect(jsonCodec.write('[\n  1,\n  2,\n  3\n]\n', [1, 2])).toBe(
      '[\n  1,\n  2\n]\n',
    );
  });

  it('writes each item of a reordered array by index', () => {
    expect(jsonCodec.write('[\n  1,\n  2,\n  3\n]\n', [3, 2, 1])).toBe(
      '[\n  3,\n  2,\n  1\n]\n',
    );
  });

  it('round-trips a reordered array of testimonials.json', async () => {
    const text = await fixture('testimonials.json');
    const reversed = (jsonCodec.parse(text) as unknown[]).toReversed();
    expect(jsonCodec.parse(jsonCodec.write(text, reversed))).toEqual(reversed);
  });

  it('appends items when an array grows', () => {
    expect(jsonCodec.write('[\n  1\n]\n', [1, 2, { n: 1 }])).toBe(
      '[\n  1,\n  2,\n  {\n    "n": 1\n  }\n]\n',
    );
  });

  it('replaces a nested node whose type changes', () => {
    expect(
      jsonCodec.write('{\n  "a": {\n    "b": 1\n  }\n}\n', { a: [1] }),
    ).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });

  it('writes a new key into an empty object', () => {
    expect(jsonCodec.write('{}\n', { a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it('keeps __proto__ as a key when it is set or added', () => {
    expect(
      jsonCodec.write(
        '{\n  "__proto__": 1\n}\n',
        Object.fromEntries([['__proto__', 2]]),
      ),
    ).toBe('{\n  "__proto__": 2\n}\n');
    const added = jsonCodec.write(
      '{\n  "a": 1\n}\n',
      Object.fromEntries([
        ['a', 1],
        ['__proto__', 'x'],
      ]),
    );
    expect(added).toBe('{\n  "a": 1,\n  "__proto__": "x"\n}\n');
    expect(Object.getPrototypeOf(jsonCodec.parse(added))).toBe(
      Object.prototype,
    );
  });

  it('keeps tabs when the file indents with tabs', () => {
    expect(jsonCodec.write('{\n\t"a": 1\n}\n', { a: 1, b: [1] })).toBe(
      '{\n\t"a": 1,\n\t"b": [\n\t\t1\n\t]\n}\n',
    );
  });

  it('keeps 4 spaces when the file indents with 4 spaces', () => {
    expect(jsonCodec.write('{\n    "a": 1\n}\n', { a: 1, b: [1] })).toBe(
      '{\n    "a": 1,\n    "b": [\n        1\n    ]\n}\n',
    );
  });

  it('keeps CRLF line endings', () => {
    expect(jsonCodec.write('{\r\n  "a": 1\r\n}\r\n', { a: 1, b: 2 })).toBe(
      '{\r\n  "a": 1,\r\n  "b": 2\r\n}\r\n',
    );
  });

  it('keeps a missing final newline', () => {
    expect(jsonCodec.write('{\n  "a": 1\n}', { a: 1, b: 2 })).toBe(
      '{\n  "a": 1,\n  "b": 2\n}',
    );
  });

  it('writes a new file with 2 spaces and a final newline', () => {
    expect(jsonCodec.write('', { a: [1] })).toBe(
      '{\n  "a": [\n    1\n  ]\n}\n',
    );
  });

  it('treats whitespace-only text as a new file', () => {
    expect(jsonCodec.write('  \n', { a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it('replaces the whole document when the root changes type', () => {
    expect(jsonCodec.write('{\n  "a": 1\n}\n', [1, 2])).toBe(
      '[\n  1,\n  2\n]\n',
    );
  });

  it('keeps CRLF and a missing final newline on a root replacement', () => {
    expect(jsonCodec.write('{\r\n  "a": 1\r\n}\r\n', [1, 2])).toBe(
      '[\r\n  1,\r\n  2\r\n]\r\n',
    );
    expect(jsonCodec.write('[1]', 5)).toBe('5');
  });

  it('refuses a value that cannot be JSON', () => {
    const notJson = 'Value cannot be written as JSON';
    expect(codecErrorOf(() => jsonCodec.write('{}\n', undefined)).message).toBe(
      notJson,
    );
    expect(
      codecErrorOf(() => jsonCodec.write('[1]\n', [1, undefined])).message,
    ).toBe(notJson);
  });

  it('refuses an original that is not JSON, with its position', () => {
    const error = codecErrorOf(() => jsonCodec.write('{ // x\n}', {}));
    expect({
      message: error.message,
      line: error.line,
      column: error.column,
    }).toEqual({
      message: 'Invalid JSON at line 1, column 3: InvalidCommentToken',
      line: 1,
      column: 3,
    });
  });
});
