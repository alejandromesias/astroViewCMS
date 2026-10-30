// End-to-end (D9): sample-site has no regions (`regions: {}` in
// sites/sample-site.config.ts), so its preview build must not answer the old
// per-island routes (`GET` and `POST /__preview/<island>`, removed in task
// 1.1). The routes that stay answer as before.
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');

// Old island names, plus a name that is not a route segment of its own.
const OLD_NAMES = ['blocks', 'hero', 'pricing'];

describe('old per-island routes in a build without regions (D9)', () => {
  it.each(OLD_NAMES)('POST /__preview/%s answers 404', async (name) => {
    const response = await fetch(`${BASE}/__preview/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ props: { title: 'Old props' } }),
    });
    expect(response.status).toBe(404);
  });

  it.each(OLD_NAMES)('GET /__preview/%s answers 404', async (name) => {
    expect((await fetch(`${BASE}/__preview/${name}`)).status).toBe(404);
  });

  it('POST /__preview/landing/home-v2 (a path, not a name) answers 404', async () => {
    const response = await fetch(`${BASE}/__preview/landing/home-v2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ props: {} }),
    });
    expect(response.status).toBe(404);
  });

  it('the routes that stay still answer next to the 404s (near miss)', async () => {
    const render = await fetch(`${BASE}/__preview/render?path=/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: {} }),
    });
    expect(render.status).toBe(200);
    expect(await render.json()).toMatchObject({ limits: [] });

    const validate = await fetch(`${BASE}/__preview/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: {} }),
    });
    expect(validate.status).toBe(200);
    expect(await validate.json()).toEqual({ valid: true });

    const warm = await fetch(`${BASE}/__preview/warm`, { method: 'POST' });
    expect(warm.status).toBe(204);
  });
});
