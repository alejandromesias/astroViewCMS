import { describe, expect, it } from 'vitest';
import { createPaginate } from './paginate.ts';

const rules = { base: '/', trailingSlash: 'ignore' as const };
const items = [1, 2, 3, 4, 5];

describe('paginate', () => {
  it('[...page]: page 1 has no number in its URL', () => {
    const pages = createPaginate({ pattern: '/tags/[tag]/[...page]' }, rules)(items, { pageSize: 2, params: { tag: 'a' } });
    expect(pages.map((p) => p.params)).toEqual([
      { tag: 'a', page: undefined },
      { tag: 'a', page: '2' },
      { tag: 'a', page: '3' },
    ]);
    expect(pages[0]!.props!.page).toMatchObject({
      data: [1, 2],
      start: 0,
      end: 1,
      size: 2,
      total: 5,
      currentPage: 1,
      lastPage: 3,
      url: { current: '/tags/a', next: '/tags/a/2', prev: undefined, first: undefined, last: '/tags/a/3' },
    });
    expect(pages[1]!.props!.page).toMatchObject({ url: { prev: '/tags/a', first: '/tags/a' } });
    expect(pages[2]!.props!.page).toMatchObject({ data: [5], end: 4, url: { next: undefined } });
  });

  it('[page]: every page has a number', () => {
    const pages = createPaginate({ pattern: '/blog/[page]' }, rules)(items, { pageSize: 3 });
    expect(pages.map((p) => p.params.page)).toEqual(['1', '2']);
    expect(pages[1]!.props!.page).toMatchObject({ url: { current: '/blog/2', prev: '/blog/1', first: '/blog/1' } });
  });

  it('passes extra props along and gives one empty page for no data', () => {
    const pages = createPaginate({ pattern: '/x/[...page]' }, rules)([], { props: { extra: true } });
    expect(pages).toHaveLength(1);
    expect(pages[0]!.props).toMatchObject({ extra: true, page: { data: [], total: 0, lastPage: 1 } });
  });

  it('refuses a route without a page parameter', () => {
    expect(() => createPaginate({ pattern: '/x/[tag]' }, rules)(items)).toThrow(/\[page\]/);
  });
});
