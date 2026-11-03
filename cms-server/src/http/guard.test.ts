import { describe, expect, it } from 'vitest';
import { rejectCrossSite, rejectUnlessContentType } from './guard.ts';

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
