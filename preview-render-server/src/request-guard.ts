// Shared checks for the preview routes (copied in spirit from Tina's
// rejectIfUnsafe). Only the site's own pages may call them.

export function rejectCrossSite(request: Request): Response | null {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}

// A cross-origin page can't send these content types without a CORS
// preflight, and the preview routes never answer one.
export function rejectUnlessContentType(request: Request, pattern: RegExp): Response | null {
  const contentType = request.headers.get('content-type') ?? '';
  if (!pattern.test(contentType)) {
    return new Response('Not Found', { status: 404 });
  }
  return rejectCrossSite(request);
}

export function methodNotAllowed(allow: string): Response {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: allow } });
}
