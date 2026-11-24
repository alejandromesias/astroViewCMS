import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CollectionSchemaJson } from 'preview-contract';
import { documentRecordSchema, schemaJsonSchema } from 'preview-contract';
import { describe, expect, it } from 'vitest';
import {
  type FieldKind,
  fieldKinds,
  kindOf,
  type NodeKind,
} from './schema-kinds.ts';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/bundle');

describe('kindOf', () => {
  const cases: Array<[string, Record<string, unknown>, NodeKind]> = [
    ['a string', { type: 'string' }, 'string'],
    ['a number', { type: 'number' }, 'number'],
    ['an integer', { type: 'integer' }, 'number'],
    ['a boolean', { type: 'boolean' }, 'boolean'],
    ['an enum', { type: 'string', enum: ['a', 'b'] }, 'enum'],
    ['a date', { type: 'string', cms: 'date' }, 'date'],
    ['an image', { type: 'string', cms: 'image' }, 'image'],
    [
      'a reference',
      { type: 'string', cms: 'reference', collection: 'authors' },
      'reference',
    ],
    ['an object', { type: 'object', properties: {} }, 'object'],
    ['an array', { type: 'array', items: { type: 'string' } }, 'array'],
    ['a union', { oneOf: [{ type: 'object', properties: {} }] }, 'union'],
    ['a nullable string', { type: ['string', 'null'] }, 'string'],
    [
      'a record (an object with no properties)',
      {
        type: 'object',
        propertyNames: { type: 'string' },
        additionalProperties: { type: 'number' },
      },
      'unknown',
    ],
    ['a node with no type', {}, 'unknown'],
    ['an array with no items', { type: 'array' }, 'unknown'],
    ['two types that are not null', { type: ['string', 'number'] }, 'unknown'],
    ['a $ref that names nothing', { $ref: '#/$defs/missing' }, 'unknown'],
  ];

  it.each(cases)('classifies %s', (_name, node, kind) => {
    expect(kindOf(node, {})).toBe(kind);
  });

  it('follows a $ref into $defs', () => {
    const root = { $defs: { day: { type: 'string', cms: 'date' } } };
    expect(kindOf({ $ref: '#/$defs/day' }, root)).toBe('date');
  });
});

describe('fieldKinds', () => {
  it('walks the properties, the array items and the union branches, with their paths', () => {
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        blocks: {
          type: 'array',
          items: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  type: { type: 'string', const: 'a' },
                  body: { type: 'string' },
                },
              },
            ],
          },
        },
      },
    };
    expect(fieldKinds(schema)).toStrictEqual<FieldKind[]>([
      { path: 'title', kind: 'string' },
      { path: 'blocks', kind: 'array' },
      { path: 'blocks[]', kind: 'union' },
      { path: 'blocks[].type', kind: 'string' },
      { path: 'blocks[].body', kind: 'string' },
    ]);
  });

  it('follows a $ref into $defs once, and cuts a cycle that comes back to it', () => {
    const schema = {
      type: 'object',
      properties: { self: { $ref: '#/$defs/node' } },
      $defs: {
        node: {
          type: 'object',
          properties: { child: { $ref: '#/$defs/node' } },
        },
      },
    };
    expect(fieldKinds(schema)).toStrictEqual<FieldKind[]>([
      { path: 'self', kind: 'object' },
      { path: 'self.child', kind: 'object' },
    ]);
  });
});

/** The sample's documents and schema.json, read and parsed as the CMS reads them. */
async function sampleBundle() {
  const documents = documentRecordSchema
    .array()
    .parse(
      JSON.parse(await readFile(path.join(FIXTURE, 'documents.json'), 'utf8')),
    );
  const schemas = schemaJsonSchema.parse(
    JSON.parse(await readFile(path.join(FIXTURE, 'schema.json'), 'utf8')),
  );
  return { documents, schemas };
}

describe('the sample bundle', () => {
  it('finds a known node kind or an explicit unknown for every field of every editable document', async () => {
    const { documents, schemas } = await sampleBundle();
    // A `data:` document (a data file the site code imports) belongs to no collection, so schema.json has no fields
    // for it. It is the explicit unknown, not a missing schema: its form is phase 3's JSON fallback.
    const dataDocuments: string[] = [];
    const fields: Array<FieldKind & { readonly document: string }> = [];
    for (const doc of documents) {
      if (doc.editable === false) continue;
      const collection = doc.key.split('/')[0] ?? '';
      const entry: CollectionSchemaJson | undefined = Object.hasOwn(
        schemas,
        collection,
      )
        ? schemas[collection]
        : undefined;
      if (entry?.schema === undefined) {
        dataDocuments.push(doc.key);
        continue;
      }
      for (const field of fieldKinds(entry.schema)) {
        fields.push({ document: doc.key, ...field });
      }
    }
    expect(dataDocuments).toStrictEqual([
      'data:src/config/config.json',
      'data:src/config/menu.json',
      'data:src/config/social.json',
      'data:src/config/theme.json',
    ]);
    expect(fields.filter((field) => field.kind === 'unknown')).toStrictEqual(
      [],
    );
    // The kinds the sample uses, exactly. A kind the sample starts to use (enum, say) is added here with its field.
    expect(new Set(fields.map((field) => field.kind))).toStrictEqual(
      new Set<NodeKind>([
        'string',
        'number',
        'boolean',
        'date',
        'image',
        'reference',
        'object',
        'array',
        'union',
      ]),
    );
  });

  it('exports blog.date as the date marker', async () => {
    const { schemas } = await sampleBundle();
    const blog = schemas.blog?.schema as
      | { properties: Record<string, unknown> }
      | undefined;
    expect(blog?.properties.date).toStrictEqual({
      type: 'string',
      cms: 'date',
    });
  });

  it('carries the UI hints of the site config onto the fields they name', async () => {
    const { schemas } = await sampleBundle();
    const blog = schemas.blog?.schema as {
      properties: Record<string, unknown>;
    };
    expect(blog.properties.description).toStrictEqual({
      type: 'string',
      ui: { widget: 'textarea' },
    });
    expect(blog.properties.image).toStrictEqual({
      type: 'string',
      ui: { widget: 'public-image' },
    });
    const landing = schemas.landing?.schema as {
      properties: {
        blocks: { items: { oneOf: Array<{ properties: object }> } };
      };
    };
    const [banner] = landing.properties.blocks.items.oneOf;
    expect((banner!.properties as { title: unknown }).title).toStrictEqual({
      type: 'string',
      ui: { label: 'Heading' },
    });
  });
});
