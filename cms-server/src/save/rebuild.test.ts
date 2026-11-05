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

  it('is true when a listed field is added or removed', () => {
    const documents = new Map([[DOC, buildTime(['site.base_url'])]]);
    expect(
      needsRebuild(
        [update(DOC, { site: { base_url: '/b' } })],
        documents,
        new Map([[DOC, {}]]),
      ),
    ).toBe(true);
    expect(
      needsRebuild(
        [update(DOC, {})],
        documents,
        new Map([[DOC, { site: { base_url: '/a' } }]]),
      ),
    ).toBe(true);
  });

  it('is false when a listed field is missing on both sides', () => {
    expect(
      needsRebuild(
        [update(DOC, { site: {} })],
        new Map([[DOC, buildTime(['site.base_url'])]]),
        new Map([[DOC, { site: {} }]]),
      ),
    ).toBe(false);
  });

  it('reads nothing past a value that is not a plain object', () => {
    const stored = new Map([[DOC, { site: null, title: 'abc', items: ['a'] }]]);
    expect(
      needsRebuild(
        [update(DOC, { site: null, title: 'abcd', items: ['b'] })],
        new Map([
          [DOC, buildTime(['site.base_url', 'title.length', 'items.0'])],
        ]),
        stored,
      ),
    ).toBe(false);
    // No stored value at all, as for an update whose file could not be read.
    expect(
      needsRebuild(
        [update(DOC, { site: null })],
        new Map([[DOC, buildTime(['site.base_url'])]]),
        new Map(),
      ),
    ).toBe(false);
  });

  it('reads an own key named __proto__ as a value', () => {
    // JSON.parse makes __proto__ an own key, so the field is read rather than the prototype.
    expect(
      needsRebuild(
        [update(DOC, JSON.parse('{"__proto__": {}}'))],
        new Map([[DOC, buildTime(['__proto__'])]]),
        new Map([[DOC, {}]]),
      ),
    ).toBe(true);
  });
});
