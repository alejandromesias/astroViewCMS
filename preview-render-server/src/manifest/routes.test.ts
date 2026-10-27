import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shapeRoutes } from './routes.ts';

const root = path.resolve('/work/site');
const sources: Record<string, string> = {
  [path.join(root, 'src/pages/blog/[...single].astro')]: 'export async function getStaticPaths() { return []; }',
  [path.join(root, 'src/pages/[regular].astro')]: 'export const getStaticPaths = () => [];',
  [path.join(root, 'src/pages/about.astro')]: 'export function getStaticPaths() {}',
};
const read = (file: string) => sources[file];

const routes = shapeRoutes(
  [
    { pattern: '/about', entrypoint: 'src/pages/about.astro', type: 'page', params: [] },
    { pattern: '/blog/[...single]', entrypoint: 'src/pages/blog/[...single].astro', type: 'page', params: ['single'] },
    { pattern: '/[regular]', entrypoint: 'src/pages/[regular].astro', type: 'page', params: ['regular'] },
    { pattern: '/tags/[tag]/[...page]', entrypoint: 'src/pages/tags/[tag]/[...page].astro', type: 'page', params: ['tag', 'page'] },
    { pattern: '/rss.xml', entrypoint: 'src/pages/rss.xml.ts', type: 'endpoint', params: [] },
    { pattern: '/__editor', entrypoint: pathToFileURL(path.join(root, 'node_modules/x/editor.astro')), type: 'page', params: [] },
    { pattern: '/__preview/[region]', entrypoint: 'x.ts', type: 'endpoint', params: ['region'] },
  ],
  root,
  read,
);
const byPattern = (pattern: string) => routes.find((r) => r.pattern === pattern)!;

describe('shapeRoutes', () => {
  it("leaves out the preview server's own routes", () => {
    expect(routes.some((r) => r.pattern.startsWith('/__'))).toBe(false);
  });

  it('gives the component relative to the site root, with forward slashes', () => {
    expect(byPattern('/blog/[...single]').component).toBe('src/pages/blog/[...single].astro');
  });

  it('marks dynamic routes and lists their parameters', () => {
    expect(byPattern('/about')).toMatchObject({ dynamic: false, params: [], restParams: [] });
    expect(byPattern('/[regular]')).toMatchObject({ dynamic: true, params: ['regular'], restParams: [] });
  });

  it('finds rest parameters (D10)', () => {
    expect(byPattern('/blog/[...single]').restParams).toEqual(['single']);
    expect(byPattern('/tags/[tag]/[...page]')).toMatchObject({ params: ['tag', 'page'], restParams: ['page'] });
  });

  it('detects getStaticPaths in dynamic routes, as function or const', () => {
    expect(byPattern('/blog/[...single]').hasStaticPaths).toBe(true);
    expect(byPattern('/[regular]').hasStaticPaths).toBe(true);
    expect(byPattern('/tags/[tag]/[...page]').hasStaticPaths).toBe(false); // source unavailable
  });

  it('does not report getStaticPaths for static routes', () => {
    expect(byPattern('/about').hasStaticPaths).toBe(false);
  });

  it('keeps the route type', () => {
    expect(byPattern('/rss.xml').type).toBe('endpoint');
    expect(byPattern('/about').type).toBe('page');
  });

  it('is sorted by pattern', () => {
    expect(routes.map((r) => r.pattern)).toEqual([...routes.map((r) => r.pattern)].sort((a, b) => a.localeCompare(b)));
  });
});
