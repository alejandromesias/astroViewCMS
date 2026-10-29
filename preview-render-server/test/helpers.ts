import type { APIContext, APIRoute } from 'astro';

/** Calls an Astro API route handler with just the context fields ours use. */
export async function callRoute(
  handler: APIRoute,
  params: Record<string, string | undefined>,
  request: Request,
): Promise<Response> {
  return handler({ params, request } as unknown as APIContext);
}

export const BASE = 'http://localhost:4400';
