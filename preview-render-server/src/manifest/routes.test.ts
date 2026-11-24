import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { shapeRoutes } from './routes.ts';

const root = path.resolve('/work/site');
const sources: Record<string, string> = {
  [path.join(root, 'src/pages/blog/[...single].astro')]:
    'export async function getStaticPaths() { return []; }',
  [path.join(root, 'src/pages/[regular].astro')]:
    'export const getStaticPaths = () => [];',
  [path.join(root, 'src/pages/about.astro')]:
    'export function getStaticPaths() {}',
};
const read = (file: string) => sources[file];

const routes = shapeRoutes(
  [
    {
      pattern: '/about',
      entrypoint: 'src/pages/about.astro',
      type: 'page',
      params: [],
    },
    {
      pattern: '/blog/[...single]',
      entrypoint: 'src/pages/blog/[...single].astro',
      type: 'page',
      params: ['single'],
    },
    {
      pattern: '/[regular]',
      entrypoint: 'src/pages/[regular].astro',
      type: 'page',
      params: ['regular'],
    },
    {
      pattern: '/tags/[tag]/[...page]',
      entrypoint: 'src/pages/tags/[tag]/[...page].astro',
      type: 'page',
      params: ['tag', 'page'],
    },
    {
      pattern: '/rss.xml',
      entrypoint: 'src/pages/rss.xml.ts',
      type: 'endpoint',
      params: [],
    },
    {
      pattern: '/__editor',
      entrypoint: pathToFileURL(path.join(root, 'node_modules/x/editor.astro')),
      type: 'page',
      params: [],
    },
    {
      pattern: '/__preview/[region]',
      entrypoint: 'x.ts',
      type: 'endpoint',
      params: ['region'],
    },
  ],
  root,
  read,
);
const byPattern = (pattern: string) =>
  routes.find((r) => r.pattern === pattern)!;

describe('shapeRoutes', () => {
  it("leaves out the preview server's own routes", () => {
    expect(routes.some((r) => r.pattern.startsWith('/__'))).toBe(false);
  });

  it('gives the component relative to the site root, with forward slashes', () => {
    expect(byPattern('/blog/[...single]').component).toBe(
      'src/pages/blog/[...single].astro',
    );
  });

  it('marks dynamic routes and lists their parameters', () => {
    expect(byPattern('/about')).toMatchObject({
      dynamic: false,
      params: [],
      restParams: [],
    });
    expect(byPattern('/[regular]')).toMatchObject({
      dynamic: true,
      params: ['regular'],
      restParams: [],
    });
  });

  it('finds rest parameters (D10)', () => {
    expect(byPattern('/blog/[...single]').restParams).toEqual(['single']);
    expect(byPattern('/tags/[tag]/[...page]')).toMatchObject({
      params: ['tag', 'page'],
      restParams: ['page'],
    });
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
    expect(routes.map((r) => r.pattern)).toEqual(
      [...routes.map((r) => r.pattern)].sort((a, b) => a.localeCompare(b)),
    );
  });
});

const shapeOne = (
  type: string,
  source?: string,
  entrypoint: string | URL = 'src/pages/p/[x].astro',
  pattern = '/p/[x]',
) =>
  shapeRoutes(
    [{ pattern, entrypoint, type, params: ['x'] }],
    root,
    () => source,
  )[0];

describe('route type', () => {
  it.each(['page', 'endpoint', 'redirect', 'fallback'])('keeps %s', (type) => {
    expect(shapeOne(type)!.type).toBe(type);
  });

  it('falls back to page for an unknown type', () => {
    expect(shapeOne('something-else')!.type).toBe('page');
  });
});

describe('getStaticPaths detection', () => {
  it.each([
    'export function getStaticPaths() {}',
    'export async function getStaticPaths() {}',
    'export const getStaticPaths = () => [];',
    'export let getStaticPaths;',
    'x();\nexport   const   getStaticPaths = 1;',
  ])('finds %j', (source) => {
    expect(shapeOne('page', source)!.hasStaticPaths).toBe(true);
  });

  it.each([
    'function getStaticPaths() {}',
    'const getStaticPaths = 1;',
    'export function getStaticPathsLater() {}',
    'myexport function getStaticPaths() {}',
    'export var getStaticPaths = 1;',
    'export asyncfunction getStaticPaths() {}',
    'export function getStaticPath() {}',
    'exportfunction getStaticPaths() {}',
    'export functiongetStaticPaths() {}',
    'export async async function getStaticPaths() {}',
    '',
  ])('ignores %j', (source) => {
    expect(shapeOne('page', source)!.hasStaticPaths).toBe(false);
  });

  it('is false when the source is unavailable', () => {
    expect(shapeOne('page', undefined)!.hasStaticPaths).toBe(false);
  });
});

