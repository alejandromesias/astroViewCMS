import { once } from 'node:events';
import fs from 'node:fs';
import type { Server } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeAppDeps } from '../test/helpers/app-deps.ts';
import { makeTestRoot, removeTestRoot } from '../test/helpers/git.ts';
import { startServer } from './server.ts';

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // A refused upload can leave its connection open while the client is still sending.
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('startServer', () => {
  it('listens on 127.0.0.1 on the requested port', async () => {
    const server = await startServer(fakeAppDeps(), 0);
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
    const server = await startServer(fakeAppDeps(), 0);
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
    const server = await startServer(fakeAppDeps(), 0);
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

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// Uploads go through the streaming bridge (2.7a): a real staging folder, one per test.
async function uploadServer() {
  const root = await makeTestRoot();
  const stagingDir = path.join(root, 'staging');
  const deps = {
    ...fakeAppDeps(),
    media: {
      stagingDir,
      mediaFile: path.join(root, 'media.json'),
      cmsOrigin: 'http://cms.localhost:4400',
    },
  };
  return { root, stagingDir, server: await startServer(deps, 0) };
}

describe('startServer: uploads stream through the bridge', () => {
  it('stores a PNG upload and answers 201', async () => {
    const { root, server } = await uploadServer();
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/api/media`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: PNG,
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        width: 1,
        height: 1,
        format: 'png',
      });
    } finally {
      await close(server);
      await removeTestRoot(root);
    }
  });

  it('refuses a body over the cap that has no Content-Length, with 413 or a reset, and stores nothing', async () => {
    const { root, stagingDir, server } = await uploadServer();
    try {
      const { port } = server.address() as AddressInfo;
      const chunk = new Uint8Array(1024 * 1024);
      let sent = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (sent === 11) {
              controller.close();
              return;
            }
            sent += 1;
            controller.enqueue(chunk);
          },
        },
        { highWaterMark: 0 },
      );
      const outcome = await fetch(`http://127.0.0.1:${port}/api/media`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body,
        duplex: 'half',
      } as RequestInit).then(
        (response) => response.status,
        () => 'reset',
      );
      // Whether the client reads the early 413 or the server resets the connection first.
      expect([413, 'reset']).toContain(outcome);
      expect(fs.existsSync(stagingDir)).toBe(false);
    } finally {
      await close(server);
      await removeTestRoot(root);
    }
  });

  it('stores nothing when the client disconnects mid-upload, and keeps serving', async () => {
    const { root, stagingDir, server } = await uploadServer();
    try {
      const { port } = server.address() as AddressInfo;
      const socket = net.connect(port, '127.0.0.1');
      await once(socket, 'connect');
      await new Promise<void>((resolve) =>
        socket.write(
          'POST /api/media HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: image/png\r\nContent-Length: 1000\r\n\r\npartial',
          () => resolve(),
        ),
      );
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fs.existsSync(stagingDir)).toBe(false);
      const response = await fetch(`http://127.0.0.1:${port}/nope`);
      expect(response.status).toBe(404);
    } finally {
      await close(server);
      await removeTestRoot(root);
    }
  });
});
