import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { startServer } from './server.ts';

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('startServer', () => {
  it('listens on 127.0.0.1 on the requested port', async () => {
    const server = await startServer({}, 0);
    try {
      const address = server.address() as AddressInfo;
      expect(address).toEqual({
        address: '127.0.0.1',
        family: 'IPv4',
        port: address.port,
      });
      expect(address.port).toBeGreaterThan(0);
    } finally {
      await close(server);
    }
  });

  it('serves the app over HTTP, with a JSON 404 for unknown paths', async () => {
    const server = await startServer({}, 0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/nope`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    } finally {
      await close(server);
    }
  });

  it('reads a request body without failing, then answers the app response', async () => {
    const server = await startServer({}, 0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/nope`, {
        method: 'POST',
        body: 'x',
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    } finally {
      await close(server);
    }
  });
});
