import { describe, expect, it, vi } from 'vitest';
import type { RouteRecord } from '../manifest/types.ts';
import type { PageModule, RenderPageDeps } from './render-page.ts';
import { NotFoundError, renderPage } from './render-page.ts';

const route = (pattern: string, params: string[] = []): RouteRecord => ({
  pattern,
  component: `src/pages${pattern}.astro`,
  type: 'page',
  dynamic: params.length > 0,
  params,
  restParams: [],
  hasStaticPaths: false,
});

function setup(pages: Record<string, PageModule>, routes: RouteRecord[]) {
  const renderToString = vi.fn(
    async (component: unknown, _options?: unknown) =>
      `<html>${String(component)}</html>`,
  );
  const deps: RenderPageDeps = {
    routes,
    rules: { base: '/', trailingSlash: 'ignore' },
    loadPage: (r) =>
      pages[r.pattern] ? Promise.resolve(pages[r.pattern]!) : undefined,
    renderToString: renderToString as never,
  };
  return { deps, renderToString };
}

describe('renderPage', () => {
  it('renders a static page with the real request URL', async () => {
    const { deps, renderToString } = setup({ '/blog': { default: 'blog' } }, [
      route('/blog'),
    ]);
    const result = await renderPage(deps, new URL('http://x/blog'));
    expect(result.html).toBe('<html>blog</html>');
    expect(result.route).toBe('/blog');
    const options = renderToString.mock.calls[0]![1] as {
      request: Request;
      props: object;
      partial: boolean;
    };
    expect(options.request.url).toBe('http://x/blog');
    expect(options.props).toEqual({});
    expect(options.partial).toBe(false);
  });

  it('a dynamic page gets the props of the getStaticPaths entry with the same params', async () => {
    const getStaticPaths = vi.fn(async () => [
      { params: { slug: 'a' }, props: { n: 1 } },
      { params: { slug: 'b' }, props: { n: 2 } },
    ]);
    const { deps, renderToString } = setup(
      { '/p/[slug]': { default: 'p', getStaticPaths } },
      [route('/p/[slug]', ['slug'])],
    );
    const result = await renderPage(deps, new URL('http://x/p/b'));
    expect(renderToString.mock.calls[0]![1]).toMatchObject({
      params: { slug: 'b' },
      props: { n: 2 },
    });
    expect(result.pathsMs).toBeGreaterThanOrEqual(0);
    expect(getStaticPaths).toHaveBeenCalledWith({
      paginate: expect.any(Function),
    });
  });

  it('a slug the overlay introduced is found because getStaticPaths runs when asked', async () => {
    let slugs = ['a'];
    const page: PageModule = {
      default: 'p',
      getStaticPaths: () => slugs.map((slug) => ({ params: { slug } })),
    };
    const { deps } = setup({ '/p/[slug]': page }, [
      route('/p/[slug]', ['slug']),
    ]);
    await expect(
      renderPage(deps, new URL('http://x/p/new')),
    ).rejects.toBeInstanceOf(NotFoundError);
    slugs = ['a', 'new'];
    await expect(
      renderPage(deps, new URL('http://x/p/new')),
    ).resolves.toMatchObject({ route: '/p/[slug]' });
  });

  it('compares the rest parameter "...single" of routes.json with the params object', async () => {
    const page: PageModule = {
      default: 'p',
      getStaticPaths: () => [
        { params: { single: 'a' }, props: { id: 'a' } },
        { params: { single: 'generated/b' }, props: { id: 'b' } },
      ],
    };
    const { deps, renderToString } = setup({ '/blog/[...single]': page }, [
      route('/blog/[...single]', ['...single']),
    ]);
    await renderPage(deps, new URL('http://x/blog/generated/b'));
    expect(renderToString.mock.calls[0]![1]).toMatchObject({
      props: { id: 'b' },
    });
  });

  it('page 1 of [...page] matches an entry whose page param is undefined', async () => {
    const page: PageModule = {
      default: 'p',
      getStaticPaths: ({ paginate }) =>
        paginate([1, 2, 3], { pageSize: 2, params: { tag: 't' } }),
    };
    const { deps, renderToString } = setup({ '/t/[tag]/[...page]': page }, [
      route('/t/[tag]/[...page]', ['tag', '...page']),
    ]);
    await renderPage(deps, new URL('http://x/t/t'));
    await renderPage(deps, new URL('http://x/t/t/2'));
    const pageProp = (call: number) =>
      (
        renderToString.mock.calls[call]![1] as {
          props: { page: { currentPage: number } };
        }
      ).props.page;
    expect(pageProp(0).currentPage).toBe(1);
    expect(pageProp(1).currentPage).toBe(2);
  });

  it('falls through to the next route when the first has no such page', async () => {
    const pages = {
      '/blog/page/[slug]': {
        default: 'paged',
        getStaticPaths: () => [{ params: { slug: '2' } }],
      },
      '/blog/[...single]': {
        default: 'single',
        getStaticPaths: () => [{ params: { single: 'page/9' } }],
      },
    };
    const routes = [
      route('/blog/page/[slug]', ['slug']),
      route('/blog/[...single]', ['...single']),
    ];
    const { deps } = setup(pages, routes);
    expect(
      (await renderPage(deps, new URL('http://x/blog/page/2'))).route,
    ).toBe('/blog/page/[slug]');
    expect(
      (await renderPage(deps, new URL('http://x/blog/page/9'))).route,
    ).toBe('/blog/[...single]');
    await expect(
      renderPage(deps, new URL('http://x/blog/page/5')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is not found when no route matches or the build has no module for it', async () => {
    const { deps } = setup({}, [route('/blog')]);
    await expect(renderPage(deps, new URL('http://x/blog'))).rejects.toThrow(
      'No page matches "/blog"',
    );
    await expect(
      renderPage(deps, new URL('http://x/other')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('errors from the page propagate', async () => {
    const { deps, renderToString } = setup({ '/a': { default: 'a' } }, [
      route('/a'),
    ]);
    renderToString.mockRejectedValueOnce(new Error('boom'));
    await expect(renderPage(deps, new URL('http://x/a'))).rejects.toThrow(
      'boom',
    );
  });
});
