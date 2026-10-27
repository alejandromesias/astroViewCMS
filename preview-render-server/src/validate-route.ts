// POST /__preview/validate: parses the overlay's documents with the site's
// schemas and renders nothing (SYSTEM-DESIGN.md D3). Read-only.
import type { APIRoute } from 'astro';
import { handleValidate } from './render/handlers.ts';
import { deps } from './render/runtime.ts';
import { methodNotAllowed } from './request-guard.ts';

export const prerender = false;

export const POST: APIRoute = ({ request }) => handleValidate(request, deps);

/** Any other method. */
export const ALL: APIRoute = () => methodNotAllowed('POST');
