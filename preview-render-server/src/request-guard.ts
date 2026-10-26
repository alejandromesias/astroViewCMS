// Shared checks for the preview routes (copied in spirit from Tina's
// rejectIfUnsafe). Only the site's own pages may call them.

/** 403 for requests the browser marks cross-site (`Sec-Fetch-Site`), else null.
 *  Requests without the header (curl, older clients) pass: the header is
 *  extra protection, the content-type check below is the main one. */
export function rejectCrossSite(request: Request): Response | null {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}

/** Guard for the routes that take a body: 404 unless the content type matches
 *  `pattern`, then the cross-site check. A cross-origin page can't send JSON or
 *  image bodies without a CORS preflight, and the preview routes never answer
 *  one, so the content-type check alone keeps other sites out. 404 (not 415)
 *  so the route looks absent to anything else. */
export function rejectUnlessContentType(request: Request, pattern: RegExp): Response | null {
  const contentType = request.headers.get('content-type') ?? '';
  if (!pattern.test(contentType)) {
    return new Response('Not Found', { status: 404 });
  }
  return rejectCrossSite(request);
}

/** 405 listing the methods a route does accept. */
export function methodNotAllowed(allow: string): Response {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: allow } });
}
