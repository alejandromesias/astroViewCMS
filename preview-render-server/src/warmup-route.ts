// POST /__preview/warm: the editor calls it when an editing session starts,
// together with loading the document. It builds the Markdown renderer and
// loads the allowed code languages (about a second and 90 MB at most), so the
// first draft render, after the first keystroke, is fast. Nodes that only
// serve static pages never pay for it. Answers 204 when done; calling it again
// is free.
import type { APIRoute } from 'astro';
import { markdown } from './overlay/markdown-instance.ts';
import { methodNotAllowed, rejectCrossSite } from './request-guard.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const rejection = rejectCrossSite(request);
  if (rejection) return rejection;
  await markdown.warmUp();
  return new Response(null, { status: 204 });
};

/** Any other method. */
export const ALL: APIRoute = () => methodNotAllowed('POST');
