// POST /__preview/<island> with the island's props as JSON; answers with the
// island's HTML, rendered in memory from the components compiled at build
// time. Same pattern as Tina's island route (@tinacms/astro, Apache-2.0),
// without the fetch-and-overlay step: the editor always sends complete data.
//
// GET /__preview/<island> returns the island's saved props, read from the
// site's content file on each request, so the editor starts from what's saved.
import fs from 'node:fs/promises';
import path from 'node:path/posix';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { images, islands } from 'virtual:preview-islands';
import { methodNotAllowed, rejectCrossSite, rejectUnlessContentType } from './request-guard.js';

export const prerender = false;

const IMAGE_PATH = /\.(png|jpe?g|webp|avif|gif)$/i;
// The container doesn't know the build's bundled scripts, so it writes
// dev-server references to component scripts (src="<abs path>.astro?astro&
// type=script..."). They'd 404 and leak local paths; the page has already
// loaded the real bundled scripts.
const SOURCE_SCRIPT_TAG = /<script\b[^>]*\bsrc="[^"]*\?astro&(?:amp;)?type=script[^"]*"[^>]*><\/script>/g;

// One container for the whole process; renders don't share state.
let containerPromise;

export async function GET({ params, request }) {
  const rejection = rejectCrossSite(request);
  if (rejection) return rejection;

  const island = islands[params.island];
  if (!island?.contentFile) {
    return new Response(`No saved content for island "${params.island}"`, { status: 404 });
  }

  const content = JSON.parse(await fs.readFile(island.contentFile, 'utf8'));
  const props = Object.fromEntries(island.contentProps.map((key) => [key, content[key]]));
  return Response.json(props, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST({ params, request }) {
  const rejection = rejectUnlessContentType(request, /application\/json/);
  if (rejection) return rejection;

  const island = islands[params.island];
  if (!island) {
    return new Response(`Unknown island "${params.island}"`, { status: 404 });
  }

  let props;
  try {
    props = await request.json();
  } catch {
    return new Response('Body must be JSON', { status: 400 });
  }

  const start = performance.now();
  try {
    containerPromise ??= AstroContainer.create();
    const container = await containerPromise;
    const html = await container.renderToString(island.component, {
      props: resolveImages(props, island.contentDir),
    });
    const ms = (performance.now() - start).toFixed(1);
    return new Response(html.replace(SOURCE_SCRIPT_TAG, ''), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Server-Timing': `render;dur=${ms}`,
      },
    });
  } catch (error) {
    console.error(`[preview] render of "${params.island}" failed:`, error);
    return new Response(`Island render failed: ${error?.message ?? error}`, { status: 500 });
  }
}

export function ALL() {
  return methodNotAllowed('GET, POST');
}

// Content JSON stores images as paths relative to the JSON file. Swap each one
// that names an image compiled into the build for its ImageMetadata, which is
// what `image()` fields give components on the real site. Other paths stay
// strings: uploaded drafts (/__preview-media/...) render as plain URLs.
function resolveImages(value, contentDir) {
  if (typeof value === 'string') {
    if (!IMAGE_PATH.test(value)) return value;
    return images[path.normalize(path.join(contentDir, value))] ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveImages(item, contentDir));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveImages(item, contentDir)]),
    );
  }
  return value;
}
