// Shared checks for the CMS routes (2.7a gaps, 2.9f; design 5.9). Same rules as
// preview-render-server/src/request-guard.ts, which stays as it is until the stopgap goes.

/** 403 for requests the browser marks cross-site (`Sec-Fetch-Site`), else null. Requests
 *  without the header (curl, older clients) pass. */
export function rejectCrossSite(request: Request): Response | null {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}

/** 421 Misdirected Request unless the Host header names this CMS: `localhost`, `127.0.0.1` or `[::1]`, or the host of
 *  `cmsOrigin` (origins.cms), each bare or with the CMS port. A DNS-rebinding page reaches the CMS under its own name,
 *  so the browser's `Sec-Fetch-Site` says same-origin and that check passes it. A missing Host is refused too.
 *  Null when the Host is allowed (2.9f). */
export function rejectUnlessHostAllowed(
  request: Request,
  cmsOrigin: string,
): Response | null {
  const { hostname, port } = new URL(cmsOrigin);
  const host = request.headers.get('host');
  const allowed = ['localhost', '127.0.0.1', '[::1]', hostname].some(
    (name) => host === name || (port !== '' && host === `${name}:${port}`),
  );
  if (allowed) return null;
  return Response.json(
    {
      error: 'misdirected',
      message: 'The Host header is not an address of this CMS.',
    },
    { status: 421 },
  );
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
