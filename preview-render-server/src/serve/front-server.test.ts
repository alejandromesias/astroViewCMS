import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mintPreviewToken, verifyPreviewToken } from 'preview-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AdapterHandler, createFrontServer } from './front-server.ts';
import { createGate, type Gate } from './gate.ts';

const CSP = "frame-ancestors 'self' http://cms.localhost:4400";
const OPEN: Gate = { check: () => ({ action: 'allow' }) };
const DENY: Gate = { check: () => ({ action: 'deny' }) };

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

  it('answers 401 with no-store and calls nothing else when the gate denies', async () => {
    const handler = vi.fn<AdapterHandler>(apiHandler);
    const base = await start({ handler, gate: DENY });
    const response = await fetch(`${base}/index.html`);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe(CSP);
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers the gate redirect with 303, Location, Set-Cookie and no-store, and calls nothing else', async () => {
    const handler = vi.fn<AdapterHandler>(apiHandler);
    const base = await start({
      handler,
      gate: {
        check: () => ({
          action: 'redirect',
          location: '/index.html?x=1',
          setCookie: '__Host-preview=v; Path=/',
        }),
      },
    });
    const response = await fetch(`${base}/index.html`, { redirect: 'manual' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/index.html?x=1');
    expect(response.headers.get('set-cookie')).toBe('__Host-preview=v; Path=/');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe(CSP);
    expect(await response.text()).toBe('');
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

// The real gate (createGate with a fixed clock) over HTTP. redirect: 'manual' keeps the
// 303 visible instead of following it.
describe('the real gate over HTTP', () => {
  const NOW = 1_800_000_000;
  const SITE = 'sample-site';
  const TOKEN_SECRET = 'token-secret-for-the-front-server-tests';
  const INTERNAL_SECRET = 'internal-secret-for-the-front-server-tests';
  const TOKEN_TTL = 60;
  const COOKIE_TTL = 43200;
  const COOKIE_FLAGS =
    'HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=43200';

  function gated(): Gate {
    return createGate(
      {
        kind: 'gated',
        site: SITE,
        tokenSecret: TOKEN_SECRET,
        internalSecret: INTERNAL_SECRET,
      },
      { now: () => NOW },
    );
  }

  function tokenFor(
    overrides: { site?: string; now?: number; ttlSeconds?: number } = {},
  ): string {
    return mintPreviewToken({
      secret: TOKEN_SECRET,
      site: SITE,
      ttlSeconds: TOKEN_TTL,
      now: NOW,
      ...overrides,
    });
  }

  // The cookie the gate sets at NOW: the same token minted with the cookie lifetime.
  function cookieFor(): string {
    return `__Host-preview=${mintPreviewToken({ secret: TOKEN_SECRET, site: SITE, ttlSeconds: COOKIE_TTL, now: NOW })}`;
  }

  it('exchanges the token in the URL for the cookie and redirects without it', async () => {
    const base = await start({ gate: gated() });
    const response = await fetch(
      `${base}/index.html?x=1&preview_token=${tokenFor()}&y=%20z`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/index.html?x=1&y=%20z');
    expect(response.headers.get('set-cookie')).toBe(
      `${cookieFor()}; ${COOKIE_FLAGS}`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe(CSP);
  });

  it('gives a bare path when the token was the only parameter', async () => {
    const base = await start({ gate: gated() });
    const response = await fetch(
      `${base}/index.html?preview_token=${tokenFor()}`,
      { redirect: 'manual' },
    );
    expect(response.headers.get('location')).toBe('/index.html');
  });

  it('drops every preview_token and keeps the other parameters in order', async () => {
    const base = await start({ gate: gated() });
    const response = await fetch(
      `${base}/index.html?preview_token=${tokenFor()}&x=1&preview_token=${tokenFor({ ttlSeconds: 61 })}`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/index.html?x=1');
  });

  it('answers a HEAD exchange with the same redirect', async () => {
    const base = await start({ gate: gated() });
    const response = await fetch(
      `${base}/index.html?preview_token=${tokenFor()}`,
      { method: 'HEAD', redirect: 'manual' },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/index.html');
  });

  it('builds the Location from the path only: a protocol-relative target gives no host', async () => {
    const base = await start({ gate: gated() });
    const response = await fetch(
      `${base}//evil.example/index.html?preview_token=${tokenFor()}`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/index.html');
  });

  it('serves the page with the cookie and no token in the URL', async () => {
    const base = await start({ gate: gated() });
    const response = await fetch(`${base}/index.html`, {
      headers: { cookie: cookieFor() },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<h1>home</h1>');
  });

  it('answers 401 with no-store when there is neither a cookie nor a bearer', async () => {
    const base = await start({ gate: gated() });
    const response = await fetch(`${base}/index.html`);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('Unauthorized');
  });

  it.each([
    ['an expired', () => tokenFor({ now: NOW - 120 })],
    ['a token for another site', () => tokenFor({ site: 'other-site' })],
    [
      'a token signed with another secret',
      () =>
        mintPreviewToken({
          secret: 'another-secret-for-the-front-server-tests',
          site: SITE,
          ttlSeconds: TOKEN_TTL,
          now: NOW,
        }),
    ],
    [
      'an altered',
      () => {
        const token = tokenFor();
        return `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
      },
    ],
    ['an empty', () => ''],
  ])(
    'refuses %s token with 401, sets no cookie, and does not fall back to a valid cookie',
    async (_label, makeToken) => {
      const base = await start({ gate: gated() });
      const response = await fetch(
        `${base}/index.html?preview_token=${makeToken()}`,
        { headers: { cookie: cookieFor() }, redirect: 'manual' },
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it('does not treat a token in a POST as an exchange', async () => {
    const base = await start({ gate: gated() });
    const response = await fetch(
      `${base}/index.html?preview_token=${tokenFor()}`,
      { method: 'POST', redirect: 'manual' },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('lets the internal bearer through on every path, with no cookie', async () => {
    const base = await start({ gate: gated() });
    const headers = { authorization: `Bearer ${INTERNAL_SECRET}` };
    const api = await fetch(`${base}/api`, { headers });
    expect(api.status).toBe(200);
    expect(await api.text()).toBe('from handler');
    const page = await fetch(`${base}/index.html`, { headers });
    expect(await page.text()).toBe('<h1>home</h1>');
  });

  it.each([
    ['the token secret', `Bearer ${TOKEN_SECRET}`],
    ['a longer version of the internal secret', `Bearer ${INTERNAL_SECRET}x`],
    ['a bearer with no value', 'Bearer '],
  ])('refuses %s as a bearer, with 401', async (_label, authorization) => {
    const base = await start({ gate: gated() });
    const response = await fetch(`${base}/index.html`, {
      headers: { authorization },
    });
    expect(response.status).toBe(401);
  });

  it('verifies the cookie it sets as a token for this site, valid for the cookie lifetime', async () => {
    const base = await start({ gate: gated() });
    const response = await fetch(
      `${base}/index.html?preview_token=${tokenFor()}`,
      { redirect: 'manual' },
    );
    const value = (response.headers.get('set-cookie') ?? '').split(';')[0];
    expect(
      verifyPreviewToken((value ?? '').slice('__Host-preview='.length), {
        secret: TOKEN_SECRET,
        site: SITE,
        now: NOW,
      }),
    ).toEqual({ ok: true, exp: NOW + COOKIE_TTL });
  });
});
