import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createApp, type AppDeps } from './http/app.ts';

// Phase 2 has no auth (PHASE-2-DESIGN 5.1), so the server listens on loopback only.
// There is deliberately no host setting.
const HOST = '127.0.0.1';

interface FetchApp {
  fetch: (request: Request) => Response | Promise<Response>;
}

export function startServer(deps: AppDeps, port: number): Promise<Server> {
  const app: FetchApp = createApp(deps);
  const server = createServer((req, res) => {
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
    const response = await app.fetch(await toRequest(req));
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
async function toRequest(req: IncomingMessage): Promise<Request> {
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
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}
