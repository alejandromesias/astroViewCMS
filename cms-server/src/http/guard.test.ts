import { describe, expect, it } from 'vitest';
import {
  rejectCrossSite,
  rejectUnlessContentType,
  rejectUnlessHostAllowed,
} from './guard.ts';

const IMAGE = /^image\//;
const request = (headers: Record<string, string> = {}) =>
  new Request('http://cms.localhost:4400/api/media', {
    method: 'POST',
    headers,
  });

describe('rejectCrossSite', () => {
  it('answers 403 Forbidden for a cross-site request', async () => {
    const response = rejectCrossSite(
      request({ 'sec-fetch-site': 'cross-site' }),
    );
    expect(response?.status).toBe(403);
    expect(await response?.text()).toBe('Forbidden');
  });

  it.each([['same-origin'], ['same-site'], ['none']])(
    'lets a %s request through',
    (value) => {
      expect(rejectCrossSite(request({ 'sec-fetch-site': value }))).toBeNull();
    },
  );

  it('lets a request without the header through', () => {
    expect(rejectCrossSite(request())).toBeNull();
  });
});

describe('rejectUnlessContentType', () => {
  it('answers 404 Not Found when the content type does not match', async () => {
    const response = rejectUnlessContentType(
      request({ 'content-type': 'text/plain' }),
      IMAGE,
    );
    expect(response?.status).toBe(404);
    expect(await response?.text()).toBe('Not Found');
  });

  it('answers 404 when there is no content type at all', () => {
    expect(rejectUnlessContentType(request(), IMAGE)?.status).toBe(404);
  });

  it('then applies the cross-site check to a matching request', async () => {
    const response = rejectUnlessContentType(
      request({ 'content-type': 'image/png', 'sec-fetch-site': 'cross-site' }),
      IMAGE,
    );
    expect(response?.status).toBe(403);
  });

  it('answers 404, not 403, when both the type and the origin are wrong', () => {
    const response = rejectUnlessContentType(
      request({ 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' }),
      IMAGE,
    );
    expect(response?.status).toBe(404);
  });

  it('lets a matching same-origin request through', () => {
    expect(
      rejectUnlessContentType(
        request({
          'content-type': 'image/png',
          'sec-fetch-site': 'same-origin',
        }),
        IMAGE,
      ),
    ).toBeNull();
  });
});

describe('rejectUnlessHostAllowed', () => {
  const CMS = 'http://cms.localhost:4400';
  const MISDIRECTED = {
    error: 'misdirected',
    message: 'The Host header is not an address of this CMS.',
  };
  const withHost = (host?: string) =>
    new Request('http://cms.localhost:4400/api/changes', {
      method: 'PUT',
      headers: host === undefined ? {} : { host },
    });

  it.each([
    ['localhost'],
    ['localhost:4400'],
    ['127.0.0.1'],
    ['127.0.0.1:4400'],
    ['[::1]'],
    ['[::1]:4400'],
    ['cms.localhost'],
    ['cms.localhost:4400'],
  ])('lets the Host %s through', (host) => {
    expect(rejectUnlessHostAllowed(withHost(host), CMS)).toBeNull();
  });

  it.each([
    ['localhost.evil.test'],
    ['localhost.evil.test:4400'],
    ['127.0.0.1.nip.io'],
    ['127.0.0.1.nip.io:4400'],
    ['evil.test'],
    ['localhost:4401'],
    ['localhost:44000'],
    ['127.0.0.1:80'],
    ['[::1]:4401'],
    ['cms.localhost:4401'],
    ['cms.evil.test'],
  ])('refuses the Host %s with 421 and the misdirected body', async (host) => {
    const response = rejectUnlessHostAllowed(withHost(host), CMS);
    expect(response?.status).toBe(421);
    expect(await response?.json()).toStrictEqual(MISDIRECTED);
  });

  it('refuses a request with no Host header, with 421 and the misdirected body', async () => {
    const response = rejectUnlessHostAllowed(withHost(), CMS);
    expect(response?.status).toBe(421);
    expect(await response?.json()).toStrictEqual(MISDIRECTED);
  });

  it('allows only the bare name when origins.cms names no port', () => {
    const noPort = 'http://cms.localhost';
    expect(
      rejectUnlessHostAllowed(withHost('cms.localhost'), noPort),
    ).toBeNull();
    expect(
      rejectUnlessHostAllowed(withHost('cms.localhost:80'), noPort)?.status,
    ).toBe(421);
  });
});
