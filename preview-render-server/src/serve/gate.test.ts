import { mintPreviewToken } from 'preview-contract';
import { describe, expect, it } from 'vitest';
import { createGate, type GateRequest } from './gate.ts';

const NOW = 1_800_000_000;
const SITE = 'sample-site';
const TOKEN_SECRET = 'token-secret-for-the-gate-tests-0000';
const INTERNAL_SECRET = 'internal-secret-for-the-gate-tests-00';
const SETTINGS = {
  kind: 'gated',
  site: SITE,
  tokenSecret: TOKEN_SECRET,
  internalSecret: INTERNAL_SECRET,
} as const;
const COOKIE_FLAGS =
  'HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=43200';

function gateAt(now = NOW) {
  return createGate(SETTINGS, { now: () => now });
}

function get(url: string, headers: GateRequest['headers'] = {}): GateRequest {
  return { method: 'GET', url, headers };
}

function tokenFor(
  overrides: {
    secret?: string;
    site?: string;
    now?: number;
    ttlSeconds?: number;
  } = {},
): string {
  return mintPreviewToken({
    secret: TOKEN_SECRET,
    site: SITE,
    ttlSeconds: 60,
    now: NOW,
    ...overrides,
  });
}

function cookieFor(
  overrides: { site?: string; now?: number; ttlSeconds?: number } = {},
): string {
  return `__Host-preview=${tokenFor({ ttlSeconds: 43200, ...overrides })}`;
}

describe('createGate with the gate open', () => {
  it('allows every request, with or without credentials', () => {
    const gate = createGate({ kind: 'open' });
    expect(gate.check(get('/index.html'))).toEqual({ action: 'allow' });
    expect(
      gate.check(get('/index.html', { cookie: '__Host-preview=x' })),
    ).toEqual({
      action: 'allow',
    });
  });
});

describe('the internal bearer', () => {
  it('allows any path with the internal secret', () => {
    const gate = gateAt();
    const headers = { authorization: `Bearer ${INTERNAL_SECRET}` };
    expect(gate.check(get('/api/thing', headers))).toEqual({ action: 'allow' });
    expect(gate.check(get('/index.html', headers))).toEqual({
      action: 'allow',
    });
  });

  it.each([
    ['the token secret', `Bearer ${TOKEN_SECRET}`],
    ['a longer value', `Bearer ${INTERNAL_SECRET}x`],
    ['a shorter value', `Bearer ${INTERNAL_SECRET.slice(1)}`],
    ['no scheme', INTERNAL_SECRET],
    ['another scheme', `Basic ${INTERNAL_SECRET}`],
    ['an empty value', 'Bearer '],
  ])('does not allow %s', (_label, authorization) => {
    expect(gateAt().check(get('/index.html', { authorization }))).toEqual({
      action: 'deny',
    });
  });
});

describe('the cookie', () => {
  it('allows a request with a valid cookie', () => {
    expect(gateAt().check(get('/index.html', { cookie: cookieFor() }))).toEqual(
      {
        action: 'allow',
      },
    );
  });

  it('allows a valid cookie among other cookies, with spaces around the pair', () => {
    expect(
      gateAt().check(
        get('/index.html', {
          cookie: `a=1;  __Host-preview = ${tokenFor({ ttlSeconds: 43200 })} ; b=2`,
        }),
      ),
    ).toEqual({ action: 'allow' });
  });

  it('allows when any duplicate cookie is valid, whatever the others are', () => {
    expect(
      gateAt().check(
        get('/index.html', {
          cookie: `__Host-preview=bad; __Host-preview=${tokenFor({ ttlSeconds: 43200 })}`,
        }),
      ),
    ).toEqual({ action: 'allow' });
  });

  it('refuses a request with no cookie header', () => {
    expect(gateAt().check(get('/index.html'))).toEqual({ action: 'deny' });
  });

  it.each([
    ['another name', () => `preview=${tokenFor({ ttlSeconds: 43200 })}`],
    [
      'a longer name',
      () => `__Host-preview2=${tokenFor({ ttlSeconds: 43200 })}`,
    ],
    [
      'a name that ends the same',
      () => `x__Host-preview=${tokenFor({ ttlSeconds: 43200 })}`,
    ],
    ['an empty value', () => '__Host-preview='],
    ['no equals sign', () => '__Host-preview'],
  ])('refuses a cookie with %s', (_label, makeCookie) => {
    expect(
      gateAt().check(get('/index.html', { cookie: makeCookie() })),
    ).toEqual({
      action: 'deny',
    });
  });

  it('refuses an expired cookie, and the one that expires at this second', () => {
    expect(
      gateAt().check(
        get('/index.html', { cookie: cookieFor({ now: NOW - 43201 }) }),
      ),
    ).toEqual({ action: 'deny' });
    expect(
      gateAt().check(
        get('/index.html', { cookie: cookieFor({ now: NOW - 43200 }) }),
      ),
    ).toEqual({ action: 'deny' });
  });

  it('accepts a cookie one second before its expiry', () => {
    expect(
      gateAt().check(
        get('/index.html', { cookie: cookieFor({ now: NOW - 43199 }) }),
      ),
    ).toEqual({ action: 'allow' });
  });

  it('refuses a cookie for another site', () => {
    expect(
      gateAt().check(
        get('/index.html', { cookie: cookieFor({ site: 'other-site' }) }),
      ),
    ).toEqual({ action: 'deny' });
  });

  it('uses the clock when none is injected', () => {
    const real = mintPreviewToken({
      secret: TOKEN_SECRET,
      site: SITE,
      ttlSeconds: 60,
    });
    expect(
      createGate(SETTINGS).check(get(`/index.html?preview_token=${real}`)),
    ).toMatchObject({ action: 'redirect', location: '/index.html' });
  });
});

