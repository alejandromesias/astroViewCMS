// The two ways an error answer leaves the HTTP layer: a Hono response for the routes, and a Fetch Response for the guards,
// which run before any route. Both take an ApiError from cms-contract, so only a code of its table reaches the wire.
import type { ApiError } from 'cms-contract';
import type { Context } from 'hono';

/** The Hono answer of an error: its body, with its status. */
export function errorJson(c: Context, error: ApiError): Response {
  return c.json(error.body, error.status);
}

/** The Fetch answer of an error, for the guards that return a Response. */
export function errorResponse(error: ApiError): Response {
  return Response.json(error.body, { status: error.status });
}
