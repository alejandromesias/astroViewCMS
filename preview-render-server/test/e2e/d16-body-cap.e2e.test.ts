// End-to-end decision test for D16: the render route answers 413 to a body one
// byte over the cap, before parsing it, and renders a normal-size body.
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');
// MAX_BODY_BYTES in src/render/handlers.ts. A literal, because importing that
// module pulls in the site runtime; change both when the cap changes (D16).
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const post = (path: string, body: string) =>
  fetch(`${BASE}/__preview/render?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

describe('decision test D16: body cap', () => {
  it('answers 413 to a render body one byte over the cap', async () => {
    // JSON.stringify of an empty pad gives the envelope's fixed overhead.
    const overhead = JSON.stringify({ documents: {}, pad: '' }).length;
    const body = JSON.stringify({
      documents: {},
      pad: 'x'.repeat(MAX_BODY_BYTES + 1 - overhead),
    });
    expect(Buffer.byteLength(body)).toBe(MAX_BODY_BYTES + 1);

    const response = await post('/blog/blog-1', body);

    expect(response.status).toBe(413);
    expect(await response.text()).toBe(
      `Body must be at most ${MAX_BODY_BYTES} bytes`,
    );
  });

  it('renders a normal-size body (near miss)', async () => {
    const response = await post(
      '/blog/blog-1',
      JSON.stringify({ documents: {} }),
    );

    expect(response.status).toBe(200);
  });
});
