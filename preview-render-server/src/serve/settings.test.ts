import { describe, expect, it } from 'vitest';
import { frameAncestorsCsp, readServeSettings } from './settings.ts';

const SECRET_A = 'a'.repeat(32);
const SECRET_B = 'b'.repeat(32);

const REFUSAL = new Error(
  'Refusing to start without the preview gate: set PREVIEW_TOKEN_SECRET and PREVIEW_INTERNAL_SECRET, or PREVIEW_INSECURE=1 for local runs',
);

describe('frameAncestorsCsp', () => {
  it('lets only the node itself frame the preview when no origins are listed', () => {
    expect(frameAncestorsCsp(undefined)).toBe("frame-ancestors 'self'");
    expect(frameAncestorsCsp('')).toBe("frame-ancestors 'self'");
    expect(frameAncestorsCsp(' , ')).toBe("frame-ancestors 'self'");
  });

  it('adds each origin after self, split on spaces and commas in order', () => {
    expect(frameAncestorsCsp('http://cms.localhost:4400')).toBe(
      "frame-ancestors 'self' http://cms.localhost:4400",
    );
    expect(
      frameAncestorsCsp(
        'https://a.example.com, http://b.localhost:4400  https://[::1]:4400',
      ),
    ).toBe(
      "frame-ancestors 'self' https://a.example.com http://b.localhost:4400 https://[::1]:4400",
    );
  });

  it.each([
    'cms.localhost:4400',
    'ftp://cms.example.com',
    'javascript:alert(1)',
    'https://cms.example.com/',
    'http://a.test;script-src',
    'http://a.test"',
  ])('refuses %j, which is not a bare http origin', (item) => {
    expect(() => frameAncestorsCsp(item)).toThrow(
      new Error(`PREVIEW_EDITOR_ORIGINS: "${item}" is not an origin`),
    );
  });
});

describe('readServeSettings', () => {
  it('opens the node only for PREVIEW_INSECURE=1 with no secrets', () => {
    expect(readServeSettings({ PREVIEW_INSECURE: '1' })).toEqual({
      csp: "frame-ancestors 'self'",
      gate: { kind: 'open' },
    });
  });

  it('puts the editor origins into the CSP', () => {
    expect(
      readServeSettings({
        PREVIEW_INSECURE: '1',
        PREVIEW_EDITOR_ORIGINS: 'http://cms.localhost:4400',
      }).csp,
    ).toBe("frame-ancestors 'self' http://cms.localhost:4400");
  });

  it.each([
    {},
    { PREVIEW_INSECURE: 'true' },
    { PREVIEW_INSECURE: '0' },
    { PREVIEW_INSECURE: 'yes' },
    { PREVIEW_INSECURE: ' 1' },
    { PREVIEW_INSECURE: '' },
    { PREVIEW_TOKEN_SECRET: '', PREVIEW_INTERNAL_SECRET: '' },
  ])('refuses to start with the environment %j', (env) => {
    expect(() => readServeSettings(env)).toThrow(REFUSAL);
  });

  it('turns the gate on when both secrets and the site are set, and keeps their values', () => {
    expect(
      readServeSettings({
        PREVIEW_SITE: 'sample-site',
        PREVIEW_TOKEN_SECRET: SECRET_A,
        PREVIEW_INTERNAL_SECRET: SECRET_B,
      }).gate,
    ).toEqual({
      kind: 'gated',
      site: 'sample-site',
      tokenSecret: SECRET_A,
      internalSecret: SECRET_B,
    });
  });

  it('gates even when PREVIEW_INSECURE=1 is also set', () => {
    expect(
      readServeSettings({
        PREVIEW_INSECURE: '1',
        PREVIEW_SITE: 'sample-site',
        PREVIEW_TOKEN_SECRET: SECRET_A,
        PREVIEW_INTERNAL_SECRET: SECRET_B,
      }).gate.kind,
    ).toBe('gated');
  });

  it.each([
    { PREVIEW_TOKEN_SECRET: 'token' },
    { PREVIEW_INTERNAL_SECRET: 'internal' },
    { PREVIEW_TOKEN_SECRET: 'token', PREVIEW_INTERNAL_SECRET: '' },
  ])('refuses a single secret %j', (env) => {
    expect(() => readServeSettings(env)).toThrow(
      new Error(
        'PREVIEW_TOKEN_SECRET and PREVIEW_INTERNAL_SECRET must be set together',
      ),
    );
  });

  it('accepts a secret of exactly 32 characters', () => {
    expect(
      readServeSettings({
        PREVIEW_SITE: 'sample-site',
        PREVIEW_TOKEN_SECRET: 'x'.repeat(32),
        PREVIEW_INTERNAL_SECRET: 'y'.repeat(32),
      }).gate.kind,
    ).toBe('gated');
  });

  it.each([
    [
      'PREVIEW_TOKEN_SECRET',
      {
        PREVIEW_TOKEN_SECRET: 'x'.repeat(31),
        PREVIEW_INTERNAL_SECRET: SECRET_B,
      },
    ],
    [
      'PREVIEW_INTERNAL_SECRET',
      {
        PREVIEW_TOKEN_SECRET: SECRET_A,
        PREVIEW_INTERNAL_SECRET: 'y'.repeat(31),
      },
    ],
  ])('refuses a %s shorter than 32 characters', (name, secrets) => {
    expect(() =>
      readServeSettings({ PREVIEW_SITE: 'sample-site', ...secrets }),
    ).toThrow(new Error(`${name} must be at least 32 characters`));
  });

  it('refuses the same value for both secrets', () => {
    expect(() =>
      readServeSettings({
        PREVIEW_SITE: 'sample-site',
        PREVIEW_TOKEN_SECRET: SECRET_A,
        PREVIEW_INTERNAL_SECRET: SECRET_A,
      }),
    ).toThrow(
      new Error('PREVIEW_TOKEN_SECRET and PREVIEW_INTERNAL_SECRET must differ'),
    );
  });

  it.each([{}, { PREVIEW_SITE: '' }])(
    'refuses the gate without a site, with the environment %j',
    (siteEnv) => {
      expect(() =>
        readServeSettings({
          ...siteEnv,
          PREVIEW_TOKEN_SECRET: SECRET_A,
          PREVIEW_INTERNAL_SECRET: SECRET_B,
        }),
      ).toThrow(new Error('PREVIEW_SITE must be set when the gate is on'));
    },
  );
});
