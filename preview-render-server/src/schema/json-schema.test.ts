import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';
import { shapeSchemas } from './json-schema.ts';

describe('shapeSchemas', () => {
  it('exports a JSON Schema per collection and keeps the loader', () => {
    const out = shapeSchemas({
      pages: { loader: { kind: 'glob', pattern: '**/*.md', base: 'src/content/pages' }, schema: z.object({ title: z.string() }) },
    });
    expect(out.pages.loader).toEqual({ kind: 'glob', pattern: '**/*.md', base: 'src/content/pages' });
    expect(out.pages.schema).toMatchObject({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] });
  });

  it('exports what an author writes: defaults are not required, transforms are ignored', () => {
    const out = shapeSchemas({
      c: { loader: undefined, schema: z.object({ n: z.string().default('x'), d: z.coerce.date(), t: z.string().transform((s) => s.length) }) },
    });
    const schema = out.c.schema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(['d', 't']);
    expect(schema.properties.t).toEqual({ type: 'string' });
  });

  it('keeps a collection without a schema, and reports a schema Zod cannot export', () => {
    const out = shapeSchemas({
      none: { loader: undefined, schema: undefined },
      bad: { loader: undefined, schema: { toString: () => 'x' } as unknown as z.ZodType },
    });
    expect(out.none).toEqual({});
    expect(out.bad.schema).toBeUndefined();
    expect(out.bad.error).toEqual(expect.any(String));
  });
});
