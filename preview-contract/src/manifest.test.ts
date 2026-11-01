import { describe, expect, it } from 'vitest';
import { documentRecordSchema, routeRecordSchema } from './manifest.ts';

/** A complete, valid document record, built per test. */
const documentOf = () => ({
  key: 'blog/a/b',
  file: 'src/content/blog/a/b.md',
  format: 'md',
  entryKey: 'a/b',
  buildTime: true,
  buildTimeFields: ['title', '*'],
});

/** A complete, valid route record, built per test. */
const routeOf = () => ({
  pattern: '/blog/[...single]',
  component: 'src/pages/blog/[...single].astro',
  type: 'page',
  dynamic: true,
  params: ['single'],
  restParams: ['single'],
  hasStaticPaths: true,
});

describe('documentRecordSchema', () => {
  it('accepts a complete record and one with only the required keys', () => {
    expect(documentRecordSchema.parse(documentOf())).toEqual(documentOf());
    const minimal = { key: 'data:x.json', format: 'json', buildTime: false };
    expect(documentRecordSchema.parse(minimal)).toEqual(minimal);
  });

  it('accepts editable only as false, the TOML and other-format case', () => {
    const toml = {
      key: 'data:x.toml',
      format: 'toml',
      buildTime: false,
      editable: false,
    };
    expect(documentRecordSchema.parse(toml)).toEqual(toml);
    expect(
      documentRecordSchema.safeParse({ ...toml, editable: true }).success,
    ).toBe(false);
  });

  it.each([
    ['key is missing', { key: undefined }],
    ['key is a number', { key: 1 }],
    ['format is unknown', { format: 'docx' }],
    ['format is a near miss', { format: 'MD' }],
    ['buildTime is missing', { buildTime: undefined }],
    ['buildTimeFields holds a non-string', { buildTimeFields: [1] }],
    ['buildTimeFields is not an array', { buildTimeFields: 'title' }],
  ])('refuses a record where %s', (_name, change) => {
    expect(
      documentRecordSchema.safeParse({ ...documentOf(), ...change }).success,
    ).toBe(false);
  });
});

describe('routeRecordSchema', () => {
  it('accepts a complete record', () => {
    expect(routeRecordSchema.parse(routeOf())).toEqual(routeOf());
  });

  it.each(['page', 'endpoint', 'redirect', 'fallback'])(
    'accepts type %s',
    (type) => {
      expect(routeRecordSchema.safeParse({ ...routeOf(), type }).success).toBe(
        true,
      );
    },
  );

  it.each([
    ['type is unknown', { type: 'layout' }],
    ['dynamic is a string', { dynamic: 'yes' }],
    ['params is missing', { params: undefined }],
    ['restParams holds a number', { restParams: [0] }],
    ['hasStaticPaths is missing', { hasStaticPaths: undefined }],
  ])('refuses a record where %s', (_name, change) => {
    expect(
      routeRecordSchema.safeParse({ ...routeOf(), ...change }).success,
    ).toBe(false);
  });
});
