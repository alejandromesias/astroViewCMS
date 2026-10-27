// POST /__preview/render?path=<url path>: renders the page at that path with
// the request's content overlay (SYSTEM-DESIGN.md section 3). All logic is in
// render/handlers.ts.
import type { APIRoute } from 'astro';
import { handleRender } from './render/handlers.ts';
import { deps } from './render/runtime.ts';
import { methodNotAllowed } from './request-guard.ts';

export const prerender = false;

export const POST: APIRoute = ({ request }) => handleRender(request, deps);

/** Any other method. */
export const ALL: APIRoute = () => methodNotAllowed('POST');
