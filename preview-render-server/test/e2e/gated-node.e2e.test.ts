// End-to-end proof of the gate (PHASE-2-DESIGN 5.7, WORKPLAN 2.8e): a second node,
// started by hand from the already built sample site (no rebuild) with the
// secrets set, so the gate is on. The global-setup node stays open (PREVIEW_INSECURE).
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { mintPreviewToken, verifyPreviewToken } from 'preview-contract';
import { PROTOCOL_VERSION } from 'preview-protocol';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  type BuiltNode,
  childEnv,
  SERVER_DIR,
  startBuiltNode,
} from '../support/preview-server.ts';
import { readJson } from './client.ts';

const OUT = path.join(inject('buildDir'), 'sample-site');
// The bundle's own identity, which GET /__preview/config must answer (WORKPLAN 2.9b).
const bundleOfOut = JSON.parse(
  fs.readFileSync(path.join(OUT, 'manifest', 'bundle.json'), 'utf8'),
) as { bundleId: string };
const SITE_ID = 'sample-site';
const TOKEN_SECRET = 'e2e-token-secret-0123456789abcdefghij';
const INTERNAL_SECRET = 'e2e-internal-secret-0123456789ABCDEF';
const EDITOR_ORIGINS = 'https://editor.example http://localhost:3000';
const CSP =
  "frame-ancestors 'self' https://editor.example http://localhost:3000";
const GATED_ENV = {
  PREVIEW_TOKEN_SECRET: TOKEN_SECRET,
  PREVIEW_INTERNAL_SECRET: INTERNAL_SECRET,
  PREVIEW_SITE: SITE_ID,
  PREVIEW_EDITOR_ORIGINS: EDITOR_ORIGINS,
};

let node: BuiltNode | undefined;
let base = '';

beforeAll(async () => {
  node = await startBuiltNode(OUT, GATED_ENV);
  base = node.baseUrl;
}, 60_000);

