import type { BundleJson } from 'preview-contract';
import { describe, expect, it } from 'vitest';
import { FIXTURE_BUNDLE } from '../../test/helpers/bundle.ts';
import { readBundle } from '../bundle/read.ts';
import { type MarkerHit, type SchemaNode, walkMarkers } from './walk.ts';

/** The identity of the fixture bundle, as readBundle takes it. */
const identity = (): BundleJson => ({
  bundleId: 'fixture-2026-11-01',
  siteCommit: 'bec46fcadfe832d7bdec8b06eee6ba6546bd2596',
  protocolVersion: 2,
  astroVersion: '7.4.2',
  builtAt: '2026-11-01T10:00:00.000Z',
});

/** The JSON Schema of one collection of the fixture bundle, read through the 2.4a reader. */
async function collectionSchema(name: string): Promise<SchemaNode> {
  const bundle = await readBundle(FIXTURE_BUNDLE, identity());
  const schema = bundle.collections.get(name)?.schema;
  if (schema === undefined) throw new Error(`no schema for ${name}`);
  return schema;
}

/** Every hit of a walk, in the order the visitor receives them. */
function hitsOf(schema: SchemaNode, value: unknown): MarkerHit[] {
  const hits: MarkerHit[] = [];
  walkMarkers(schema, value, (hit) => {
    hits.push(hit);
  });
  return hits;
}

describe('walkMarkers on the sample schema', () => {
  it('reports the testimonial references of the landing blocks union', async () => {
    const schema = await collectionSchema('landing');
    // A trimmed copy of sample-site/src/content/landing/home-v2.json: a banner, then the testimonials block.
    const value = {
      title: 'Home v2 (landing builder)',
      blocks: [
        {
          type: 'banner',
          title: 'Let us solve your critical website development challenges',
          image: '/images/banner-art.png',
        },
        {
          type: 'testimonials',
          title: 'What customers say',
          items: ['t-ana', 't-marco', 't-lena', 't-kofi'],
        },
      ],
    };
    expect(hitsOf(schema, value)).toEqual([
      { path: ['blocks', 1, 'items', 0], marker: 'reference', value: 't-ana' },
      {
        path: ['blocks', 1, 'items', 1],
        marker: 'reference',
        value: 't-marco',
      },
      { path: ['blocks', 1, 'items', 2], marker: 'reference', value: 't-lena' },
      { path: ['blocks', 1, 'items', 3], marker: 'reference', value: 't-kofi' },
    ]);
  });

  it('reports nothing for a block whose type matches no branch', async () => {
    const schema = await collectionSchema('landing');
    // The testimonials branch is not walked for a banner, and an unknown type matches no branch at all.
    const banner = { blocks: [{ type: 'banner', items: ['t-ana'] }] };
    const unknown = { blocks: [{ type: 'gallery', items: ['t-ana'] }] };
    expect(hitsOf(schema, banner)).toEqual([]);
    expect(hitsOf(schema, unknown)).toEqual([]);
  });

  it('reports the avatar image of an author', async () => {
    const schema = await collectionSchema('authors');
    // The value of sample-site/src/content/authors/ana-torres.json.
    const value = {
      name: 'Ana Torres',
      role: 'Design Lead',
      bio: 'Ana leads product design and writes about visual systems and photography.',
      avatar: '../../assets/authors/ana-torres.png',
    };
    expect(hitsOf(schema, value)).toEqual([
      {
        path: ['avatar'],
        marker: 'image',
        value: '../../assets/authors/ana-torres.png',
      },
    ]);
  });

  it('reports nothing for an absent or null avatar', async () => {
    const schema = await collectionSchema('authors');
    expect(hitsOf(schema, { name: 'Ana Torres' })).toEqual([]);
    expect(hitsOf(schema, { name: 'Ana Torres', avatar: null })).toEqual([]);
  });
});

