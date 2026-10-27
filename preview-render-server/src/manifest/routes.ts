import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RouteRecord } from './types.ts';

/** The part of Astro's IntegrationResolvedRoute that the manifest uses. */
export interface ResolvedRouteInput {
  pattern: string;
  entrypoint: string | URL;
  type: string;
  params: string[];
}

const REST_PARAM = /\[\.\.\.(\w+)\]/g;
const STATIC_PATHS = /\bexport\s+(?:async\s+)?(?:function|const|let)\s+getStaticPaths\b/;

/** Shapes routes.json from the `astro:routes:resolved` hook data. The preview
 *  server's own routes (`/__…`) are left out. `readSource` returns a page's
 *  source (or undefined), so the shaping stays testable without files. */
export function shapeRoutes(
  routes: ResolvedRouteInput[],
  root: string,
  readSource: (file: string) => string | undefined = readIfExists,
): RouteRecord[] {
  return routes
    .filter((route) => !route.pattern.startsWith('/__'))
    .map((route) => {
      const absolute = route.entrypoint instanceof URL ? fileURLToPath(route.entrypoint) : path.resolve(root, route.entrypoint);
      const dynamic = route.params.length > 0;
      return {
        pattern: route.pattern,
        component: toPosix(path.relative(root, absolute)),
        type: routeType(route.type),
        dynamic,
        params: route.params,
        restParams: [...route.pattern.matchAll(REST_PARAM)].map((match) => match[1]),
        hasStaticPaths: dynamic && STATIC_PATHS.test(readSource(absolute) ?? ''),
      };
    })
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

function routeType(type: string): RouteRecord['type'] {
  return type === 'endpoint' || type === 'redirect' || type === 'fallback' ? type : 'page';
}

function readIfExists(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}
