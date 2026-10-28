// Renders one page of the site for a URL path (SYSTEM-DESIGN.md section 3,
// WORKPLAN task 1.5): match the route, run the page's getStaticPaths to find
// its props, render with the Container. The caller has already put the
// request's overlay in place, so every read here sees the drafts. Written
// against small interfaces so tests can hand it fakes.
import type { RouteRecord } from '../manifest/types.ts';
import type { UrlRules } from './match-route.ts';
import { matchRoutes } from './match-route.ts';
import { createPaginate } from './paginate.ts';

type Params = Record<string, string | undefined>;

export interface StaticPath {
  params: Record<string, string | number | undefined>;
  props?: Record<string, unknown>;
}

export interface PageModule {
  default: unknown;
  getStaticPaths?: (args: {
    paginate: ReturnType<typeof createPaginate>;
  }) => StaticPath[] | Promise<StaticPath[]>;
}

export interface RenderPageDeps {
  routes: RouteRecord[];
  rules: UrlRules;
  /** The page's module, or undefined if the build has none for this route. */
  loadPage(route: RouteRecord): Promise<PageModule> | undefined;
  renderToString(
    component: unknown,
    options: {
      params: Params;
      props: Record<string, unknown>;
      request: Request;
      partial: false;
    },
  ): Promise<string>;
}

/** No page matches the path. */
export class NotFoundError extends Error {
  constructor(pathname: string) {
    super(`No page matches "${pathname}"`);
    this.name = 'NotFoundError';
  }
}

export interface RenderedPage {
  html: string;
  route: string;
  /** Milliseconds spent in getStaticPaths (D7) and in the render itself. */
  pathsMs: number;
  renderMs: number;
}

const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

export async function renderPage(
  deps: RenderPageDeps,
  url: URL,
): Promise<RenderedPage> {
  let pathsMs = 0;
  for (const { route, params } of matchRoutes(
    deps.routes,
    url.pathname,
    deps.rules,
  )) {
    const page = await deps.loadPage(route);
    if (!page) continue;

    let props: Record<string, unknown> = {};
    if (typeof page.getStaticPaths === 'function') {
      const started = performance.now();
      const paths = await page.getStaticPaths({
        paginate: createPaginate(route, deps.rules),
      });
      pathsMs += performance.now() - started;
      // A rename or a new draft shows up here: the overlay is already active.
      // routes.json lists a rest parameter as "...name"; the params object uses "name".
      const names = route.params.map((name) => name.replace(/^\.\.\./, ''));
      const found = paths.find((path) =>
        names.every((name) => same(path.params[name], params[name])),
      );
      if (!found) continue;
      props = found.props ?? {};
    }

    const started = performance.now();
    const html = await deps.renderToString(page.default, {
      params,
      props,
      request: new Request(url),
      partial: false,
    });
    return {
      html,
      route: route.pattern,
      pathsMs,
      renderMs: performance.now() - started,
    };
  }
  throw new NotFoundError(url.pathname);
}
