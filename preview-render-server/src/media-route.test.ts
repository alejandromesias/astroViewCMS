import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { mediaDir } from 'virtual:preview-islands';
import { BASE, callRoute } from '../test/helpers.ts';
import { ALL, GET, MAX_BYTES, POST, mediaFileName } from './media-route.ts';

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const upload = (body: BodyInit, type: string, headers: Record<string, string> = {}) =>
  callRoute(
    POST,
    { file: 'new' },
    new Request(`${BASE}/__preview-media/new`, { method: 'POST', headers: { 'content-type': type, ...headers }, body }),
  );
const get = (file: string, headers: Record<string, string> = {}) =>
  callRoute(GET, { file }, new Request(`${BASE}/__preview-media/${file}`, { headers }));

afterAll(() => fs.rmSync(mediaDir, { recursive: true, force: true }));

describe('mediaFileName', () => {
  it('is 16 hex characters of the content hash plus the extension', () => {
    expect(mediaFileName(PNG, 'png')).toMatch(/^[0-9a-f]{16}\.png$/);
  });

  it('is the same for the same bytes and different for different bytes', () => {
    expect(mediaFileName(PNG, 'png')).toBe(mediaFileName(Buffer.from(PNG), 'png'));
    expect(mediaFileName(PNG, 'png')).not.toBe(mediaFileName(Buffer.from('other'), 'png'));
  });
});

describe('POST /__preview-media/new', () => {
  it('stores the image and returns its URL', async () => {
    const response = await upload(PNG, 'image/png');
    expect(response.status).toBe(201);
    const { url } = (await response.json()) as { url: string };
    expect(url).toBe(`/__preview-media/${mediaFileName(PNG, 'png')}`);
    expect(fs.readFileSync(path.join(mediaDir, path.basename(url)))).toEqual(PNG);
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
    ['image/gif', 'gif'],
  ])('names a %s upload .%s', async (type, ext) => {
    const { url } = (await (await upload(PNG, type)).json()) as { url: string };
    expect(url.endsWith(`.${ext}`)).toBe(true);
  });

  it('answers 415 to SVG and other image types', async () => {
    expect((await upload('<svg/>', 'image/svg+xml')).status).toBe(415);
    expect((await upload(PNG, 'image/bmp')).status).toBe(415);
  });

  it('answers 404 to a non-image content type', async () => {
    expect((await upload('hello', 'text/plain')).status).toBe(404);
  });

  it('answers 403 to cross-site uploads', async () => {
    expect((await upload(PNG, 'image/png', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('answers 413 to empty and oversized images', async () => {
    expect((await upload(new Uint8Array(0), 'image/png')).status).toBe(413);
    expect((await upload(new Uint8Array(MAX_BYTES + 1), 'image/png')).status).toBe(413);
  });

  it('only accepts POST on /new', async () => {
    const response = await callRoute(
      POST,
      { file: 'abc.png' },
      new Request(`${BASE}/__preview-media/abc.png`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG }),
    );
    expect(response.status).toBe(405);
  });
});

describe('GET /__preview-media/<file>', () => {
  it('serves an uploaded image with safe headers', async () => {
    const { url } = (await (await upload(PNG, 'image/png')).json()) as { url: string };
    const response = await get(path.basename(url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  });

  it('answers 404 to a missing file', async () => {
    expect((await get('0000000000000000.png')).status).toBe(404);
  });

  it.each(['../secret.png', '..%2Fsecret.png', 'abc.png', '0123456789abcdef.svg', '0123456789ABCDEF.png'])(
    'answers 404 to the name %s',
    async (name) => {
      expect((await get(name)).status).toBe(404);
    },
  );

  it('refuses cross-site requests', async () => {
    expect((await get('0000000000000000.png', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});

describe('other methods', () => {
  it('answer 405', async () => {
    const response = await callRoute(ALL, {}, new Request(`${BASE}/__preview-media/x`, { method: 'DELETE' }));
    expect(response.status).toBe(405);
  });
});
