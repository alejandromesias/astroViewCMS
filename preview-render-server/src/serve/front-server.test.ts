import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdapterHandler, createFrontServer } from './front-server.ts';
import type { Gate } from './gate.ts';

const CSP = "frame-ancestors 'self' http://cms.localhost:4400";
const OPEN: Gate = { allows: () => true };

let clientDir: string;
let server: Server | undefined;

beforeEach(() => {
  clientDir = mkdtempSync(path.join(os.tmpdir(), 'serve-front-'));
  writeFileSync(path.join(clientDir, 'index.html'), '<h1>home</h1>');
});

afterEach(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  rmSync(clientDir, { recursive: true, force: true });
});

// The adapter's routes stand-in: answers /api and passes everything else on.
const apiHandler: AdapterHandler = (req, res, next) => {
  if (req.url === '/api') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('from handler');
    return;
  }
  next();
};

async function start(
  overrides: { handler?: AdapterHandler; gate?: Gate } = {},
): Promise<string> {
  const started = createFrontServer({
    clientDir,
    handler: overrides.handler ?? apiHandler,
    csp: CSP,
    gate: overrides.gate ?? OPEN,
  });
  server = started;
  await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo = started.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe('createFrontServer', () => {
  it('sends the CSP header on static, handler and not-found responses alike', async () => {
    const base = await start();
    for (const target of ['/index.html', '/api', '/nothing-here']) {
      const response = await fetch(base + target);
      expect(response.headers.get('content-security-policy')).toBe(CSP);
    }
  });

  it('serves a static file before the adapter handler, which is not called', async () => {
    const handler = vi.fn<AdapterHandler>();
    const base = await start({ handler });
    const response = await fetch(`${base}/index.html`);
    expect(await response.text()).toBe('<h1>home</h1>');
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes other requests to the adapter handler', async () => {
    const handler = vi.fn<AdapterHandler>(apiHandler);
    const base = await start({ handler });
    const response = await fetch(`${base}/api`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('from handler');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('answers a plain 404 when the handler calls next', async () => {
    const base = await start();
    const response = await fetch(`${base}/nothing-here`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    );
    expect(await response.text()).toBe('Not Found');
  });

  it('answers 401 and calls nothing else when the gate refuses', async () => {
    const handler = vi.fn<AdapterHandler>(apiHandler);
    const base = await start({ handler, gate: { allows: () => false } });
    const response = await fetch(`${base}/index.html`);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized');
    expect(response.headers.get('content-security-policy')).toBe(CSP);
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers 500 and logs the error when the handler throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const base = await start({
      handler: () => {
        throw new Error('boom');
      },
    });
    const response = await fetch(`${base}/api`);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(log).toHaveBeenCalledWith(new Error('boom'));
  });

  it('ends a response the handler already started, without a second status line', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const base = await start({
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('partial');
        throw new Error('late');
      },
    });
    const response = await fetch(`${base}/api`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('partial');
    expect(log).toHaveBeenCalledWith(new Error('late'));
  });

  it('keeps the status of a response the handler started before it calls next', async () => {
    const base = await start({
      handler: (_req, res, next) => {
        res.writeHead(202, { 'content-type': 'text/plain' });
        res.write('started;');
        next();
      },
    });
    const response = await fetch(`${base}/api`);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('started;Not Found');
  });
});
