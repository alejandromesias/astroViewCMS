import { describe, expect, it } from 'vitest';
import { fakeAppDeps } from '../../test/helpers/app-deps.ts';
import { createApp } from './app.ts';

describe('createApp', () => {
  it('answers a JSON 404 for an unknown path', async () => {
    const response = await createApp(fakeAppDeps()).request('/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it.each(['POST', 'PUT', 'DELETE'])(
    'answers a JSON 404 for %s on an unknown path',
    async (method) => {
      const response = await createApp(fakeAppDeps()).request('/api/changes', {
        method,
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    },
  );
});
