import { describe, expect, it, vi } from 'vitest';
import { createTestApp, fakeAppDeps } from '../../test/helpers/app-deps.ts';
import type { PublishAnswer } from '../sync/publish.ts';
import { createApp } from './app.ts';

// The app with only the publish route, over a publish that answers `answer`.
function appOver(answer: PublishAnswer = ok()) {
  const publish = vi.fn(async () => answer);
  const app = createTestApp({ ...fakeAppDeps(), publish: { publish } });
  return { app, publish };
}

function ok(): PublishAnswer {
  return { status: 200, body: { commit: 'c1', overwritten: [], renamed: [] } };
}

function post(
  app: ReturnType<typeof appOver>['app'],
  headers: Record<string, string> = { 'content-type': 'application/json' },
  body?: string,
): Promise<Response> {
  return Promise.resolve(
    app.request('/api/publish', {
      method: 'POST',
      headers,
      ...(body === undefined ? {} : { body }),
    }),
  );
}

describe('POST /api/publish', () => {
  it.each<[string, PublishAnswer]>([
    ['200', ok()],
    [
      '200 with nothing to publish',
      { status: 200, body: { commit: null, overwritten: [], renamed: [] } },
    ],
    [
      '409',
      {
        status: 409,
        body: { error: 'referenced-by', document: 'a/b', referrers: ['c/d'] },
      },
    ],
    [
      '422',
      {
        status: 422,
        body: {
          error: 'invalid',
          errors: [{ key: 'a/b', path: ['title'], message: 'Required' }],
        },
      },
    ],
    [
      '502',
      {
        status: 502,
        body: { error: 'push-failed', message: 'The remote refused the push' },
      },
    ],
    [
      '503 busy',
      { status: 503, body: { error: 'busy', message: 'The site is busy' } },
    ],
    [
      '503 build-in-progress',
      {
        status: 503,
        body: { error: 'build-in-progress', message: 'Still building' },
      },
    ],
    [
      '503 upstream-changed',
      {
        status: 503,
        body: { error: 'upstream-changed', message: 'Try again' },
      },
    ],
    [
      '500',
      {
        status: 500,
        body: { error: 'publish-failed', message: 'Publishing failed' },
      },
    ],
  ])(
    'answers the status and the body of the publish: %s',
    async (_name, answer) => {
      const { app } = appOver(answer);
      const res = await post(app);
      expect(res.status).toBe(answer.status);
      expect(await res.json()).toStrictEqual(answer.body);
    },
  );

  it('runs one publish per request', async () => {
    const { app, publish } = appOver();
    await post(app);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON',
    'application/json;charset=utf-8',
  ])('accepts the content type %s', async (type) => {
    const { app, publish } = appOver();
    expect((await post(app, { 'content-type': type })).status).toBe(200);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['none', {}],
    ['text/plain', { 'content-type': 'text/plain' }],
    ['form data', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['a longer subtype', { 'content-type': 'application/jsonp' }],
    ['a prefixed type', { 'content-type': 'x-application/json' }],
    ['an image', { 'content-type': 'image/png' }],
  ])(
    'answers 404 and publishes nothing for a request with the content type: %s',
    async (_name, headers) => {
      const { app, publish } = appOver();
      const res = await post(app, headers);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('Not Found');
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it('answers 403 and publishes nothing for a request the browser marks cross-site', async () => {
    const { app, publish } = appOver();
    const res = await post(app, {
      'content-type': 'application/json',
      'sec-fetch-site': 'cross-site',
    });
    expect(res.status).toBe(403);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(['same-origin', 'same-site', 'none'])(
    'lets a request through that the browser marks %s',
    async (site) => {
      const { app, publish } = appOver();
      const res = await post(app, {
        'content-type': 'application/json',
        'sec-fetch-site': site,
      });
      expect(res.status).toBe(200);
      expect(publish).toHaveBeenCalledTimes(1);
    },
  );

  it('answers 421 and publishes nothing for a Host that is not this CMS’s', async () => {
    const { app, publish } = appOver();
    const res = await post(app, {
      'content-type': 'application/json',
      host: 'localhost.evil.test',
    });
    expect(res.status).toBe(421);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not read the body: any body is ignored', async () => {
    const { app, publish } = appOver();
    const res = await post(
      app,
      { 'content-type': 'application/json' },
      'not json at all',
    );
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('has no GET', async () => {
    const { app, publish } = appOver();
    const res = await app.request('/api/publish');
    expect(res.status).toBe(404);
    expect(await res.json()).toStrictEqual({ error: 'not_found' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('is not registered without a publish', async () => {
    const res = await createApp(fakeAppDeps()).request('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost' },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toStrictEqual({ error: 'not_found' });
  });
});
