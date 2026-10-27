// POST /__preview/<region> with the region's props as JSON; answers with the
// region's HTML, rendered in memory from the components compiled at build
// time. Same pattern as Tina's island route (@tinacms/astro, Apache-2.0),
// without the fetch-and-overlay step: the editor always sends complete data.
//
// Temporary: SYSTEM-DESIGN.md replaces this route with POST /__preview/render
// (page render with a content overlay, WORKPLAN task 1.5). There is no GET for
// saved props any more; saved content comes from the CMS app.
import path from 'node:path/posix';
import type { APIRoute, ImageMetadata } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { images, regions } from 'virtual:preview-site';
import { methodNotAllowed, rejectUnlessContentType } from './request-guard.ts';

export const prerender = false;

const IMAGE_PATH = /\.(png|jpe?g|webp|avif|gif)$/i;
// The container doesn't know the build's bundled scripts, so it writes
// dev-server references to component scripts (src="<abs path>.astro?astro&
// type=script..."). They'd 404 and leak local paths; the page has already
// loaded the real bundled scripts.
const SOURCE_SCRIPT_TAG = /<script\b[^>]*\bsrc="[^"]*\?astro&(?:amp;)?type=script[^"]*"[^>]*><\/script>/g;

// One container for the whole process; renders don't share state.
let containerPromise: Promise<AstroContainer> | undefined;

/**
 * POST /__preview/<region>: renders the region with the JSON body as its
 * props and answers with the HTML fragment (no page shell, no wrapper: the
 * bridge swaps it into the page's wrapper).
 *
 * Flow: guard the request, look up the region, parse the body, resolve image
 * paths, render with the Container API, strip dev-only script tags. Render
 * failures answer 500 with the error message, so the editor can show it.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const rejection = rejectUnlessContentType(request, /application\/json/);
  if (rejection) return rejection;

  const region = regions[params.region ?? ''];
  if (!region) {
    return new Response(`Unknown region "${params.region}"`, { status: 404 });
  }

  let props: unknown;
  try {
    props = await request.json();
  } catch {
    return new Response('Body must be JSON', { status: 400 });
  }

  const start = performance.now();
  try {
    // Created on the first render and reused after that.
    containerPromise ??= AstroContainer.create();
    const container = await containerPromise;
    const html = await container.renderToString(region.component, {
      props: resolveImages(props, region.contentDir, images) as Record<string, unknown>,
    });
    // Reported to the editor through the Server-Timing header.
    const ms = (performance.now() - start).toFixed(1);
    return new Response(stripSourceScripts(html), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Server-Timing': `render;dur=${ms}`,
      },
    });
  } catch (error) {
    console.error(`[preview] render of "${params.region}" failed:`, error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Region render failed: ${message}`, { status: 500 });
  }
};

/** Any other method. */
export const ALL: APIRoute = () => methodNotAllowed('POST');

/** Removes the dev-only `<script src="...astro?astro&type=script...">` tags the
 *  container writes for component scripts (see SOURCE_SCRIPT_TAG). */
export function stripSourceScripts(html: string): string {
  return html.replace(SOURCE_SCRIPT_TAG, '');
}

// Content JSON stores images as paths relative to the JSON file. Swap each one
// that names an image compiled into the build for its ImageMetadata, which is
// what `image()` fields give components on the real site. Other paths stay
// strings: uploaded drafts (/__preview-media/...) render as plain URLs.
export function resolveImages(
  value: unknown,
  contentDir: string,
  known: Record<string, ImageMetadata>,
): unknown {
  if (typeof value === 'string') {
    if (!IMAGE_PATH.test(value)) return value;
    return known[path.normalize(path.join(contentDir, value))] ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveImages(item, contentDir, known));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveImages(item, contentDir, known)]),
    );
  }
  return value;
}
