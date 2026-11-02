import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Gate } from './gate.ts';
import { serveStatic } from './static.ts';

// The adapter's handler in middleware mode (`handler` from the built entry).
// It calls `next` when no route matches.
export type AdapterHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => Promise<void> | void;

interface FrontServerOptions {
  readonly clientDir: string;
  readonly handler: AdapterHandler;
  readonly csp: string;
  readonly gate: Gate;
}

// Order per PHASE-2-DESIGN 5.7: the CSP header on every response, the gate, static
// files, then the adapter's routes.
export function createFrontServer(options: FrontServerOptions): Server {
  return createServer((req, res) => {
    void respond(options, req, res);
  });
}

async function respond(
  options: FrontServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader('Content-Security-Policy', options.csp);
  try {
    if (!options.gate.allows(req)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized');
      return;
    }
    if (serveStatic(options.clientDir, req, res)) return;
    await options.handler(req, res, () => notFound(res));
  } catch (error) {
    console.error(error);
    // A response the handler already started is ended as it is: a second status line would throw.
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
}

function notFound(res: ServerResponse): void {
  if (!res.headersSent) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  }
  res.end('Not Found');
}
