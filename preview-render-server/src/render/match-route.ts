// Finds the page route for a URL path (SYSTEM-DESIGN.md section 3, task 1.5)
// from the routes.json manifest. Mirrors Astro's rules closely enough for
// previews: static segments beat parameters, parameters beat rest parameters,
// and the request may or may not end in a slash.
import type { RouteRecord } from '../manifest/types.ts';

export interface RouteMatch {
  route: RouteRecord;
  /** Parameter values; a rest parameter that matched nothing is `undefined`. */
  params: Record<string, string | undefined>;
}

export interface UrlRules {
  /** The site's `base`, e.g. `/` or `/docs`. */
  base: string;
  trailingSlash: 'always' | 'never' | 'ignore';
}

interface Segment {
  /** Source text of the segment, e.g. `blog`, `[slug]`, `[...rest]`, `post-[id]`. */
  text: string;
  rest?: string;
  regex?: RegExp;
  names: string[];
  /** 3 static, 2 parameter, 1 rest. */
  rank: number;
}

/** Rank of "no more segments", above every segment kind. */
const END = 4;

function parseSegment(text: string): Segment {
  const rest = /^\[\.\.\.(\w+)\]$/.exec(text);
  if (rest) return { text, rest: rest[1]!, names: [rest[1]!], rank: 1 };
  const names: string[] = [];
  const source = text.split(/(\[\w+\])/).map((part) => {
    const param = /^\[(\w+)\]$/.exec(part);
    if (!param) return part.replace(/[.*+?^${}()|\\]/g, '\\$&');
    names.push(param[1]!);
    return '(.+)';
  });
  return names.length === 0 ? { text, names, rank: 3 } : { text, regex: new RegExp(`^${source.join('')}$`), names, rank: 2 };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The URL path without `base`, as segments; undefined if outside `base`. */
export function pathSegments(pathname: string, base: string): string[] | undefined {
  const baseSegments = base.split('/').filter(Boolean);
  const segments = pathname.split('/').filter(Boolean);
  for (let i = 0; i < baseSegments.length; i++) if (segments[i] !== baseSegments[i]) return undefined;
  return segments.slice(baseSegments.length).map(safeDecode);
}

function matchSegments(
  routeSegments: Segment[],
  segments: string[],
  params: Record<string, string | undefined>,
): Record<string, string | undefined> | undefined {
  const [head, ...tail] = routeSegments;
  if (!head) return segments.length === 0 ? params : undefined;
  if (head.rest) {
    // Longest match first, down to none.
    for (let take = segments.length; take >= 0; take--) {
      const found = matchSegments(tail, segments.slice(take), {
        ...params,
        [head.rest]: take === 0 ? undefined : segments.slice(0, take).join('/'),
      });
      if (found) return found;
    }
    return undefined;
  }
  if (segments.length === 0) return undefined;
  const [first, ...others] = segments;
  if (!head.regex) return head.text === first ? matchSegments(tail, others, params) : undefined;
  const match = head.regex.exec(first!);
  if (!match) return undefined;
  const values = Object.fromEntries(head.names.map((name, i) => [name, match[i + 1]]));
  return matchSegments(tail, others, { ...params, ...values });
}

/** Every page route that matches `pathname`, most specific first. A route
 *  can match and still have no such page (its getStaticPaths lacks the
 *  params), so the caller tries them in order. */
export function matchRoutes(routes: RouteRecord[], pathname: string, rules: UrlRules): RouteMatch[] {
  const segments = pathSegments(pathname, rules.base);
  if (!segments) return [];
  const found: Array<RouteMatch & { ranks: number[] }> = [];
  for (const route of routes) {
    if (route.type !== 'page') continue;
    const routeSegments = route.pattern.split('/').filter(Boolean).map(parseSegment);
    const params = matchSegments(routeSegments, segments, {});
    if (params) found.push({ route, params, ranks: routeSegments.map((s) => s.rank) });
  }
  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
      // A route that ends here beats one that goes on (`/blog` before `/blog/[...x]`).
      const diff = (b.ranks[i] ?? END) - (a.ranks[i] ?? END);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  return found.map(({ route, params }) => ({ route, params }));
}

/** The URL of a route for given params, with `base` and the trailing slash
 *  rule applied. A missing rest parameter drops its segment. */
export function routeUrl(pattern: string, params: Record<string, string | undefined>, rules: UrlRules): string {
  const segments = pattern
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/\[(?:\.\.\.)?(\w+)\]/g, (_, name: string) => params[name] ?? ''))
    .filter(Boolean);
  const base = rules.base.split('/').filter(Boolean);
  const path = '/' + [...base, ...segments].join('/');
  return rules.trailingSlash === 'always' && path !== '/' ? path + '/' : path;
}