describe('walkMarkers on synthetic schemas', () => {
  it('follows a $ref into $defs', () => {
    const schema = {
      type: 'object',
      properties: { hero: { $ref: '#/$defs/image' } },
      $defs: { image: { type: 'string', cms: 'image' } },
    };
    expect(hitsOf(schema, { hero: 'hero.png' })).toEqual([
      { path: ['hero'], marker: 'image', value: 'hero.png' },
    ]);
  });

  it('stops a cyclic $ref that never reaches a value', () => {
    const schema = {
      type: 'object',
      properties: { x: { $ref: '#/$defs/loop' } },
      $defs: { loop: { $ref: '#/$defs/loop' } },
    };
    expect(hitsOf(schema, { x: 'a' })).toEqual([]);
  });

  it('walks a recursive $ref through the data it describes', () => {
    const schema = {
      $ref: '#/$defs/node',
      $defs: {
        node: {
          type: 'object',
          properties: {
            name: { type: 'string', cms: 'reference' },
            next: { $ref: '#/$defs/node' },
          },
        },
      },
    };
    const value = { name: 'a', next: { name: 'b', next: { name: 'c' } } };
    expect(hitsOf(schema, value)).toEqual([
      { path: ['name'], marker: 'reference', value: 'a' },
      { path: ['next', 'name'], marker: 'reference', value: 'b' },
      { path: ['next', 'next', 'name'], marker: 'reference', value: 'c' },
    ]);
  });

  it('throws when a $ref names no entry of $defs', () => {
    expect(() =>
      walkMarkers({ $ref: '#/$defs/missing' }, 'x', () => undefined),
    ).toThrow('unresolved $ref "#/$defs/missing"');
  });

  it('throws for a $ref to a name that only Object.prototype has', () => {
    expect(() =>
      walkMarkers({ $ref: '#/$defs/__proto__' }, 'x', () => undefined),
    ).toThrow('unresolved $ref "#/$defs/__proto__"');
  });

  it('throws for a $ref outside $defs, even when $defs has a key named undefined', () => {
    expect(() =>
      walkMarkers(
        { $defs: { undefined: { type: 'string' } }, $ref: '#/other' },
        'x',
        () => undefined,
      ),
    ).toThrow('unresolved $ref "#/other"');
  });

  it('walks a null-typed branch for null but not for a string, so a bad $ref inside it throws only for null', () => {
    const schema = {
      oneOf: [
        { type: 'null', anyOf: [{ $ref: '#/$defs/missing' }] },
        { type: 'string' },
      ],
    };
    expect(() => walkMarkers(schema, 'x', () => undefined)).not.toThrow();
    expect(() => walkMarkers(schema, null, () => undefined)).toThrow(
      'unresolved $ref "#/$defs/missing"',
    );
  });

  it('walks every branch of anyOf that fits the value', () => {
    const schema = {
      anyOf: [
        {
          type: 'object',
          properties: { a: { type: 'string', cms: 'image' } },
        },
        {
          type: 'object',
          properties: { b: { type: 'string', cms: 'reference' } },
        },
      ],
    };
    expect(hitsOf(schema, { a: 'x.png', b: 't-1' })).toEqual([
      { path: ['a'], marker: 'image', value: 'x.png' },
      { path: ['b'], marker: 'reference', value: 't-1' },
    ]);
  });

  it('walks only the branch whose const matches the discriminator', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { const: 'a' },
            ref: { type: 'string', cms: 'reference' },
          },
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'b' },
            ref: { type: 'string', cms: 'image' },
          },
        },
      ],
    };
    expect(hitsOf(schema, { kind: 'b', ref: 'x.png' })).toEqual([
      { path: ['ref'], marker: 'image', value: 'x.png' },
    ]);
  });

  it('reports nothing when no branch const matches the discriminator', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { const: 'a' },
            ref: { type: 'string', cms: 'reference' },
          },
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'b' },
            ref: { type: 'string', cms: 'image' },
          },
        },
      ],
    };
    expect(hitsOf(schema, { kind: 'c', ref: 't-1' })).toEqual([]);
    expect(hitsOf(schema, { ref: 't-1' })).toEqual([]);
  });

  it('walks by type when the union has no discriminator', () => {
    const schema = {
      oneOf: [
        { type: 'string', cms: 'image' },
        {
          type: 'object',
          properties: { ref: { type: 'string', cms: 'reference' } },
        },
      ],
    };
    expect(hitsOf(schema, { ref: 't-1' })).toEqual([
      { path: ['ref'], marker: 'reference', value: 't-1' },
    ]);
    expect(hitsOf(schema, 'a.png')).toEqual([
      { path: [], marker: 'image', value: 'a.png' },
    ]);
  });

  it('accepts a type given as a list, such as object or null', () => {
    const schema = {
      oneOf: [
        {
          type: ['object', 'null'],
          properties: { avatar: { type: 'string', cms: 'image' } },
        },
        { type: 'string', cms: 'reference' },
      ],
    };
    expect(hitsOf(schema, { avatar: 'a.png' })).toEqual([
      { path: ['avatar'], marker: 'image', value: 'a.png' },
    ]);
    expect(hitsOf(schema, 'x')).toEqual([
      { path: [], marker: 'reference', value: 'x' },
    ]);
    expect(hitsOf(schema, null)).toEqual([]);
  });

  it('reports one hit per path and marker when two branches mark the same field', () => {
    const avatar = { type: 'string', cms: 'image' };
    const schema = {
      anyOf: [
        { type: 'object', properties: { avatar } },
        { type: 'object', properties: { avatar } },
      ],
    };
    expect(hitsOf(schema, { avatar: 'a.png' })).toEqual([
      { path: ['avatar'], marker: 'image', value: 'a.png' },
    ]);
  });

  it('keeps both hits when two branches mark the same path with different markers', () => {
    const schema = {
      anyOf: [
        {
          type: 'object',
          properties: { field: { type: 'string', cms: 'image' } },
        },
        {
          type: 'object',
          properties: { field: { type: 'string', cms: 'reference' } },
        },
      ],
    };
    expect(hitsOf(schema, { field: 'x' })).toEqual([
      { path: ['field'], marker: 'image', value: 'x' },
      { path: ['field'], marker: 'reference', value: 'x' },
    ]);
  });

  it('reports each item of a reference array at the item path', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string', cms: 'reference' } },
      },
    };
    expect(hitsOf(schema, { tags: ['t-1', 't-2'] })).toEqual([
      { path: ['tags', 0], marker: 'reference', value: 't-1' },
      { path: ['tags', 1], marker: 'reference', value: 't-2' },
    ]);
  });

  it('reports each item when the array itself carries the marker', () => {
    const schema = { type: 'array', cms: 'reference' };
    expect(hitsOf(schema, ['t-1', null, 't-2'])).toEqual([
      { path: [0], marker: 'reference', value: 't-1' },
      { path: [2], marker: 'reference', value: 't-2' },
    ]);
  });

  it('applies additionalProperties to keys that are not declared, including __proto__', () => {
    const schema = {
      type: 'object',
      properties: { hero: { type: 'string', cms: 'image' } },
      additionalProperties: { type: 'string', cms: 'reference' },
    };
    const value = JSON.parse('{"hero":"a.png","__proto__":"t-1"}');
    expect(hitsOf(schema, value)).toEqual([
      { path: ['hero'], marker: 'image', value: 'a.png' },
      { path: ['__proto__'], marker: 'reference', value: 't-1' },
    ]);
  });

  it('applies prefixItems by index and items to the rest of a tuple', () => {
    const schema = {
      type: 'array',
      prefixItems: [
        { type: 'string', cms: 'image' },
        { type: 'string' },
        { type: 'string', cms: 'reference' },
      ],
      items: { type: 'string', cms: 'reference' },
    };
    expect(hitsOf(schema, ['a.png', 'label', 't-1', 't-2'])).toEqual([
      { path: [0], marker: 'image', value: 'a.png' },
      { path: [2], marker: 'reference', value: 't-1' },
      { path: [3], marker: 'reference', value: 't-2' },
    ]);
  });

  it('does not resolve a $ref for a property whose value is undefined', () => {
    const schema = {
      type: 'object',
      properties: { hero: { $ref: '#/$defs/missing' } },
      $defs: {},
    };
    expect(hitsOf(schema, { hero: undefined })).toEqual([]);
  });

  it('skips a property whose schema is null, and walks the other properties', () => {
    const schema = {
      type: 'object',
      properties: {
        note: null,
        hero: { type: 'string', cms: 'image' },
      },
    };
    expect(hitsOf(schema, { note: 'x', hero: 'a.png' })).toEqual([
      { path: ['hero'], marker: 'image', value: 'a.png' },
    ]);
  });

  it('reports nothing for a null value under a discriminated union', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { const: 'a' },
            ref: { type: 'string', cms: 'reference' },
          },
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'b' },
            ref: { type: 'string', cms: 'image' },
          },
        },
      ],
    };
    expect(hitsOf(schema, null)).toEqual([]);
  });

  it('skips a union branch whose $ref never reaches a schema, and walks the other branches', () => {
    const schema = {
      oneOf: [{ $ref: '#/$defs/loop' }, { type: 'string', cms: 'image' }],
      $defs: { loop: { $ref: '#/$defs/loop' } },
    };
    expect(hitsOf(schema, 'a.png')).toEqual([
      { path: [], marker: 'image', value: 'a.png' },
    ]);
  });

  it('walks a plain union branch when a later branch is a cyclic $ref', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { const: 'a' },
            ref: { type: 'string', cms: 'reference' },
          },
        },
        { $ref: '#/$defs/loop' },
      ],
      $defs: { loop: { $ref: '#/$defs/loop' } },
    };
    expect(hitsOf(schema, { kind: 'a', ref: 't-1' })).toEqual([
      { path: ['ref'], marker: 'reference', value: 't-1' },
    ]);
  });

  it('follows a union branch that is a $ref to a $defs schema, and checks that schema type', () => {
    const schema = {
      oneOf: [
        { $ref: '#/$defs/image' },
        {
          type: 'object',
          properties: { ref: { type: 'string', cms: 'reference' } },
        },
      ],
      $defs: { image: { type: 'string', cms: 'image' } },
    };
    expect(hitsOf(schema, 'a.png')).toEqual([
      { path: [], marker: 'image', value: 'a.png' },
    ]);
    expect(hitsOf(schema, { ref: 't-1' })).toEqual([
      { path: ['ref'], marker: 'reference', value: 't-1' },
    ]);
  });

  it('finds no discriminator when a branch fixes its key with a $ref that cycles', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { $ref: '#/$defs/loop' },
            ref: { type: 'string', cms: 'image' },
          },
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'b' },
            ref: { type: 'string', cms: 'reference' },
          },
        },
      ],
      $defs: { loop: { $ref: '#/$defs/loop' } },
    };
    expect(hitsOf(schema, { kind: 'b', ref: 'x' })).toEqual([
      { path: ['ref'], marker: 'image', value: 'x' },
      { path: ['ref'], marker: 'reference', value: 'x' },
    ]);
  });

  it('finds no discriminator when a branch declares its key as a value that is not a schema', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: null,
            ref: { type: 'string', cms: 'image' },
          },
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'b' },
            ref: { type: 'string', cms: 'reference' },
          },
        },
      ],
    };
    expect(hitsOf(schema, { kind: 'b', ref: 'x' })).toEqual([
      { path: ['ref'], marker: 'image', value: 'x' },
      { path: ['ref'], marker: 'reference', value: 'x' },
    ]);
  });

  it('walks every branch by type when one branch has no const for the first key', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { const: 'a' },
            ref: { type: 'string', cms: 'reference' },
          },
        },
        {
          type: 'object',
          properties: { ref: { type: 'string', cms: 'image' } },
        },
      ],
    };
    expect(hitsOf(schema, { kind: 'a', ref: 't-1' })).toEqual([
      { path: ['ref'], marker: 'reference', value: 't-1' },
      { path: ['ref'], marker: 'image', value: 't-1' },
    ]);
  });

  it('does not walk a null-typed branch for a string value, and walks it for null', () => {
    const schema = {
      oneOf: [
        { type: 'null', cms: 'image' },
        { type: 'string', cms: 'reference' },
      ],
    };
    expect(hitsOf(schema, 'x')).toEqual([
      { path: [], marker: 'reference', value: 'x' },
    ]);
    expect(hitsOf(schema, null)).toEqual([]);
  });

  it('walks an array-typed union branch for an array value, and not an object branch', () => {
    const schema = {
      oneOf: [
        { type: 'array', items: { type: 'string', cms: 'reference' } },
        { type: 'object', cms: 'image' },
      ],
    };
    expect(hitsOf(schema, ['t-1', 't-2'])).toEqual([
      { path: [0], marker: 'reference', value: 't-1' },
      { path: [1], marker: 'reference', value: 't-2' },
    ]);
  });

  it('matches boolean, number and integer union branches by their own types', () => {
    const schema = {
      oneOf: [
        { type: 'boolean', cms: 'image' },
        { type: 'number', cms: 'reference' },
        { type: 'integer', cms: 'image' },
      ],
    };
    expect(hitsOf(schema, true)).toEqual([
      { path: [], marker: 'image', value: true },
    ]);
    expect(hitsOf(schema, 2)).toEqual([
      { path: [], marker: 'reference', value: 2 },
      { path: [], marker: 'image', value: 2 },
    ]);
    expect(hitsOf(schema, 1.5)).toEqual([
      { path: [], marker: 'reference', value: 1.5 },
    ]);
    expect(hitsOf(schema, 'x')).toEqual([]);
  });

  it('matches no union branch whose type name is unknown', () => {
    const schema = {
      oneOf: [
        { type: 'date', cms: 'image' },
        { type: 'string', cms: 'reference' },
      ],
    };
    expect(hitsOf(schema, 'x')).toEqual([
      { path: [], marker: 'reference', value: 'x' },
    ]);
  });

  it('walks a union branch that has no type, for any value', () => {
    const schema = {
      oneOf: [{ cms: 'image' }, { type: 'string', cms: 'reference' }],
    };
    expect(hitsOf(schema, 'x')).toEqual([
      { path: [], marker: 'image', value: 'x' },
      { path: [], marker: 'reference', value: 'x' },
    ]);
  });

  it('does not report an undefined item of a marked array', () => {
    const schema = { type: 'array', cms: 'reference' };
    expect(hitsOf(schema, ['t-1', undefined])).toEqual([
      { path: [0], marker: 'reference', value: 't-1' },
    ]);
  });

  it('ignores union entries that are not schemas, and a union keyword that is not a list', () => {
    expect(
      hitsOf({ oneOf: [null, { type: 'string', cms: 'image' }] }, 'a.png'),
    ).toEqual([{ path: [], marker: 'image', value: 'a.png' }]);
    expect(
      hitsOf({ anyOf: { type: 'string', cms: 'image' } }, 'a.png'),
    ).toEqual([]);
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'throws for a $ref to %s, which is not an entry of $defs',
    (name) => {
      const ref = `#/$defs/${name}`;
      expect(() =>
        walkMarkers({ $ref: ref, $defs: {} }, 'x', () => undefined),
      ).toThrow(`unresolved $ref "${ref}"`);
    },
  );
});
