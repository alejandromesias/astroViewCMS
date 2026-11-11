import { once } from 'node:events';
import fs from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fakeAppDeps } from '../test/helpers/app-deps.ts';
import { makeTestRoot, removeTestRoot } from '../test/helpers/git.ts';
import { fetchLocal } from '../test/helpers/local-fetch.ts';
import { createApp } from './http/app.ts';
import { startServer } from './server.ts';

// createApp is a spy that calls the real one, so a test can hand the server a fake app for one call.
vi.mock('./http/app.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./http/app.ts')>();
  return { ...actual, createApp: vi.fn(actual.createApp) };
});

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
      const response = await fetchLocal(`http://127.0.0.1:${port}/nope`, {
        headers: { host: 'localhost' },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    } finally {
      await close(server);
    }
  });

  it('refuses a rebinding Host and a request with no Host with 421 over HTTP (2.9f)', async () => {
    const server = await startServer(fakeAppDeps(), 0);
    try {
      const { port } = server.address() as AddressInfo;
      const rebinding = await fetchLocal(
        `http://127.0.0.1:${port}/api/schema`,
        { headers: { host: 'localhost.evil.test' } },
      );
      expect(rebinding.status).toBe(421);
      expect(await rebinding.json()).toEqual({
        error: 'misdirected',
        message: 'The Host header is not an address of this CMS.',
      });
      // Node adds a Host header unless `setHost` is false, so this request has none on the wire.
      const noHost = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          const req = httpRequest(
            { host: '127.0.0.1', port, path: '/api/schema', setHost: false },
            (res) => {
              let body = '';
              res.setEncoding('utf8');
              res.on('data', (chunk: string) => {
                body += chunk;
              });
              res.on('end', () =>
                resolve({ status: res.statusCode ?? 0, body }),
              );
            },
          );
          req.on('error', reject);
          req.end();
        },
      );
      expect(noHost.status).toBe(421);
      expect(JSON.parse(noHost.body)).toEqual({
        error: 'misdirected',
        message: 'The Host header is not an address of this CMS.',
      });
    } finally {
      await close(server);
    }
  });

  it('reads a request body without failing, then answers the app response', async () => {
    const server = await startServer(fakeAppDeps(), 0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetchLocal(`http://127.0.0.1:${port}/nope`, {
        method: 'POST',
        headers: { host: 'localhost' },
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

// The bridge's own branches: the listen error path, the response copy, the 500 answer, and the Request
// built from the Node request (method, URL, headers, a repeated header). Each test gives the server a
// fake app for one call, so the bridge is what runs.
function fakeAppOnce(
  fetch: (request: Request) => Response | Promise<Response>,
): void {
  vi.mocked(createApp).mockReturnValueOnce({
    fetch,
  } as unknown as ReturnType<typeof createApp>);
}

describe('startServer: bridge edge cases', () => {
  it('rejects when the port is already in use, with its error code', async () => {
    const first = await startServer(fakeAppDeps(), 0);
    try {
      const { port } = first.address() as AddressInfo;
      await expect(startServer(fakeAppDeps(), port)).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await close(first);
    }
  });

  it('keeps no error listener once it is listening, so a later server error is not swallowed', async () => {
    const server = await startServer(fakeAppDeps(), 0);
    try {
      const later = new Error('later');
      expect(() => server.emit('error', later)).toThrow(later);
    } finally {
      await close(server);
    }
  });

  it('copies the status, headers and body of the app response', async () => {
    fakeAppOnce(
      () => new Response('ok', { status: 201, headers: { 'x-app': 'yes' } }),
    );
    const server = await startServer(fakeAppDeps(), 0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetchLocal(`http://127.0.0.1:${port}/x`, {
        headers: { host: 'localhost' },
      });
      expect(response.status).toBe(201);
      expect(response.headers.get('x-app')).toBe('yes');
      expect(await response.text()).toBe('ok');
    } finally {
      await close(server);
    }
  });

  it('answers a JSON 500 and logs the error when the app throws', async () => {
    const error = new Error('boom');
    fakeAppOnce(() => {
      throw error;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = await startServer(fakeAppDeps(), 0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetchLocal(`http://127.0.0.1:${port}/x`, {
        headers: { host: 'localhost' },
      });
      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.json()).toEqual({ error: 'internal_error' });
      expect(log).toHaveBeenCalledWith(error);
    } finally {
      log.mockRestore();
      await close(server);
    }
  });

  it('gives the app the method, the URL on the loopback base, and the headers of a GET', async () => {
    let seen: Request | undefined;
    fakeAppOnce((request) => {
      seen = request;
      return new Response('ok');
    });
    const server = await startServer(fakeAppDeps(), 0);
    try {
      const { port } = server.address() as AddressInfo;
      await fetchLocal(`http://127.0.0.1:${port}/a/b?q=1`, {
        headers: { host: 'localhost', 'x-test': 'yes' },
      });
      expect(seen?.method).toBe('GET');
      // The URL base is the fixed loopback address, never the Host header, and has no port.
      expect(seen?.url).toBe('http://127.0.0.1/a/b?q=1');
      expect(seen?.headers.get('x-test')).toBe('yes');
    } finally {
      await close(server);
    }
  });

  it('gives the app a HEAD request, which has no body to stream', async () => {
    let seenMethod: string | undefined;
    fakeAppOnce((request) => {
      seenMethod = request.method;
      return new Response(null, { status: 200 });
    });
    const server = await startServer(fakeAppDeps(), 0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetchLocal(`http://127.0.0.1:${port}/x`, {
        method: 'HEAD',
        headers: { host: 'localhost' },
      });
      expect(response.status).toBe(200);
      expect(seenMethod).toBe('HEAD');
    } finally {
      await close(server);
    }
  });

  it('passes every value of a repeated request header to the app, as separate values', async () => {
    let seen: string[] = [];
    fakeAppOnce((request) => {
      seen = request.headers.getSetCookie();
      return new Response('ok');
    });
    const server = await startServer(fakeAppDeps(), 0);
    try {
      const { port } = server.address() as AddressInfo;
      // An array-valued header is sent as one line per value.
      const req = httpRequest({
        host: '127.0.0.1',
        port,
        path: '/c',
        headers: { host: 'localhost', 'Set-Cookie': ['a=1', 'b=2'] },
      });
      req.end();
      const [res] = await once(req, 'response');
      res.resume();
      await once(res, 'end');
      expect(seen).toEqual(['a=1', 'b=2']);
    } finally {
      await close(server);
    }
  });
});

describe('startServer: uploads stream through the bridge', () => {
  it('stores a PNG upload and answers 201', async () => {
    const { root, server } = await uploadServer();
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetchLocal(`http://127.0.0.1:${port}/api/media`, {
        method: 'POST',
        headers: { host: 'localhost', 'content-type': 'image/png' },
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
      const outcome = await fetchLocal(`http://127.0.0.1:${port}/api/media`, {
        method: 'POST',
        headers: { host: 'localhost', 'content-type': 'image/png' },
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
      const response = await fetchLocal(`http://127.0.0.1:${port}/nope`, {
        headers: { host: 'localhost' },
      });
      expect(response.status).toBe(404);
    } finally {
      await close(server);
      await removeTestRoot(root);
    }
  });
});
