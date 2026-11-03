// End-to-end (PHASE-2-DESIGN 5.7): GET /__preview/config answers the editor
// origins of the running node and the identity of its bundle. global-setup starts it
// with PREVIEW_EDITOR_ORIGINS set to two origins, so the answer is checked exactly.
import fs from 'node:fs';
import path from 'node:path';
import { PROTOCOL_VERSION } from 'preview-protocol';
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');
// The bundle the node serves: its own bundle.json, written by the build.
const bundle = JSON.parse(
  fs.readFileSync(
    path.join(inject('buildDir'), 'sample-site', 'manifest', 'bundle.json'),
    'utf8',
  ),
) as { bundleId: string };

describe('GET /__preview/config', () => {
  it('answers the editor origins from the environment and the bundle identity, never cached', async () => {
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
        bundleId: bundle.bundleId,
        protocolVersion: PROTOCOL_VERSION,
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
