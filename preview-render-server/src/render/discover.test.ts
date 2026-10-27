import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '../manifest/types.ts';
import { discoveredDocuments } from './discover.ts';

const built = ['blog/a', 'blog/b', 'authors/ana'].map((key) => ({ key, format: 'md', buildTime: false }) as DocumentRecord);

describe('discoveredDocuments', () => {
  it('keeps entry and data reads as they are', () => {
    expect(discoveredDocuments(['blog/a', 'data:src/config/menu.json'], built, {})).toEqual(['blog/a', 'data:src/config/menu.json']);
  });

  it('a collection read stands for its built documents and the overlay ones, not removed ones', () => {
    const overlay = { 'blog/b': null, 'blog/new': { data: {} }, 'authors/zed': {} };
    expect(discoveredDocuments(['blog'], built, overlay)).toEqual(['blog/a', 'blog/new']);
  });

  it('works without documents.json, lists each key once and sorts', () => {
    expect(discoveredDocuments(['blog', 'blog/new', 'blog'], undefined, { 'blog/new': {} })).toEqual(['blog/new']);
  });
});
