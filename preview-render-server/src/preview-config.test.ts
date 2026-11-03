// @ts-nocheck
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type BundleIdentity,
  bundleIdentity,
  previewConfigResponse,
} from './preview-config.ts';

const NO_BUNDLE: BundleIdentity = { bundleId: null, protocolVersion: null };
const BUNDLE_JSON = {
  bundleId: 'b-2026-11-02',
  siteCommit: null,
  protocolVersion: 3,
  astroVersion: '7.3.1',
  builtAt: '2026-11-02T10:00:00.000Z',
};

describe('previewConfigResponse', () => {
  it('answers no origins when the variable is unset (dev with no front server)', async () => {
    const response = previewConfigResponse({}, () => NO_BUNDLE);
    expect({
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      contentType: response.headers.get('content-type'),
      body: await response.json(),
    }).toEqual({
      status: 200,
      cacheControl: 'no-store',
      contentType: 'application/json',
      body: { editorOrigins: [], bundleId: null, protocolVersion: null },
    });
  });

  it('answers the origins of the variable, split by spaces or commas, and the bundle identity', async () => {
    const response = previewConfigResponse(
      {
        PREVIEW_EDITOR_ORIGINS:
          'https://editor.example,  http://localhost:3000 https://[::1]:8443',
      },
      () => ({ bundleId: 'b-2026-11-02', protocolVersion: 3 }),
    );
    expect(await response.json()).toEqual({
      editorOrigins: [
        'https://editor.example',
        'http://localhost:3000',
        'https://[::1]:8443',
      ],
      bundleId: 'b-2026-11-02',
      protocolVersion: 3,
    });
  });

  it('answers 500 with the reason when an item is not an origin', async () => {
    const response = previewConfigResponse(
      { PREVIEW_EDITOR_ORIGINS: 'https://editor.example/path' },
      () => NO_BUNDLE,
    );
    expect({
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      contentType: response.headers.get('content-type'),
      body: await response.text(),
    }).toEqual({
      status: 500,
      cacheControl: 'no-store',
      contentType: 'text/plain; charset=utf-8',
      body: 'Error: PREVIEW_EDITOR_ORIGINS: "https://editor.example/path" is not an origin',
    });
  });

  it('answers 500 with the reason when the bundle identity cannot be read', async () => {
    const response = previewConfigResponse({}, () => {
      throw new Error('bundle.json is not a valid bundle file');
    });
    expect({
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      contentType: response.headers.get('content-type'),
      body: await response.text(),
    }).toEqual({
      status: 500,
      cacheControl: 'no-store',
      contentType: 'text/plain; charset=utf-8',
      body: 'Error: bundle.json is not a valid bundle file',
    });
  });
});

describe('bundleIdentity', () => {
  let manifestDir: string;

  beforeEach(() => {
    manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-config-'));
  });

  afterEach(() => {
    fs.rmSync(manifestDir, { recursive: true, force: true });
  });

  it('reads bundleId and protocolVersion from bundle.json with the real default reader', () => {
    fs.writeFileSync(
      path.join(manifestDir, 'bundle.json'),
      JSON.stringify(BUNDLE_JSON),
    );
    expect(bundleIdentity(manifestDir)).toEqual({
      bundleId: 'b-2026-11-02',
      protocolVersion: 3,
    });
  });

  it('answers nulls when there is no bundle.json (a build from before 2.9b)', () => {
    expect(bundleIdentity(manifestDir)).toEqual(NO_BUNDLE);
  });

  it('passes on a read error other than a missing file', () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    expect(() =>
      bundleIdentity(manifestDir, () => {
        throw denied;
      }),
    ).toThrow(denied);
  });

  it('refuses a file that is not JSON', () => {
    expect(() => bundleIdentity(manifestDir, () => '{ nope')).toThrow(
      new Error('bundle.json is not a valid bundle file'),
    );
  });

  it('refuses a file that does not match the bundle schema, with a key it does not know', () => {
    const extra = JSON.stringify({ ...BUNDLE_JSON, surprise: true });
    expect(() => bundleIdentity(manifestDir, () => extra)).toThrow(
      new Error('bundle.json is not a valid bundle file'),
    );
  });
});
