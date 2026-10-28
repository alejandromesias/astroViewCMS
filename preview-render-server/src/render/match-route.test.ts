import { describe, expect, it } from 'vitest';
import type { RouteRecord } from '../manifest/types.ts';
import type { UrlRules } from './match-route.ts';
import { matchRoutes, pathSegments, routeUrl } from './match-route.ts';

const route = (
  pattern: string,
  type: RouteRecord['type'] = 'page',
): RouteRecord => ({
  pattern,
  component: `src/pages${pattern === '/' ? '/index' : pattern}.astro`,
  type,
  dynamic: pattern.includes('['),
  params: [...pattern.matchAll(/\[(\.\.\.\w+|\w+)\]/g)].map((m) => m[1]!),
  restParams: [],
  hasStaticPaths: false,
});

const routes = [
  route('/'),
  route('/[regular]'),
  route('/blog'),
  route('/blog/[...single]'),
  route('/blog/page/[slug]'),
  route('/tags/[tag]/[...page]'),
  route('/landing/[slug]'),
  route('/api/data', 'endpoint'),
];
const rules: UrlRules = { base: '/', trailingSlash: 'ignore' };
const match = (path: string, r: UrlRules = rules) =>
  matchRoutes(routes, path, r).map((m) => m.route.pattern);

describe('matchRoutes', () => {
  it('matches static routes, with or without a trailing slash', () => {
    expect(match('/')).toEqual(['/']);
    expect(match('/blog')[0]).toBe('/blog');
    expect(match('/blog/')[0]).toBe('/blog');
  });

  it('a static route beats a rest route, which beats nothing; orders the rest by specificity', () => {
    // `/blog` is the static page, an empty rest match and a `[regular]` match.
    expect(match('/blog')).toEqual([
      '/blog',
      '/blog/[...single]',
      '/[regular]',
    ]);
    expect(match('/blog/page/2')).toEqual([
      '/blog/page/[slug]',
      '/blog/[...single]',
    ]);
  });

  it('a rest parameter takes ids with slashes (D10)', () => {
    const [found] = matchRoutes(routes, '/blog/generated/post-001', rules);
    expect(found!.route.pattern).toBe('/blog/[...single]');
    expect(found!.params).toEqual({ single: 'generated/post-001' });
  });

  it('a rest parameter that matched nothing is undefined', () => {
    const [found] = matchRoutes(routes, '/tags/design', rules);
    expect(found!.route.pattern).toBe('/tags/[tag]/[...page]');
    expect(found!.params).toEqual({ tag: 'design', page: undefined });
    expect(matchRoutes(routes, '/tags/design/2', rules)[0]!.params).toEqual({
      tag: 'design',
      page: '2',
    });
  });

  it('decodes parameters', () => {
    expect(matchRoutes(routes, '/landing/caf%C3%A9', rules)[0]!.params).toEqual(
      { slug: 'café' },
    );
  });

  it('ignores endpoints and unknown paths', () => {
    expect(match('/api/data')).toEqual([]);
    expect(match('/nothing/here/at/all')).toEqual([]);
  });

  it('works under a base and refuses paths outside it', () => {
    const docs: UrlRules = { base: '/docs', trailingSlash: 'always' };
    expect(match('/docs/blog', docs)[0]).toBe('/blog');
    expect(match('/docs', docs)).toEqual(['/']);
    expect(match('/blog', docs)).toEqual([]);
  });

  it('matches a parameter inside a segment', () => {
    const mixed = [route('/post-[id]')];
    expect(matchRoutes(mixed, '/post-42', rules)[0]!.params).toEqual({
      id: '42',
    });
    expect(matchRoutes(mixed, '/page-42', rules)).toEqual([]);
  });
});

describe('pathSegments', () => {
  it('strips the base', () => {
    expect(pathSegments('/docs/a/b', '/docs/')).toEqual(['a', 'b']);
    expect(pathSegments('/other/a', '/docs')).toBeUndefined();
  });
});

describe('routeUrl', () => {
  it('fills parameters, drops a missing rest parameter, adds base and trailing slash', () => {
    expect(
      routeUrl('/tags/[tag]/[...page]', { tag: 'x', page: '2' }, rules),
    ).toBe('/tags/x/2');
    expect(routeUrl('/tags/[tag]/[...page]', { tag: 'x' }, rules)).toBe(
      '/tags/x',
    );
    expect(
      routeUrl(
        '/tags/[tag]',
        { tag: 'x' },
        { base: '/docs', trailingSlash: 'always' },
      ),
    ).toBe('/docs/tags/x/');
    expect(routeUrl('/', {}, { base: '/', trailingSlash: 'always' })).toBe('/');
  });
});
