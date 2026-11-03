// Shared checks for the routes that take a body (2.7a gaps; design 5.9). Same rules as
// preview-render-server/src/request-guard.ts, which stays as it is until the stopgap goes.

/** 403 for requests the browser marks cross-site (`Sec-Fetch-Site`), else null. Requests
 *  without the header (curl, older clients) pass. */
export function rejectCrossSite(request: Request): Response | null {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}

/** 404 unless the content type matches `pattern`, then the cross-site check. A cross-origin
 *  page cannot send an image or JSON body without a CORS preflight, which these routes never
 *  answer, so the content type alone keeps other sites out. 404 (not 415) makes the route
 *  look absent to anything else. */
export function rejectUnlessContentType(
  request: Request,
  pattern: RegExp,
): Response | null {
  const contentType = request.headers.get('content-type') ?? '';
  if (!pattern.test(contentType)) {
    return new Response('Not Found', { status: 404 });
  }
  return rejectCrossSite(request);
}
