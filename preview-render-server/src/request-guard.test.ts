import { describe, expect, it } from 'vitest';
import { BASE } from '../test/helpers.ts';
import {
  methodNotAllowed,
  rejectCrossSite,
  rejectUnlessContentType,
} from './request-guard.ts';

const request = (headers: Record<string, string>) =>
  new Request(BASE, { headers });

describe('rejectCrossSite', () => {
  it.each(['same-origin', 'same-site', 'none'])(
    'lets %s requests through',
    (site) => {
      expect(rejectCrossSite(request({ 'sec-fetch-site': site }))).toBeNull();
    },
  );

  it('lets requests without Sec-Fetch-Site through (curl, older clients)', () => {
    expect(rejectCrossSite(request({}))).toBeNull();
  });

  it('answers 403 to cross-site requests', () => {
    expect(
      rejectCrossSite(request({ 'sec-fetch-site': 'cross-site' }))?.status,
    ).toBe(403);
  });
});

describe('rejectUnlessContentType', () => {
  it('lets a matching content type through', () => {
    expect(
      rejectUnlessContentType(
        request({ 'content-type': 'application/json; charset=utf-8' }),
        /application\/json/,
      ),
    ).toBeNull();
  });

  it('answers 404 to another or a missing content type', () => {
    expect(
      rejectUnlessContentType(
        request({ 'content-type': 'text/plain' }),
        /application\/json/,
      )?.status,
    ).toBe(404);
    expect(
      rejectUnlessContentType(request({}), /application\/json/)?.status,
    ).toBe(404);
  });

  it('still refuses cross-site requests with the right content type', () => {
    const crossSite = request({
      'content-type': 'application/json',
      'sec-fetch-site': 'cross-site',
    });
    expect(
      rejectUnlessContentType(crossSite, /application\/json/)?.status,
    ).toBe(403);
  });
});

describe('methodNotAllowed', () => {
  it('answers 405 with the allowed methods', () => {
    const response = methodNotAllowed('GET, POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
  });
});
