import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { mediaDir } from 'virtual:preview-site';
import { BASE, callRoute } from '../test/helpers.ts';
import { ALL, GET, MAX_BYTES, POST, measureImage, mediaFileName } from './media-route.ts';

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

describe('measureImage and the upload answer (D12)', () => {
  const make = (format: 'png' | 'jpeg' | 'webp') =>
    sharp({ create: { width: 40, height: 30, channels: 3, background: '#09f' } })[format]().toBuffer();

  it('reads width, height and format from the bytes', async () => {
    expect(await measureImage(await make('png'))).toEqual({ width: 40, height: 30, format: 'png' });
    expect(await measureImage(await make('webp'))).toEqual({ width: 40, height: 30, format: 'webp' });
  });

  it('names JPEG `jpg`, as ImageMetadata does', async () => {
    expect((await measureImage(await make('jpeg')))?.format).toBe('jpg');
  });

  it('is undefined for bytes that are not an image', async () => {
    expect(await measureImage(Buffer.from('not an image'))).toBeUndefined();
  });

  it('the upload answers { url, width, height, format } and stores only the file', async () => {
    const jpeg = await make('jpeg');
    const response = await upload(jpeg, 'image/jpeg');
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      url: `/__preview-media/${mediaFileName(jpeg, 'jpg')}`,
      width: 40,
      height: 30,
      format: 'jpg',
    });
    expect(fs.readdirSync(mediaDir).every((name) => /^[0-9a-f]{16}\.\w+$/.test(name))).toBe(true);
  });

  it('answers 415 to bytes that are not a readable image', async () => {
    expect((await upload('not an image', 'image/png')).status).toBe(415);
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

const text = async (response: Response) => response.text();

describe('upload: content type', () => {
  const type = async (contentType: string) => (await upload(PNG, contentType)).status;

  it('takes the type before any parameter, ignoring spaces around it', async () => {
    expect(await type('image/png; charset=binary')).toBe(201);
    expect(await type('image/png ;x=1')).toBe(201);
    expect(await type('image/jpeg;q=1')).toBe(201);
  });

  it('answers 404 unless the content type starts with image/', async () => {
    expect(await type('text/image/png')).toBe(404);
    expect(await type('application/image/png')).toBe(404);
    expect(await type('IMAGE/PNG')).toBe(404);
    const noType = await callRoute(
      POST,
      { file: 'new' },
      new Request(`${BASE}/__preview-media/new`, { method: 'POST', body: new Uint8Array([1]) }),
    );
    expect(noType.status).toBe(404);
  });

  it('answers 415 for image/ without a supported subtype, and for look-alikes', async () => {
    expect(await type('image/')).toBe(415);
    expect(await type('image/png2')).toBe(415);
    expect(await type('image/x-png')).toBe(415);
    expect(await type('image/jpg')).toBe(415);
    expect(await type('image/PNG')).toBe(415);
  });

  it('lists the supported types in the 415 answer', async () => {
    const response = await upload(PNG, 'image/svg+xml');
    expect(await text(response)).toBe('Supported types: image/png, image/jpeg, image/webp, image/avif, image/gif');
  });
});

describe('upload: size', () => {
  it('has a limit of 10 MB', () => {
    expect(MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('accepts sizes from 1 byte up to the limit, and fails on the content instead', async () => {
    const one = await upload(new Uint8Array(1), 'image/png');
    expect(one.status).toBe(415);
    expect(await text(one)).toBe('Not a readable image');
    const atLimit = await upload(new Uint8Array(MAX_BYTES), 'image/png');
    expect(atLimit.status).toBe(415);
  });

  it('answers 413 with the reason, for empty and too large bodies', async () => {
    for (const body of [new Uint8Array(0), new Uint8Array(MAX_BYTES + 1)]) {
      const response = await upload(body, 'image/png');
      expect(response.status).toBe(413);
      expect(await text(response)).toBe('Image must be between 1 byte and 10 MB');
    }
  });
});

describe('upload: answers', () => {
  it('has plain-text bodies for the guard answers', async () => {
    expect(await text(await upload('hello', 'text/plain'))).toBe('Not Found');
    expect(await text(await upload(PNG, 'image/png', { 'sec-fetch-site': 'cross-site' }))).toBe('Forbidden');
  });

  it('allows uploads from the same origin and same-site pages', async () => {
    expect((await upload(PNG, 'image/png', { 'sec-fetch-site': 'same-origin' })).status).toBe(201);
    expect((await upload(PNG, 'image/png', { 'sec-fetch-site': 'same-site' })).status).toBe(201);
  });

  it('answers JSON with exactly url, width, height and format', async () => {
    const response = await upload(PNG, 'image/png');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      url: `/__preview-media/${mediaFileName(PNG, 'png')}`,
      width: 1,
      height: 1,
      format: 'png',
    });
  });

  it('stores the same image twice under one name, and creates the folder when missing', async () => {
    fs.rmSync(mediaDir, { recursive: true, force: true });
    const first = (await (await upload(PNG, 'image/png')).json()) as { url: string };
    const second = await upload(PNG, 'image/png');
    expect(second.status).toBe(201);
    expect(((await second.json()) as { url: string }).url).toBe(first.url);
    expect(fs.readdirSync(mediaDir)).toEqual([path.basename(first.url)]);
  });

  it('answers 405 with Allow: GET on any name but new', async () => {
    const response = await callRoute(
      POST,
      { file: 'newer' },
      new Request(`${BASE}/__preview-media/newer`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(await text(response)).toBe('Method Not Allowed');
    const none = await callRoute(POST, {}, new Request(`${BASE}/__preview-media/`, { method: 'POST', body: PNG }));
    expect(none.status).toBe(405);
  });
});

describe('GET: names and headers', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
    ['image/gif', 'gif'],
    ['image/png', 'png'],
  ])('serves the file of a %s upload as that type', async (type, ext) => {
    const { url } = (await (await upload(PNG, type)).json()) as { url: string };
    expect(url.endsWith(`.${ext}`)).toBe(true);
    const response = await get(path.basename(url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(type);
  });

  it('is never cached', async () => {
    const { url } = (await (await upload(PNG, 'image/png')).json()) as { url: string };
    expect((await get(path.basename(url))).headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    '0123456789abcde.png',
    '0123456789abcdef0.png',
    'x0123456789abcdef.png',
    ' 0123456789abcdef.png',
    '0123456789abcdef.pngx',
    '0123456789abcdef.png ',
    '0123456789abcdef.png\n',
    '0123456789abcdef.jpeg',
    '0123456789abcdef.',
    '0123456789abcdef',
    '0123456789abcdeg.png',
    '0123456789abcdeF.png',
    '0123456789abcdef.PNG',
    '0123456789abcdef.bmp',
    '0123456789abcdef.png.png',
    '.png',
    'a/0123456789abcdef.png',
    '..\\0123456789abcdef.png',
    '',
  ])('answers 404 "Not Found" to the name %j', async (name) => {
    const response = await get(name);
    expect(response.status).toBe(404);
    expect(await text(response)).toBe('Not Found');
  });

  it('answers 404 when the route has no file parameter', async () => {
    const response = await callRoute(GET, {}, new Request(`${BASE}/__preview-media/`));
    expect(response.status).toBe(404);
    expect(await text(response)).toBe('Not Found');
  });

  it('answers 404 "Not Found" for a well-formed name that is not stored', async () => {
    const response = await get('0123456789abcdef.gif');
    expect(response.status).toBe(404);
    expect(await text(response)).toBe('Not Found');
  });

  it('answers 403 "Forbidden" to cross-site requests, also for stored files', async () => {
    const { url } = (await (await upload(PNG, 'image/png')).json()) as { url: string };
    const response = await get(path.basename(url), { 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
    expect(await text(response)).toBe('Forbidden');
  });
});

describe('ALL', () => {
  it('lists GET and POST', async () => {
    const response = await callRoute(ALL, {}, new Request(`${BASE}/__preview-media/x`, { method: 'PUT' }));
    expect(response.headers.get('allow')).toBe('GET, POST');
    expect(await text(response)).toBe('Method Not Allowed');
  });
});

describe('module settings', () => {
  it('is rendered on demand', async () => {
    expect((await import('./media-route.ts')).prerender).toBe(false);
  });
});

describe('GET: files that exist but must not be served', () => {
  it('does not reach a file outside the media folder or a file the upload did not name', async () => {
    fs.mkdirSync(mediaDir, { recursive: true });
    const outside = path.join(path.dirname(mediaDir), 'outside-secret.png');
    fs.writeFileSync(outside, 'secret');
    fs.writeFileSync(path.join(mediaDir, 'plain-name.png'), 'secret');
    try {
      expect((await get(`../${path.basename(outside)}`)).status).toBe(404);
      expect((await get('plain-name.png')).status).toBe(404);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
