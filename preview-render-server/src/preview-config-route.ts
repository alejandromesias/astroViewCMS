// GET /__preview/config: the editor origins (see preview-config.ts). Read from
// process.env on every request, so the node answers the value it runs with.
import type { APIRoute } from 'astro';
import { methodNotAllowed } from './request-guard.ts';
import { previewConfigResponse } from './preview-config.ts';

export const prerender = false;

export const GET: APIRoute = () => previewConfigResponse(process.env);

/** Any other method. */
export const ALL: APIRoute = () => methodNotAllowed('GET');
