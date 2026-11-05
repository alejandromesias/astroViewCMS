import { describe, expect, it } from 'vitest';
import type { DocumentEntry } from '../bundle/read.ts';
import type { SaveChange } from './body.ts';
import { needsRebuild } from './rebuild.ts';

// A build-time document of the bundle, with the given fields (absent for none).
const buildTime = (fields?: string[]): DocumentEntry => ({
  key: 'data:src/config/config.json',
  file: 'src/config/config.json',
  format: 'json',
  buildTime: true,
  buildTimeFields: fields,
  revision: 'r',
});

// A change that updates `document` to `data`.
const update = (document: string, data: unknown): SaveChange => ({
  document,
  baseRevision: 'r',
  deleted: false,
  data,
});

const DOC = 'data:src/config/config.json';

describe('needsRebuild', () => {
  it('is true when a listed field changed', () => {
    const stored = new Map([[DOC, { site: { base_url: '/a', name: 'x' } }]]);
    expect(
      needsRebuild(
        [update(DOC, { site: { base_url: '/b', name: 'x' } })],
        new Map([[DOC, buildTime(['site.base_url'])]]),
        stored,
      ),
    ).toBe(true);
  });

  it('is false when only an unlisted field changed', () => {
    const stored = new Map([[DOC, { site: { base_url: '/a', name: 'x' } }]]);
    expect(
      needsRebuild(
        [update(DOC, { site: { base_url: '/a', name: 'y' } })],
        new Map([[DOC, buildTime(['site.base_url'])]]),
        stored,
      ),
    ).toBe(false);
  });

  it('compares the canonical JSON, so the order of keys does not count', () => {
    const stored = new Map([[DOC, { site: { a: 1, b: 2 } }]]);
    expect(
      needsRebuild(
        [update(DOC, { site: { b: 2, a: 1 } })],
        new Map([[DOC, buildTime(['site'])]]),
        stored,
      ),
    ).toBe(false);
  });

  it('treats * as the whole value', () => {
    const documents = new Map([[DOC, buildTime(['*'])]]);
    const stored = new Map([[DOC, { a: 1 }]]);
    expect(needsRebuild([update(DOC, { a: 1 })], documents, stored)).toBe(
      false,
    );
    expect(needsRebuild([update(DOC, { a: 2 })], documents, stored)).toBe(true);
  });

  it('is true when a document with build-time fields is deleted', () => {
    expect(
      needsRebuild(
        [{ document: DOC, baseRevision: 'r', deleted: true }],
        new Map([[DOC, buildTime(['*'])]]),
        new Map(),
      ),
    ).toBe(true);
  });

  it('is false for a deleted document with no build-time fields', () => {
    expect(
      needsRebuild(
        [{ document: DOC, baseRevision: 'r', deleted: true }],
        new Map([[DOC, buildTime([])]]),
        new Map(),
      ),
    ).toBe(false);
  });

  it('is false for a document with no list of build-time fields', () => {
    const stored = new Map([[DOC, { a: 1 }]]);
    expect(
      needsRebuild(
        [update(DOC, { a: 2 })],
        new Map([[DOC, buildTime(undefined)]]),
        stored,
      ),
    ).toBe(false);
  });

  it('is false for a create, which the bundle does not hold', () => {
    expect(
      needsRebuild(
        [
          {
            document: 'blog/new',
            baseRevision: null,
            deleted: false,
            data: {},
          },
        ],
        new Map(),
        new Map(),
      ),
    ).toBe(false);
  });

  it('does not read an inherited property as a build-time field', () => {
    const stored = new Map([[DOC, { a: 1 }]]);
    expect(
      needsRebuild(
        [update(DOC, { a: 1 })],
        new Map([[DOC, buildTime(['constructor', 'toString'])]]),
        stored,
      ),
    ).toBe(false);
  });
});
