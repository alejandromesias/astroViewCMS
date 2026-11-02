import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mintPreviewToken, verifyPreviewToken } from './token.ts';

const SECRET = 'a-secret-that-is-long-enough-for-tests';
const SITE = 'sample-site';
const NOW = 1_800_000_000;
const TTL = 60;

// The payload and signature the format promises, computed here with node:crypto
// directly (an oracle, not the module under test).
function signedBy(secret: string, payloadJson: string): string {
  const payload = Buffer.from(payloadJson).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function mint(overrides: { secret?: string; site?: string } = {}): string {
  return mintPreviewToken({
    secret: SECRET,
    site: SITE,
    ttlSeconds: TTL,
    now: NOW,
    ...overrides,
  });
}

function verify(
  token: string,
  overrides: { secret?: string; site?: string; now?: number } = {},
) {
  return verifyPreviewToken(token, {
    secret: SECRET,
    site: SITE,
    now: NOW,
    ...overrides,
  });
}

describe('mintPreviewToken', () => {
  it('writes base64url(payload).base64url(HMAC-SHA256) with the payload { site, exp }', () => {
    const token = mint();
    expect(token).toBe(
      signedBy(SECRET, `{"site":"sample-site","exp":${NOW + TTL}}`),
    );
    const [payload] = token.split('.');
    expect(Buffer.from(payload ?? '', 'base64url').toString()).toBe(
      `{"site":"sample-site","exp":${NOW + TTL}}`,
    );
  });

  it('uses the secret as UTF-8 key bytes, not as hex', () => {
    const secret = '00ff00ff';
    const token = mint({ secret });
    const [payload, signature] = token.split('.');
    expect(signature).toBe(
      createHmac('sha256', Buffer.from(secret, 'utf8'))
        .update(payload ?? '')
        .digest('base64url'),
    );
    expect(signature).not.toBe(
      createHmac('sha256', Buffer.from(secret, 'hex'))
        .update(payload ?? '')
        .digest('base64url'),
    );
  });

  it('defaults the time to the clock', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = mintPreviewToken({
      secret: SECRET,
      site: SITE,
      ttlSeconds: TTL,
    });
    const after = Math.floor(Date.now() / 1000);
    const verdict = verifyPreviewToken(token, { secret: SECRET, site: SITE });
    expect(verdict.ok).toBe(true);
    expect(
      verdict.ok && verdict.exp >= before + TTL && verdict.exp <= after + TTL,
    ).toBe(true);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'refuses a lifetime of %s seconds',
    (ttlSeconds) => {
      expect(() =>
        mintPreviewToken({ secret: SECRET, site: SITE, ttlSeconds, now: NOW }),
      ).toThrow(new Error('ttlSeconds must be a positive integer'));
    },
  );

  it('refuses an empty site', () => {
    expect(() => mint({ site: '' })).toThrow(
      new Error('site must not be empty'),
    );
  });
});

describe('verifyPreviewToken', () => {
  it('accepts a fresh token and returns its expiry', () => {
    expect(verify(mint())).toEqual({ ok: true, exp: NOW + TTL });
  });

  it('accepts a token until the moment of expiry, and refuses it from then on', () => {
    const token = mint();
    expect(verify(token, { now: NOW + TTL - 1 })).toEqual({
      ok: true,
      exp: NOW + TTL,
    });
    expect(verify(token, { now: NOW + TTL })).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(verify(token, { now: NOW + TTL + 3600 })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('accepts a token as often as asked inside its lifetime (stateless)', () => {
    const token = mint();
    expect(verify(token)).toEqual({ ok: true, exp: NOW + TTL });
    expect(verify(token, { now: NOW + 1 })).toEqual({
      ok: true,
      exp: NOW + TTL,
    });
  });

  it('refuses a token signed with another secret', () => {
    expect(
      verify(mint(), { secret: 'another-secret-for-the-same-tests' }),
    ).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('refuses a payload changed after signing, with the signature kept', () => {
    const [, signature] = mint().split('.');
    const forged = signedBy(
      'some-other-key',
      `{"site":"sample-site","exp":${NOW + 99999}}`,
    );
    const [forgedPayload] = forged.split('.');
    expect(verify(`${forgedPayload}.${signature}`)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('refuses a signature with its last character changed', () => {
    const token = mint();
    const last = token.slice(-1) === 'A' ? 'B' : 'A';
    expect(verify(`${token.slice(0, -1)}${last}`)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('refuses a truncated signature', () => {
    const token = mint();
    expect(verify(token.slice(0, -1))).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('refuses a token for another site, with a valid signature', () => {
    expect(verify(mint({ site: 'other-site' }))).toEqual({
      ok: false,
      reason: 'site',
    });
  });

  it('reports expiry before the site when both fail', () => {
    expect(verify(mint({ site: 'other-site' }), { now: NOW + TTL })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it.each([
    ['an empty string', ''],
    ['no dot', 'abc'],
    ['three parts', 'abc.def.ghi'],
    ['an empty signature', 'abc.'],
    ['an empty payload', '.abc'],
    ['a plus sign in the payload', 'ab+c.abc'],
    ['padding in the signature', 'abc.ab=='],
    ['a space', 'ab c.abc'],
  ])('refuses a token with %s as malformed', (_label, token) => {
    expect(verify(token)).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each([
    ['not JSON', 'not json'],
    ['a JSON array', '[]'],
    ['no exp', '{"site":"sample-site"}'],
    ['a fraction of a second', `{"site":"sample-site","exp":${NOW}.5}`],
    ['exp as a string', `{"site":"sample-site","exp":"${NOW}"}`],
    ['an empty site', `{"site":"","exp":${NOW}}`],
    ['an extra key', `{"site":"sample-site","exp":${NOW},"extra":true}`],
  ])(
    'refuses a correctly signed payload that is %s, as malformed',
    (_label, payloadJson) => {
      expect(verify(signedBy(SECRET, payloadJson))).toEqual({
        ok: false,
        reason: 'malformed',
      });
    },
  );
});
