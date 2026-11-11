import { request } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

// fetch sends the URL's own host and port as Host, and the CMS refuses a Host whose port is not its own (http/guard.ts).
// A test server listens on a free port, so this request names `localhost` unless `init` sets a `host` header. node:http
// sends a Host header as given, which fetch does not. Returns a Response, as fetch does.
export function fetchLocal(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const target = new URL(url);
  const headers = new Headers(init.headers);
  if (!headers.has('host')) headers.set('host', 'localhost');
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const out = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            for (const item of [value].flat()) {
              if (item !== undefined) out.append(name, item);
            }
          }
          resolve(
            new Response(body.length === 0 ? null : body, {
              status: res.statusCode ?? 0,
              headers: out,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    if (init.body instanceof ReadableStream)
      Readable.fromWeb(init.body as NodeReadableStream).pipe(req);
    else
      req.end(
        init.body == null ? undefined : (init.body as string | Uint8Array),
      );
  });
}
