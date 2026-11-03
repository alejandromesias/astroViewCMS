import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serveStatic } from './static.ts';

// Each test gets its own tree: <base>/client is the served folder, and
// <base>/secret.txt and <base>/client2/ sit next to it, where a traversal would land.
let base: string;
let clientDir: string;
let server: Server | undefined;

beforeEach(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'serve-static-'));
  clientDir = path.join(base, 'client');
  mkdirSync(path.join(clientDir, 'dir'), { recursive: true });
  mkdirSync(path.join(base, 'client2'));
  writeFileSync(path.join(clientDir, 'index.html'), '<h1>home</h1>');
  writeFileSync(path.join(clientDir, 'app.js'), 'run()');
  writeFileSync(path.join(clientDir, 'data.bin'), 'bytes');
  writeFileSync(path.join(clientDir, 'dir', 'index.html'), '<p>dir</p>');
  writeFileSync(path.join(base, 'secret.txt'), 'SECRET');
  writeFileSync(path.join(base, 'client2', 'x.txt'), 'SIBLING');
});

afterEach(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  rmSync(base, { recursive: true, force: true });
});

// Serves static files; anything else answers 418 "miss", so a fall-through is visible.
async function start(): Promise<{ port: number }> {
  const started = createServer((req, res) => {
    if (!serveStatic(clientDir, req, res)) {
      res.writeHead(418, { 'content-type': 'text/plain' });
      res.end('miss');
    }
  });
  server = started;
  await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo = started.address() as AddressInfo;
  return { port: address.port };
}

// Creates a link and returns true. Returns false when the OS refuses it (on Windows a
// file symlink needs developer mode or a privilege), so the test can skip. Other errors throw.
function tryLink(
  target: string,
  link: string,
  type: 'file' | 'junction',
): boolean {
  try {
    symlinkSync(target, link, type);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EEXIST') return false;
    throw error;
  }
}

// A raw request, so the path reaches the server as written (fetch would normalise `..`).
function send(
  port: number,
  target: string,
  method = 'GET',
): Promise<{
  status: number;
  type: string | undefined;
  length: string | undefined;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: target, method },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            type: res.headers['content-type'],
            length: res.headers['content-length'],
            body,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('serveStatic', () => {
  it('serves index.html for the root with its type and length', async () => {
    const { port } = await start();
    expect(await send(port, '/')).toEqual({
      status: 200,
      type: 'text/html; charset=utf-8',
      length: '13',
      body: '<h1>home</h1>',
    });
  });

  it('serves a script with the script type', async () => {
    const { port } = await start();
    expect(await send(port, '/app.js')).toEqual({
      status: 200,
      type: 'text/javascript; charset=utf-8',
      length: '5',
      body: 'run()',
    });
  });

  it('serves an unknown extension as a binary stream', async () => {
    const { port } = await start();
    expect((await send(port, '/data.bin')).type).toBe(
      'application/octet-stream',
    );
  });

  it.each(['/dir/', '/dir'])(
    'serves the index.html of the folder %s',
    async (target) => {
      const { port } = await start();
      expect(await send(port, target)).toEqual({
        status: 200,
        type: 'text/html; charset=utf-8',
        length: '10',
        body: '<p>dir</p>',
      });
    },
  );

  it('answers HEAD with the headers and no body', async () => {
    const { port } = await start();
    expect(await send(port, '/app.js', 'HEAD')).toEqual({
      status: 200,
      type: 'text/javascript; charset=utf-8',
      length: '5',
      body: '',
    });
  });

  it('lets a missing file fall through', async () => {
    const { port } = await start();
    expect(await send(port, '/missing.js')).toMatchObject({
      status: 418,
      body: 'miss',
    });
  });

  it('lets a POST to a file fall through, since only GET and HEAD are served', async () => {
    const { port } = await start();
    expect(await send(port, '/app.js', 'POST')).toMatchObject({
      status: 418,
      body: 'miss',
    });
  });

  // The encoded slash survives URL normalisation, so these reach the folder check and
  // decode to a file that exists outside the folder (or in a sibling named client2).
  it.each([
    '/..%2fsecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/..%2fclient2%2fx.txt',
  ])(
    'refuses %s, which decodes to a file outside the folder',
    async (target) => {
      const { port } = await start();
      expect(await send(port, target)).toMatchObject({
        status: 418,
        body: 'miss',
      });
    },
  );

  it.each(['/%E0%A4%A', '/app.js%00'])(
    'lets a malformed or NUL path %s fall through',
    async (target) => {
      const { port } = await start();
      expect(await send(port, target)).toMatchObject({
        status: 418,
        body: 'miss',
      });
    },
  );

  // Links are made inside each test. A file symlink is skipped where the OS refuses it.
  it('refuses a file symlink inside the folder that points outside it', async (ctx) => {
    if (
      !tryLink(
        path.join(base, 'secret.txt'),
        path.join(clientDir, 'leak.txt'),
        'file',
      )
    ) {
      ctx.skip();
    }
    const { port } = await start();
    expect(await send(port, '/leak.txt')).toMatchObject({
      status: 418,
      body: 'miss',
    });
  });

  it('serves a file symlink inside the folder that points to a file inside it', async (ctx) => {
    if (
      !tryLink(
        path.join(clientDir, 'app.js'),
        path.join(clientDir, 'alias.js'),
        'file',
      )
    ) {
      ctx.skip();
    }
    const { port } = await start();
    expect(await send(port, '/alias.js')).toEqual({
      status: 200,
      type: 'text/javascript; charset=utf-8',
      length: '5',
      body: 'run()',
    });
  });

  it('refuses a file under a folder junction that points outside the folder', async () => {
    // A directory junction needs no privilege on Windows, and is ignored elsewhere.
    symlinkSync(
      path.join(base, 'client2'),
      path.join(clientDir, 'out'),
      'junction',
    );
    const { port } = await start();
    expect(await send(port, '/out/x.txt')).toMatchObject({
      status: 418,
      body: 'miss',
    });
  });
});
