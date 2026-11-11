import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';
import { type AppDeps, createApp } from './http/app.ts';

// Phase 2 has no auth (PHASE-2-DESIGN 5.1), so the server listens on loopback only.
// There is deliberately no host setting.
const HOST = '127.0.0.1';

interface FetchApp {
  fetch: (request: Request) => Response | Promise<Response>;
}

export function startServer(deps: AppDeps, port: number): Promise<Server> {
  const app: FetchApp = createApp(deps);
  // RFC 9112 section 3.2 says a server answers 400 to an HTTP/1.1 request with no Host, and Node does so before the app
  // sees it. requireHostHeader is off on purpose: the app's Host check answers such a request 421, as it does any other
  // Host the spec refuses (2.9f). This departs from RFC 9112 for this case.
  const server = createServer({ requireHostHeader: false }, (req, res) => {
    void handle(app, req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function handle(
  app: FetchApp,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const response = await app.fetch(toRequest(req));
    res.writeHead(response.status, [...response.headers].flat());
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}

// Builds a web Request from a Node request. The URL base is the fixed loopback
// address, never the Host header, so a client cannot change the origin the app sees.
// The body is streamed, not buffered: a route reads it through readBody (http/body.ts),
// which enforces its cap while the bytes arrive (2.7a gaps).
function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }
  // Node needs `duplex: 'half'` for a stream body; the DOM RequestInit type does not declare it.
  const init = {
    method,
    headers,
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    duplex: 'half',
  } as RequestInit;
  return new Request(url, init);
}
