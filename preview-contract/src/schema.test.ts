import { describe, expect, it } from 'vitest';
import { collectionSchemaJson, schemaJsonSchema } from './schema.ts';

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
    ['the root is an array', []],
    ['the root is null', null],
    ['a collection is a string', { pages: 'x' }],
    [
      'the loader kind is unknown',
      { pages: { loader: { kind: 'api', pattern: 'x' } } },
    ],
    ['the loader has no pattern', { pages: { loader: { kind: 'file' } } }],
    ['the schema is an array', { pages: { schema: [] } }],
    ['the error is not a string', { pages: { error: 1 } }],
    ['an unknown key is present', { pages: { schema: {}, extra: 1 } }],
    [
      'the custom id is false',
      { pages: { loader: { kind: 'glob', pattern: 'x', customId: false } } },
    ],
    ['the read-only flag is not a boolean', { pages: { readOnly: 'yes' } }],
  ])('refuses schema.json where %s', (_name, body) => {
    expect(schemaJsonSchema.safeParse(body).success).toBe(false);
  });
});

describe('collectionSchemaJson', () => {
  it('refuses an unknown key, so a writer change shows up at once', () => {
    expect(
      collectionSchemaJson.safeParse({ loader: undefined, rules: [] }).success,
    ).toBe(false);
  });
});
