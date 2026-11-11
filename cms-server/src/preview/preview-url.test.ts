import { mintPreviewToken } from 'preview-contract';
import { describe, expect, it, vi } from 'vitest';
import {
  createWarmUp,
  isSitePath,
  previewUrlOf,
  SESSION_MS,
} from './preview-url.ts';

const ORIGIN = 'http://preview.localhost:4401';
const SECRET = 'a-test-secret';
const SITE = 'demo';
const NOW = 1000;
const MINUTE = 60 * 1000;

/** The token the URL must carry: the same mint, with the site, the 60 s lifetime and the time. */
const tokenAt = (now: number): string =>
  mintPreviewToken({ secret: SECRET, site: SITE, ttlSeconds: 60, now });

describe('isSitePath', () => {
  it.each([
    ['a path with two leading slashes', '//host'],
    ['a path that starts with a slash and a backslash', '/\\host'],
    ['a path that starts with a backslash', '\\host'],
    ['an absolute URL', 'http://host'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a path with no leading slash', 'a/b'],
    ['an empty path', ''],
    ['a line feed', '/a\nb'],
    ['a tab', '/a\tb'],
    ['a NUL', '/a\0b'],
    ['a percent-encoded backslash', '/%5Chost'],
    ['a percent-encoded backslash in lower case', '/%5chost'],
    ['a path with a token already', '/a?preview_token=x'],
    ['a path with a token after another parameter', '/a?x=1&preview_token=x'],
    ['a token inside a fragment', '/a#b?preview_token=x'],
  ])('refuses %s (%j)', (_name, path) => {
    expect(isSitePath(path)).toBe(false);
  });

  it.each([
    ['the root', '/'],
    ['a path with a query and a fragment', '/a/b?x=1#y'],
  ])('accepts %s (%j)', (_name, path) => {
    expect(isSitePath(path)).toBe(true);
  });
});

describe('previewUrlOf', () => {
  it('gives the path a token in its query, when the path has no query', () => {
    expect(
      previewUrlOf({
        origin: ORIGIN,
        path: '/a',
        site: SITE,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(`${ORIGIN}/a?preview_token=${tokenAt(NOW)}`);
  });

  it('joins the token with & when the path has a query, and keeps the fragment last', () => {
    expect(
      previewUrlOf({
        origin: ORIGIN,
        path: '/a/b?x=1#y',
        site: SITE,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(`${ORIGIN}/a/b?x=1&preview_token=${tokenAt(NOW)}#y`);
  });

  it('encodes a stray percent sign and a space, and leaves valid escapes alone', () => {
    expect(
      previewUrlOf({
        origin: ORIGIN,
        path: '/100%/a b/c%20d',
        site: SITE,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(`${ORIGIN}/100%25/a%20b/c%20d?preview_token=${tokenAt(NOW)}`);
  });

  it('gives the root path a token too', () => {
    expect(
      previewUrlOf({
        origin: ORIGIN,
        path: '/',
        site: SITE,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(`${ORIGIN}/?preview_token=${tokenAt(NOW)}`);
  });
});

describe('createWarmUp', () => {
  it('warms on the first call, and not again before 30 minutes have passed since the success', async () => {
    let clock = 0;
    const warm = vi.fn(async () => {});
    const warmUp = createWarmUp({
      warm,
      now: () => clock,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await warmUp();
    clock = SESSION_MS - 1;
    await warmUp();
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('warms again once 30 minutes have passed since the last success', async () => {
    let clock = 0;
    const warm = vi.fn(async () => {});
    const warmUp = createWarmUp({
      warm,
      now: () => clock,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await warmUp();
    clock = 30 * MINUTE;
    await warmUp();
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it('logs a failed warm-up without throwing, and keeps the stamp of the last success', async () => {
    let clock = 0;
    let attempts = 0;
    const warm = async () => {
      attempts += 1;
      if (attempts === 2) throw new Error('the node is down');
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const warmUp = createWarmUp({ warm, now: () => clock, log });
    await warmUp();
    clock = 30 * MINUTE;
    await expect(warmUp()).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('the preview warm-up failed', {
      reason: 'the node is down',
    });
    // The failure set no stamp, so the next call warms again, one millisecond later.
    clock = 30 * MINUTE + 1;
    await warmUp();
    expect(attempts).toBe(3);
  });
});