describe('route shaping details', () => {
  it('keeps routes that merely start with a single underscore or contain /__', () => {
    const kept = ['/_astro', '/a/__b'].map(
      (pattern) => shapeOne('page', '', 'a.astro', pattern)!.pattern,
    );
    expect(kept).toEqual(['/_astro', '/a/__b']);
  });

  it('accepts an absolute path entrypoint', () => {
    const file = path.join(root, 'src/pages/x.astro');
    expect(shapeOne('page', '', file)!.component).toBe('src/pages/x.astro');
  });

  it('accepts a file URL entrypoint', () => {
    const file = path.join(root, 'src/pages/u.astro');
    expect(shapeOne('page', '', pathToFileURL(file))!.component).toBe(
      'src/pages/u.astro',
    );
  });

  it('lists several rest parameters and ignores non-rest ones', () => {
    const route = shapeOne('page', '', 'a.astro', '/[...a]/x/[...b]/[c]');
    expect(route!.restParams).toEqual(['a', 'b']);
  });

  it('does not treat a malformed rest segment as a rest parameter', () => {
    expect(
      shapeOne('page', '', 'a.astro', '/[..a]/[.a]/[...]')!.restParams,
    ).toEqual([]);
  });

  it.each(['/[abcd]', '/...single]', '/[...single', '/[...-]'])(
    'finds no rest parameter in %s',
    (pattern) => {
      expect(shapeOne('page', '', 'a.astro', pattern)!.restParams).toEqual([]);
    },
  );

  it('gives forward slashes for a backslash entrypoint on every platform', () => {
    expect(shapeOne('page', '', 'src\\pages\\win.astro')!.component).toBe(
      'src/pages/win.astro',
    );
  });

  it('sorts all routes, not only a pair', () => {
    const sorted = shapeRoutes(
      ['/c', '/a', '/b'].map((pattern) => ({
        pattern,
        entrypoint: 'x.ts',
        type: 'page',
        params: [],
      })),
      root,
      () => undefined,
    );
    expect(sorted.map((r) => r.pattern)).toEqual(['/a', '/b', '/c']);
  });
});

describe('default source reader', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads the page from disk when it exists and treats a missing file as no source', () => {
    fs.mkdirSync(path.join(dir, 'pages'));
    fs.writeFileSync(
      path.join(dir, 'pages/[x].astro'),
      'export const getStaticPaths = () => [];',
    );
    const shape = (entrypoint: string) =>
      shapeRoutes(
        [{ pattern: '/[x]', entrypoint, type: 'page', params: ['x'] }],
        dir,
      )[0];
    expect(shape('pages/[x].astro')!.hasStaticPaths).toBe(true);
    expect(shape('pages/missing.astro')!.hasStaticPaths).toBe(false);
  });

  it('reads the page as UTF-8 from its absolute path', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-utf8-'));
    try {
      fs.writeFileSync(
        path.join(folder, 'page.astro'),
        'export const getStaticPaths = () => [];',
      );
      const spy = vi.spyOn(fs, 'readFileSync');
      shapeRoutes(
        [
          {
            pattern: '/[x]',
            entrypoint: 'page.astro',
            type: 'page',
            params: ['x'],
          },
        ],
        folder,
      );
      expect(spy).toHaveBeenCalledWith(
        path.resolve(folder, 'page.astro'),
        'utf8',
      );
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('shapeRoutes: survivors of the 2.13i run', () => {
  const page = (pattern: string, params: string[]) => ({
    pattern,
    entrypoint: 'src/pages/x.astro',
    type: 'page',
    params,
  });

  it('leaves out exactly /__ and anything under it, but keeps /_ and __ without a leading slash', () => {
    const shaped = shapeRoutes(
      [
        page('/__', []),
        page('/__/deep', []),
        page('/_one', []),
        page('__two', []),
      ],
      root,
      () => undefined,
    );
    expect(shaped.map((r) => r.pattern)).toEqual(['__two', '/_one']);
  });

  it('gives a static route dynamic false and hasStaticPaths false, even with getStaticPaths in its source', () => {
    const [shaped] = shapeRoutes(
      [page('/about', [])],
      root,
      () => 'export function getStaticPaths() {}',
    );
    expect(shaped!.dynamic).toBe(false);
    expect(shaped!.hasStaticPaths).toBe(false);
  });

  it('reads the source only for dynamic routes', () => {
    const readSource = vi.fn(() => 'export function getStaticPaths() {}');
    shapeRoutes(
      [page('/about', []), page('/[post]', ['post'])],
      root,
      readSource,
    );
    expect(readSource).toHaveBeenCalledTimes(1);
    expect(readSource).toHaveBeenCalledWith(
      path.resolve(root, 'src/pages/x.astro'),
    );
  });

  it('gives hasStaticPaths false for a dynamic route whose source is empty', () => {
    const [shaped] = shapeRoutes([page('/[post]', ['post'])], root, () => '');
    expect(shaped!.hasStaticPaths).toBe(false);
  });
});
