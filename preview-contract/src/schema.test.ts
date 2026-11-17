import { describe, expect, it, vi } from 'vitest';
import {
  collectionSchemaJson,
  loaderInfoSchema,
  schemaJsonSchema,
} from './schema.ts';

/** The code and message of each issue a refused schema.json gives; an accepted
 *  one gives none, so a test compares the whole list. */
function refusalsOf(body: unknown): Array<[string, string]> {
  const result = schemaJsonSchema.safeParse(body);
  return result.success
    ? []
    : result.error.issues.map((issue): [string, string] => [
        issue.code,
        issue.message,
      ]);
}

describe('schemaJsonSchema', () => {
  it('accepts a collection with a loader and a JSON Schema, and one with an error', () => {
    const schemaJson = {
      pages: {
        loader: { kind: 'glob', pattern: '**/*.md', base: 'src/content/pages' },
        schema: { type: 'object', properties: { title: { type: 'string' } } },
      },
      notes: { error: 'Zod cannot export this schema' },
      bare: {},
    };
    expect(schemaJsonSchema.parse(schemaJson)).toEqual(schemaJson);
  });

  it('accepts an empty schema.json', () => {
    expect(schemaJsonSchema.parse({})).toEqual({});
  });

  it('keeps the read-only flag and the custom id, so a create can be refused', () => {
    const schemaJson = {
      fixtures: {
        loader: { kind: 'glob', pattern: '**/*.json', customId: true },
        readOnly: true,
      },
    };
    expect(schemaJsonSchema.parse(schemaJson)).toStrictEqual(schemaJson);
  });

  it('keeps a collection named __proto__ as an ordinary key', () => {
    const body = JSON.parse(
      '{"__proto__": {"loader": {"kind": "file", "pattern": "authors.json"}}}',
    );
    const parsed = schemaJsonSchema.parse(body);
    expect(Object.keys(parsed)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it.each([
    [
      'the root is an array',
      [],
      [['custom', '"schema.json" must be an object']],
    ],
    ['the root is null', null, [['custom', '"schema.json" must be an object']]],
    [
      'a collection is a string',
      { pages: 'x' },
      [
        [
          'custom',
          'collection "pages": Invalid input: expected object, received string',
        ],
      ],
    ],
    [
      'the loader kind is unknown',
      { pages: { loader: { kind: 'api', pattern: 'x' } } },
      [
        [
          'custom',
          'collection "pages": Invalid option: expected one of "glob"|"file"',
        ],
      ],
    ],
    [
      'the loader kind has the wrong case',
      { pages: { loader: { kind: 'Glob', pattern: 'x' } } },
      [
        [
          'custom',
          'collection "pages": Invalid option: expected one of "glob"|"file"',
        ],
      ],
    ],
    [
      'the loader kind has a trailing space',
      { pages: { loader: { kind: 'glob ', pattern: 'x' } } },
      [
        [
          'custom',
          'collection "pages": Invalid option: expected one of "glob"|"file"',
        ],
      ],
    ],
    [
      'the loader has no pattern',
      { pages: { loader: { kind: 'file' } } },
      [
        [
          'custom',
          'collection "pages": Invalid input: expected string, received undefined',
        ],
      ],
    ],
    [
      'the schema is an array',
      { pages: { schema: [] } },
      [['custom', 'collection "pages": "schema" must be an object']],
    ],
    [
      'the error is not a string',
      { pages: { error: 1 } },
      [
        [
          'custom',
          'collection "pages": Invalid input: expected string, received number',
        ],
      ],
    ],
    [
      'an unknown key is present',
      { pages: { schema: {}, extra: 1 } },
      [['custom', 'collection "pages": Unrecognized key: "extra"']],
    ],
    [
      'the custom id is false',
      { pages: { loader: { kind: 'glob', pattern: 'x', customId: false } } },
      [['custom', 'collection "pages": Invalid input: expected true']],
    ],
    [
      'the read-only flag is not a boolean',
      { pages: { readOnly: 'yes' } },
      [
        [
          'custom',
          'collection "pages": Invalid input: expected boolean, received string',
        ],
      ],
    ],
  ])('refuses schema.json where %s', (_name, body, expected) => {
    expect(refusalsOf(body)).toEqual(expected);
  });

  it('gives the fallback reason when Zod leaves no message for a collection', () => {
    vi.spyOn(collectionSchemaJson, 'safeParse').mockReturnValueOnce({
      success: false,
      error: { issues: [] },
    } as unknown as ReturnType<typeof collectionSchemaJson.safeParse>);
    expect(refusalsOf({ pages: {} })).toEqual([
      ['custom', 'collection "pages": is invalid'],
    ]);
  });

  it('reports only the first collection that fails', () => {
    expect(refusalsOf({ pages: 'x', notes: 'y' })).toEqual([
      [
        'custom',
        'collection "pages": Invalid input: expected object, received string',
      ],
    ]);
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'names a collection called %s in its refusal',
    (name) => {
      const body: unknown = JSON.parse(`{"${name}": "x"}`);
      expect(refusalsOf(body)).toEqual([
        [
          'custom',
          `collection "${name}": Invalid input: expected object, received string`,
        ],
      ]);
    },
  );

  it.each(['constructor', 'toString'])(
    'keeps a collection named %s as an ordinary key',
    (name) => {
      const body: unknown = JSON.parse(
        `{"${name}": {"loader": {"kind": "file", "pattern": "a.json"}}}`,
      );
      const parsed = schemaJsonSchema.parse(body);
      expect(Object.keys(parsed)).toEqual([name]);
      expect(parsed[name]).toEqual({
        loader: { kind: 'file', pattern: 'a.json' },
      });
    },
  );
});

describe('loaderInfoSchema', () => {
  it('accepts a glob with a base and a file without one', () => {
    const glob = { kind: 'glob', pattern: '**/*.md', base: 'src/content' };
    const file = { kind: 'file', pattern: 'authors.json' };
    expect(loaderInfoSchema.parse(glob)).toStrictEqual(glob);
    expect(loaderInfoSchema.parse(file)).toStrictEqual(file);
  });

  it.each(['Glob', 'glob ', 'files', ''])(
    'refuses the loader kind %j',
    (kind) => {
      const result = loaderInfoSchema.safeParse({ kind, pattern: 'x' });
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        'Invalid option: expected one of "glob"|"file"',
      ]);
    },
  );
});

describe('collectionSchemaJson', () => {
  it('accepts an entry that has none of its fields', () => {
    expect(collectionSchemaJson.parse({})).toStrictEqual({});
  });

  it('refuses an unknown key, so a writer change shows up at once', () => {
    expect(
      collectionSchemaJson.safeParse({ loader: undefined, rules: [] }).success,
    ).toBe(false);
  });
});