describe('the token exchange', () => {
  it('redirects a GET with a valid token, sets the cookie and keeps the other parameters', () => {
    const token = tokenFor();
    const cookieValue = mintPreviewToken({
      secret: TOKEN_SECRET,
      site: SITE,
      ttlSeconds: 43200,
      now: NOW,
    });
    expect(
      gateAt().check(get(`/page?b=2&preview_token=${token}&a=%20x&c=1+2`)),
    ).toEqual({
      action: 'redirect',
      location: '/page?b=2&a=%20x&c=1+2',
      setCookie: `__Host-preview=${cookieValue}; ${COOKIE_FLAGS}`,
    });
  });

  it('answers a HEAD the same way', () => {
    expect(
      gateAt().check({
        method: 'HEAD',
        url: `/page?preview_token=${tokenFor()}`,
        headers: {},
      }),
    ).toMatchObject({ action: 'redirect', location: '/page' });
  });

  it('gives a bare path when nothing else is left', () => {
    expect(
      gateAt().check(get(`/page?preview_token=${tokenFor()}`)),
    ).toMatchObject({
      action: 'redirect',
      location: '/page',
    });
  });

  it('drops empty segments and the encoded name of the token', () => {
    const token = tokenFor();
    expect(
      gateAt().check(get(`/page?&x=1&&preview%5Ftoken=${token}&&y=2&`)),
    ).toMatchObject({ action: 'redirect', location: '/page?x=1&y=2' });
  });

  it('drops both tokens when two valid tokens are sent', () => {
    expect(
      gateAt().check(
        get(
          `/page?preview_token=${tokenFor()}&x=1&preview_token=${tokenFor({ ttlSeconds: 61 })}`,
        ),
      ),
    ).toMatchObject({ action: 'redirect', location: '/page?x=1' });
  });

  it('refuses when one of two tokens is bad', () => {
    expect(
      gateAt().check(
        get(
          `/page?preview_token=${tokenFor()}&preview_token=${tokenFor({ site: 'other-site' })}`,
        ),
      ),
    ).toEqual({ action: 'deny' });
  });

  it('refuses a bad token even when a valid cookie is present, with no fallback', () => {
    expect(
      gateAt().check(
        get(`/page?preview_token=${tokenFor({ site: 'other-site' })}`, {
          cookie: cookieFor(),
        }),
      ),
    ).toEqual({ action: 'deny' });
  });

  it.each([
    ['an expired token', () => tokenFor({ now: NOW - 120 })],
    [
      'a token signed with another secret',
      () => tokenFor({ secret: 'another-secret-for-the-gate-tests-00' }),
    ],
    ['a token for another site', () => tokenFor({ site: 'other-site' })],
    ['a malformed token', () => 'abc'],
    ['an empty value', () => ''],
  ])('refuses %s in the URL', (_label, makeToken) => {
    expect(gateAt().check(get(`/page?preview_token=${makeToken()}`))).toEqual({
      action: 'deny',
    });
  });

  it('does not exchange a parameter whose name only starts with preview_token', () => {
    expect(gateAt().check(get(`/page?preview_tokenx=${tokenFor()}`))).toEqual({
      action: 'deny',
    });
  });

  it('does not exchange a POST, and applies the cookie rule to it', () => {
    expect(
      gateAt().check({
        method: 'POST',
        url: `/page?preview_token=${tokenFor()}`,
        headers: {},
      }),
    ).toEqual({ action: 'deny' });
    expect(
      gateAt().check({
        method: 'POST',
        url: `/page?preview_token=${tokenFor()}`,
        headers: { cookie: cookieFor() },
      }),
    ).toEqual({ action: 'allow' });
  });

  it('takes the path only from a protocol-relative target, never its host', () => {
    expect(
      gateAt().check(get(`//evil.example/page?preview_token=${tokenFor()}`)),
    ).toMatchObject({ action: 'redirect', location: '/page' });
  });

  it('refuses a target that cannot be parsed', () => {
    expect(gateAt().check(get('//[::?x=1'))).toEqual({ action: 'deny' });
  });

  it('treats a missing url as the root path', () => {
    expect(
      gateAt().check({
        method: 'GET',
        url: undefined,
        headers: { cookie: cookieFor() },
      }),
    ).toEqual({ action: 'allow' });
  });
});

describe('the gate, edge cases', () => {
  it('reads the real clock by default, so an expired token is refused', () => {
    const expired = mintPreviewToken({
      secret: TOKEN_SECRET,
      site: SITE,
      ttlSeconds: 60,
      now: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(
      createGate(SETTINGS).check(get(`/index.html?preview_token=${expired}`)),
    ).toEqual({ action: 'deny' });
  });

  it('reads a path that only spells the token parameter as a path, not as a token', () => {
    expect(
      gateAt().check(get('/preview_token', { cookie: cookieFor() })),
    ).toEqual({ action: 'allow' });
  });
});
