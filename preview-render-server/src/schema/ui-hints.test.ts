import { describe, expect, it } from 'vitest';
import type { UiHint } from '../types.ts';
import type { CollectionSchema } from './json-schema.ts';
import { applyUiHints } from './ui-hints.ts';

/** A blog collection with a title and a description, built per test. */
const blogOf = (): Record<string, CollectionSchema> => ({
  blog: {
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
});

/** A landing collection whose `blocks` are a union on `type`: a banner with a title, and a text block without one. */
const landingOf = (): Record<string, CollectionSchema> => ({
  landing: {
    schema: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          items: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  type: { type: 'string', const: 'banner' },
                  title: { type: 'string' },
                },
              },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', const: 'text' },
                  body: { type: 'string' },
                },
              },
            ],
          },
        },
      },
    },
  },
});

describe('applyUiHints', () => {
  it('copies each hint as ui onto the field it names', () => {
    const hints: Record<string, UiHint> = {
      'blog.title': { label: 'Title', widget: 'text' },
      'blog.description': { widget: 'textarea', hidden: false },
    };
    expect(applyUiHints(blogOf(), hints)).toStrictEqual({
      blog: {
        schema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              ui: { label: 'Title', widget: 'text' },
            },
            description: {
              type: 'string',
              ui: { widget: 'textarea', hidden: false },
            },
          },
        },
      },
    });
  });

  it('copies a hint onto the items of an array with [], and onto a field inside them', () => {
    const schemas: Record<string, CollectionSchema> = {
      landing: {
        schema: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
            links: {
              type: 'array',
              items: {
                type: 'object',
                properties: { url: { type: 'string' } },
              },
            },
          },
        },
      },
    };
    expect(
      applyUiHints(schemas, {
        'landing.tags[]': { widget: 'text' },
        'landing.links[].url': { label: 'Link' },
      }),
    ).toStrictEqual({
      landing: {
        schema: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string', ui: { widget: 'text' } },
            },
            links: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string', ui: { label: 'Link' } },
                },
              },
            },
          },
        },
      },
    });
  });

  it('applies a path through a union to every branch that has the field, and no other', () => {
    expect(
      applyUiHints(landingOf(), {
        'landing.blocks[].title': { label: 'Heading' },
      }),
    ).toStrictEqual({
      landing: {
        schema: {
          type: 'object',
          properties: {
            blocks: {
              type: 'array',
              items: {
                oneOf: [
                  {
                    type: 'object',
                    properties: {
                      type: { type: 'string', const: 'banner' },
                      title: { type: 'string', ui: { label: 'Heading' } },
                    },
                  },
                  {
                    type: 'object',
                    properties: {
                      type: { type: 'string', const: 'text' },
                      body: { type: 'string' },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    });
  });

  it('copies a hint onto a union itself when the path ends at it', () => {
    const out = applyUiHints(landingOf(), {
      'landing.blocks[]': { label: 'Block' },
    });
    const items = (
      out.landing!.schema as {
        properties: { blocks: { items: { ui?: unknown; oneOf: unknown[] } } };
      }
    ).properties.blocks.items;
    expect(items.ui).toStrictEqual({ label: 'Block' });
    expect(items.oneOf).toHaveLength(2);
  });

  it('leaves the collections it was given unchanged', () => {
    const before = blogOf();
    applyUiHints(before, { 'blog.title': { label: 'Title' } });
    expect(before).toStrictEqual(blogOf());
  });

  it('returns the collections as they were when there are no hints', () => {
    expect(applyUiHints(blogOf(), {})).toStrictEqual(blogOf());
  });

  it.each([
    ['a collection that does not exist', 'nope.title'],
    ['a field that does not exist', 'blog.missing'],
    ['a nested field that does not exist', 'blog.title.deeper'],
    ['a path with [] on a field that is not an array', 'blog.title[]'],
    ['a key with no path', 'blog'],
    ['a key with an empty collection', '.title'],
    ['a key with an empty path', 'blog.'],
    ['a path with an empty segment', 'blog..title'],
    ['a [] with no name before it', 'blog.[]'],
  ])('fails the build for a hint that names %s', (_name, key) => {
    expect(() => applyUiHints(blogOf(), { [key]: { label: 'x' } })).toThrow(
      new Error(`ui hint "${key}" matches no field`),
    );
  });

  it.each([
    ['constructor', 'blog.constructor'],
    ['__proto__', 'blog.__proto__'],
    ['toString', 'blog.toString'],
    ['hasOwnProperty', 'blog.hasOwnProperty'],
    ['a collection named constructor', 'constructor.title'],
    ['a collection named __proto__', '__proto__.title'],
  ])('does not match %s through the prototype', (_name, key) => {
    expect(() => applyUiHints(blogOf(), { [key]: { label: 'x' } })).toThrow(
      new Error(`ui hint "${key}" matches no field`),
    );
  });

  it('fails for a collection that has no schema (a loader alone)', () => {
    expect(() =>
      applyUiHints(
        { blog: { loader: { kind: 'glob', pattern: '*.md' } } },
        { 'blog.title': { label: 'x' } },
      ),
    ).toThrow(new Error('ui hint "blog.title" matches no field'));
  });

  it('does not follow a $ref to a field below it, so a path through one fails the build', () => {
    const schemas: Record<string, CollectionSchema> = {
      blog: {
        schema: {
          type: 'object',
          properties: { author: { $ref: '#/$defs/author' } },
          $defs: {
            author: {
              type: 'object',
              properties: { name: { type: 'string' } },
            },
          },
        },
      },
    };
    expect(() =>
      applyUiHints(schemas, { 'blog.author.name': { label: 'x' } }),
    ).toThrow(new Error('ui hint "blog.author.name" matches no field'));
  });

  it('copies a hint onto a $ref field itself', () => {
    const schemas: Record<string, CollectionSchema> = {
      blog: {
        schema: {
          type: 'object',
          properties: { author: { $ref: '#/$defs/author' } },
          $defs: { author: { type: 'object', properties: {} } },
        },
      },
    };
    expect(
      applyUiHints(schemas, { 'blog.author': { label: 'Writer' } }),
    ).toStrictEqual({
      blog: {
        schema: {
          type: 'object',
          properties: {
            author: { $ref: '#/$defs/author', ui: { label: 'Writer' } },
          },
          $defs: { author: { type: 'object', properties: {} } },
        },
      },
    });
  });
});