afterAll(async () => {
  await node?.stop();
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A fetch against the gated node that does not follow redirects (the 303 is the answer). */
const get = (route: string, init: RequestInit = {}) =>
  fetch(`${base}${route}`, { redirect: 'manual', ...init });

const tokenFor = (
  overrides: { now?: number; site?: string; secret?: string } = {},
) =>
  mintPreviewToken({
    secret: overrides.secret ?? TOKEN_SECRET,
    site: overrides.site ?? SITE_ID,
    ttlSeconds: 60,
    now: overrides.now ?? nowSeconds(),
  });

/** The `__Host-preview=<value>` pair from a real token exchange. */
async function exchangeForCookie(): Promise<string> {
  const response = await get(`/faq?preview_token=${tokenFor()}`);
  const setCookie = response.headers.get('set-cookie') ?? '';
  const pair = /^(__Host-preview=[^;]+);/.exec(setCookie)?.[1];
  if (pair === undefined) throw new Error(`no cookie in ${setCookie}`);
  return pair;
}

/** The first file in the built `_astro` folder, as a URL path. */
function firstAssetPath(): string {
  const [file] = fs.readdirSync(path.join(OUT, 'client', '_astro'));
  return `/_astro/${file}`;
}

describe('the gated node', () => {
  it('sends the frame-ancestors header on a prerendered page served with the cookie', async () => {
    const response = await get('/faq', {
      headers: { cookie: await exchangeForCookie() },
    });
    expect({
      status: response.status,
      csp: response.headers.get('content-security-policy'),
    }).toEqual({ status: 200, csp: CSP });
  });

  it.each([
    ['a prerendered page', () => '/faq'],
    ['an asset under /_astro/', firstAssetPath],
    ['the config route', () => '/__preview/config'],
  ])(
    'answers %s without the cookie with 401, no-store and the header',
    async (_label, route) => {
      const response = await get(route());
      expect({
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
        csp: response.headers.get('content-security-policy'),
        body: await response.text(),
      }).toEqual({
        status: 401,
        cacheControl: 'no-store',
        csp: CSP,
        body: 'Unauthorized',
      });
    },
  );

  it('exchanges a token: 303 to a relative Location without the token, and the exact cookie', async () => {
    const before = nowSeconds();
    const response = await get(`/faq?preview_token=${tokenFor()}&lang=en`);
    const after = nowSeconds();
    const setCookie = response.headers.get('set-cookie') ?? '';
    const value = /^__Host-preview=([^;]+);/.exec(setCookie)?.[1] ?? '';

    expect({
      status: response.status,
      location: response.headers.get('location'),
      cacheControl: response.headers.get('cache-control'),
      csp: response.headers.get('content-security-policy'),
      setCookie: setCookie.replace(value, '<value>'),
    }).toEqual({
      status: 303,
      location: '/faq?lang=en',
      cacheControl: 'no-store',
      csp: CSP,
      setCookie:
        '__Host-preview=<value>; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=43200',
    });

    // The cookie is a token for this site, valid about 12 hours from the exchange.
    const verdict = verifyPreviewToken(value, {
      secret: TOKEN_SECRET,
      site: SITE_ID,
      now: after,
    });
    const exp = verdict.ok ? verdict.exp : undefined;
    expect(exp).toBeGreaterThanOrEqual(before + 43200);
    expect(exp).toBeLessThanOrEqual(after + 43200);
  });

  it('drops the token from the Location when no other parameter is in the query', async () => {
    const response = await get(`/faq?preview_token=${tokenFor()}`);
    expect({
      status: response.status,
      location: response.headers.get('location'),
    }).toEqual({ status: 303, location: '/faq' });
  });

  it('opens the page, an asset and the config route with the cookie sent by hand', async () => {
    const cookie = await exchangeForCookie();
    const headers = { cookie };
    const page = await get('/faq', { headers });
    const asset = await get(firstAssetPath(), { headers });
    const config = await get('/__preview/config', { headers });
    expect({
      page: page.status,
      asset: asset.status,
      config: { status: config.status, body: await config.json() },
    }).toEqual({
      page: 200,
      asset: 200,
      config: {
        status: 200,
        body: {
          editorOrigins: ['https://editor.example', 'http://localhost:3000'],
          bundleId: bundleOfOut.bundleId,
          protocolVersion: PROTOCOL_VERSION,
        },
      },
    });
  });

  it.each([
    ['expired', (now: number) => tokenFor({ now: now - 3600 })],
    ['for another site', () => tokenFor({ site: 'other-site' })],
    [
      'signed with the internal secret',
      () => tokenFor({ secret: INTERNAL_SECRET }),
    ],
    [
      'tampered',
      () => {
        const [payload = '', signature = ''] = tokenFor().split('.');
        const flipped =
          (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1);
        return `${payload}.${flipped}`;
      },
    ],
  ])(
    'refuses a %s token with 401 and no cookie, even beside a valid cookie',
    async (_label, make) => {
      const response = await get(`/faq?preview_token=${make(nowSeconds())}`, {
        headers: { cookie: await exchangeForCookie() },
      });
      expect({
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
        setCookie: response.headers.get('set-cookie'),
      }).toEqual({ status: 401, cacheControl: 'no-store', setCookie: null });
    },
  );

  it('accepts the internal bearer on every path, and refuses the token secret as a bearer', async () => {
    const author = readJson('src/content/authors/ana-torres.json');
    const body = JSON.stringify({
      documents: { 'authors/ana-torres': author },
    });
    const validate = (authorization: string) =>
      get('/__preview/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body,
      });

    const withInternal = await validate(`Bearer ${INTERNAL_SECRET}`);
    expect({
      status: withInternal.status,
      body: await withInternal.json(),
    }).toEqual({ status: 200, body: { valid: true } });

    const page = await get('/faq', {
      headers: { authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    expect(page.status).toBe(200);

    const withTokenSecret = await validate(`Bearer ${TOKEN_SECRET}`);
    expect(withTokenSecret.status).toBe(401);
  });

  it('refuses to start when the token and internal secrets are equal', async () => {
    const child = spawn(
      process.execPath,
      ['src/start.ts', 'sites/sample-site.config.ts', '--out', OUT],
      {
        cwd: SERVER_DIR,
        env: childEnv({ ...GATED_ENV, PREVIEW_INTERNAL_SECRET: TOKEN_SECRET }),
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    const [code] = await once(child, 'exit');
    expect(code).toBe(1);
    expect(stderr).toContain(
      'Error: PREVIEW_TOKEN_SECRET and PREVIEW_INTERNAL_SECRET must differ',
    );
  }, 30_000);
});
