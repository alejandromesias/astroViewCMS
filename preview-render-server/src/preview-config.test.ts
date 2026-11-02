import { describe, expect, it } from 'vitest';
import { previewConfigResponse } from './preview-config.ts';

describe('previewConfigResponse', () => {
  it('answers no origins when the variable is unset (dev with no front server)', async () => {
    const response = previewConfigResponse({});
    expect({
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      contentType: response.headers.get('content-type'),
      body: await response.json(),
    }).toEqual({
      status: 200,
      cacheControl: 'no-store',
      contentType: 'application/json',
      body: { editorOrigins: [] },
    });
  });

  it('answers the origins of the variable, split by spaces or commas', async () => {
    const response = previewConfigResponse({
      PREVIEW_EDITOR_ORIGINS:
        'https://editor.example,  http://localhost:3000 https://[::1]:8443',
    });
    expect(await response.json()).toEqual({
      editorOrigins: [
        'https://editor.example',
        'http://localhost:3000',
        'https://[::1]:8443',
      ],
    });
  });

  it('answers 500 with the reason when an item is not an origin', async () => {
    const response = previewConfigResponse({
      PREVIEW_EDITOR_ORIGINS: 'https://editor.example/path',
    });
    expect({
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      body: await response.text(),
    }).toEqual({
      status: 500,
      cacheControl: 'no-store',
      body: 'Error: PREVIEW_EDITOR_ORIGINS: "https://editor.example/path" is not an origin',
    });
  });
});
