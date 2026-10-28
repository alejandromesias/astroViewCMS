// `paginate()` for getStaticPaths when a page is rendered outside Astro's build
// (same result shape as Astro's own, which is not a public export).
import type { RouteRecord } from '../manifest/types.ts';
import type { UrlRules } from './match-route.ts';
import { routeUrl } from './match-route.ts';

interface PaginateArgs {
  pageSize?: number;
  params?: Record<string, string | undefined>;
  props?: Record<string, unknown>;
}

export function createPaginate(
  route: Pick<RouteRecord, 'pattern'>,
  rules: UrlRules,
) {
  // The page number is always the parameter called `page`.
  const withRest = route.pattern.includes('[...page]');
  const withNumber = !withRest && route.pattern.includes('[page]');
  return function paginate<T>(data: T[], args: PaginateArgs = {}) {
    if (!withNumber && !withRest)
      throw new Error(
        'paginate() needs a [page] or [...page] parameter in the route',
      );
    const pageSize = args.pageSize || 10;
    const lastPage = Math.max(1, Math.ceil(data.length / pageSize));
    // `[...page]` leaves page 1 out of the URL; `[page]` writes it.
    const pageParam = (n: number) =>
      withNumber || n > 1 ? String(n) : undefined;
    const url = (n: number | undefined) =>
      n === undefined
        ? undefined
        : routeUrl(
            route.pattern,
            { ...args.params, page: pageParam(n) },
            rules,
          );

    return Array.from({ length: lastPage }, (_, index) => {
      const currentPage = index + 1;
      const start = (currentPage - 1) * pageSize;
      const end = Math.min(start + pageSize, data.length);
      return {
        params: { ...args.params, page: pageParam(currentPage) },
        props: {
          ...args.props,
          page: {
            data: data.slice(start, end),
            start,
            end: end - 1,
            size: pageSize,
            total: data.length,
            currentPage,
            lastPage,
            url: {
              current: url(currentPage),
              next: url(currentPage === lastPage ? undefined : currentPage + 1),
              prev: url(currentPage === 1 ? undefined : currentPage - 1),
              first: url(currentPage === 1 ? undefined : 1),
              last: url(currentPage === lastPage ? undefined : lastPage),
            },
          },
        },
      };
    });
  };
}
