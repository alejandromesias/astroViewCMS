// End-to-end (PHASE-2-DESIGN 5.7): GET /__preview/config answers the editor
// origins of the running node. global-setup starts it with
// PREVIEW_EDITOR_ORIGINS set to two origins, so the answer is checked exactly.
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');

describe('GET /__preview/config', () => {
  it('answers the editor origins from the environment, never cached', async () => {
    const response = await fetch(`${BASE}/__preview/config`);
    expect({
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      body: await response.json(),
    }).toEqual({
      status: 200,
      cacheControl: 'no-store',
      body: {
        editorOrigins: ['https://editor.example', 'http://localhost:3000'],
      },
    });
  });

  it('answers 405 to any other method', async () => {
    const response = await fetch(`${BASE}/__preview/config`, {
      method: 'POST',
    });
    expect({
      status: response.status,
      allow: response.headers.get('allow'),
    }).toEqual({
      status: 405,
      allow: 'GET',
    });
  });
});
