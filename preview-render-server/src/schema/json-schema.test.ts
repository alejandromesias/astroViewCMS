import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';
import { shapeSchemas } from './json-schema.ts';

describe('shapeSchemas', () => {
  it('exports a JSON Schema per collection and keeps the loader', () => {
    const out = shapeSchemas({
      pages: {
        loader: { kind: 'glob', pattern: '**/*.md', base: 'src/content/pages' },
        schema: z.object({ title: z.string() }),
      },
    });
    expect(out.pages!.loader).toEqual({
      kind: 'glob',
      pattern: '**/*.md',
      base: 'src/content/pages',
    });
    expect(out.pages!.schema).toMatchObject({
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    });
  });

  it('marks a read-only collection, and no other', () => {
    const none = { loader: undefined, schema: undefined };
    const out = shapeSchemas({ fixtures: none, posts: none }, ['fixtures']);
    expect(out).toStrictEqual({ fixtures: { readOnly: true }, posts: {} });
  });

  it('exports what an author writes: defaults are not required, transforms are ignored', () => {
    const out = shapeSchemas({
      c: {
        loader: undefined,
        schema: z.object({
          n: z.string().default('x'),
          d: z.coerce.date(),
          t: z.string().transform((s) => s.length),
        }),
      },
    });
    const schema = out.c!.schema as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(['d', 't']);
    expect(schema.properties.t).toEqual({ type: 'string' });
  });

  it('keeps a collection without a schema, and reports a schema Zod cannot export', () => {
    const out = shapeSchemas({
      none: { loader: undefined, schema: undefined },
      bad: {
        loader: undefined,
        schema: { toString: () => 'x' } as unknown as z.ZodType,
      },
    });
    expect(out.none).toEqual({});
    expect(out.bad!.schema).toBeUndefined();
    expect(out.bad!.error).toEqual(expect.any(String));
  });

  it('reports a schema whose export throws a non-Error, as its text', () => {
    // A schema whose property reads throw a string: Zod's export throws it.
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw 'no zod';
        },
      },
    );
    const out = shapeSchemas({
      c: { loader: undefined, schema: hostile as unknown as z.ZodType },
    });
    expect(out.c!.schema).toBeUndefined();
    expect(out.c!.error).toBe('no zod');
  });
});

describe('shapeSchemas: dates and discriminated unions (2.14c)', () => {
  it('exports a z.date() as a string marked date, with no format', () => {
    const out = shapeSchemas({
      c: { loader: undefined, schema: z.object({ d: z.date() }) },
    });
    expect(out.c!.schema).toStrictEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { d: { type: 'string', cms: 'date' } },
      required: ['d'],
    });
  });

  it('exports a z.coerce.date() the same way', () => {
    const out = shapeSchemas({
      c: { loader: undefined, schema: z.object({ d: z.coerce.date() }) },
    });
    expect(out.c!.schema).toStrictEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { d: { type: 'string', cms: 'date' } },
      required: ['d'],
    });
  });

  it('marks a nullable date on its wrapper too, so the field still reads as a date', () => {
    const out = shapeSchemas({
      c: {
        loader: undefined,
        schema: z.object({
          d: z.date().nullable(),
          e: z.coerce.date().nullable(),
        }),
      },
    });
    const props = (out.c!.schema as { properties: Record<string, unknown> })
      .properties;
    const nullableDate = {
      anyOf: [{ type: 'string', cms: 'date' }, { type: 'null' }],
      cms: 'date',
    };
    expect(props.d).toStrictEqual(nullableDate);
    expect(props.e).toStrictEqual(nullableDate);
  });

  it('marks a discriminated union with its key, and each branch with its constant', () => {
    const out = shapeSchemas({
      c: {
        loader: undefined,
        schema: z.object({
          blocks: z.array(
            z.discriminatedUnion('type', [
              z.object({ type: z.literal('a') }),
              z.object({ type: z.literal('b') }),
            ]),
          ),
        }),
      },
    });
    const union = (
      out.c!.schema as { properties: { blocks: { items: object } } }
    ).properties.blocks.items;
    expect(union).toMatchObject({ cmsDiscriminator: 'type' });
    expect(
      (union as { oneOf: Array<{ properties: object }> }).oneOf.map(
        (branch) => (branch.properties as { type: object }).type,
      ),
    ).toStrictEqual([
      { type: 'string', const: 'a' },
      { type: 'string', const: 'b' },
    ]);
  });

  it('gives a plain z.union no cmsDiscriminator, so cms stays a string', () => {
    const out = shapeSchemas({
      c: {
        loader: undefined,
        schema: z.object({
          value: z.union([
            z.object({ kind: z.literal('a') }),
            z.object({ kind: z.literal('b') }),
          ]),
        }),
      },
    });
    const value = (out.c!.schema as { properties: { value: object } })
      .properties.value;
    expect(value).not.toHaveProperty('cmsDiscriminator');
    expect(Object.keys(value)).not.toContain('cmsDiscriminator');
    expect(value).not.toHaveProperty('cms');
  });
});

describe('shapeSchemas: optional, nullable and default in nested fields and array items (2.14c)', () => {
  // Each case puts the field in a nested object and in the items of an array; both export the same object.
  const cases: Array<{ name: string; field: z.ZodType; exported: object }> = [
    {
      name: 'optional',
      field: z.string().optional(),
      exported: { type: 'object', properties: { note: { type: 'string' } } },
    },
    {
      name: 'nullable',
      field: z.string().nullable(),
      exported: {
        type: 'object',
        properties: { note: { type: ['string', 'null'] } },
        required: ['note'],
      },
    },
    {
      name: 'default',
      field: z.string().default('x'),
      exported: {
        type: 'object',
        properties: { note: { type: 'string', default: 'x' } },
      },
    },
  ];

  it.each(cases)(
    'keeps $name in a nested field and in an array item',
    ({ field, exported }) => {
      const out = shapeSchemas({
        c: {
          loader: undefined,
          schema: z.object({
            outer: z.object({ note: field }),
            list: z.array(z.object({ note: field })),
          }),
        },
      });
      const { properties } = out.c!.schema as {
        properties: { outer: object; list: { items: object } };
      };
      expect(properties.outer).toStrictEqual(exported);
      expect(properties.list.items).toStrictEqual(exported);
    },
  );
});
