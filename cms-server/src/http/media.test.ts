import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { pngWithHeader } from '../../test/helpers/png.ts';
import { readMedia } from '../media/metadata.ts';
import { MAX_BYTES, mediaRoutes } from './media.ts';

const ORIGIN = 'http://cms.localhost:4400';

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const PNG_HASH = sha256(PNG);

// A 40×30 image in the given format.
const solid = (format: 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff') =>
  sharp({
    create: { width: 40, height: 30, channels: 3, background: '#09f' },
  })
    [format]()
    .toBuffer();

// A body of `count` chunks of `size` bytes, pulled only when read.
function countedBody(count: number, size: number) {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (state.pulled === count) {
          controller.close();
          return;
        }
        state.pulled += 1;
        controller.enqueue(new Uint8Array(size));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

let root: string;
let stagingDir: string;
let mediaFile: string;
let app: Hono;
beforeEach(async () => {
  root = await makeTestRoot();
  stagingDir = path.join(root, 'staging');
  mediaFile = path.join(root, 'media.json');
  app = mediaRoutes({ stagingDir, mediaFile, cmsOrigin: ORIGIN });
});
afterEach(async () => {
  await removeTestRoot(root);
});

const upload = (
  body: BodyInit | Buffer,
  type: string,
  headers: Record<string, string> = {},
) =>
  app.request('/api/media', {
    method: 'POST',
    headers: { 'content-type': type, ...headers },
    body,
    duplex: 'half',
  } as RequestInit);
const get = (name: string, headers: Record<string, string> = {}) =>
  app.request(`/media/staging/${name}`, { headers });
const text = async (response: Response) => response.text();
const uploadJson = async (bytes: BodyInit, type: string) =>
  (await (await upload(bytes, type)).json()) as {
    id: string;
    url: string;
    width: number;
    height: number;
    format: string;
  };

describe('POST /api/media: the answer and the stored file', () => {
  it('answers 201 with exactly id, url, width, height and format', async () => {
    const response = await upload(PNG, 'image/png');
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      id: PNG_HASH,
      url: `${ORIGIN}/media/staging/${PNG_HASH}.png`,
      width: 1,
      height: 1,
      format: 'png',
    });
  });

  it('stores the bytes under <sha256>.<ext> in the staging folder, and nothing else', async () => {
    await upload(PNG, 'image/png');
    expect(fs.readdirSync(stagingDir)).toEqual([`${PNG_HASH}.png`]);
    expect(fs.readFileSync(path.join(stagingDir, `${PNG_HASH}.png`))).toEqual(
      PNG,
    );
  });

  it('records the measures in media.json under the id', async () => {
    await upload(PNG, 'image/png');
    expect(await readMedia(mediaFile)).toEqual(
      new Map([[PNG_HASH, { width: 1, height: 1, format: 'png' }]]),
    );
  });

  it('names JPEG `jpg`, as ImageMetadata does, and measures the real size', async () => {
    const body = await upload(await solid('jpeg'), 'image/jpeg');
    expect(await body.json()).toMatchObject({
      width: 40,
      height: 30,
      format: 'jpg',
    });
  });

  it.each([
    ['webp', 'webp'],
    ['avif', 'avif'],
    ['gif', 'gif'],
  ] as const)('names a %s image .%s from its bytes', async (kind, ext) => {
    const bytes = await solid(kind);
    const json = await uploadJson(bytes, `image/${kind}`);
    expect(json.url).toBe(`${ORIGIN}/media/staging/${sha256(bytes)}.${ext}`);
    expect(json.format).toBe(ext);
  });

  it('takes the extension from the bytes, not from the declared type', async () => {
    const json = await uploadJson(PNG, 'image/jpeg');
    expect(json.url).toBe(`${ORIGIN}/media/staging/${PNG_HASH}.png`);
  });

  it('stores the same image twice under one name', async () => {
    const first = await uploadJson(PNG, 'image/png');
    const second = await uploadJson(PNG, 'image/png');
    expect(second.url).toBe(first.url);
    expect(fs.readdirSync(stagingDir)).toEqual([`${PNG_HASH}.png`]);
  });

  it('answers 415 with a plain message for bytes that are not a readable image', async () => {
    const response = await upload('not an image', 'image/png');
    expect(response.status).toBe(415);
    expect(await text(response)).toBe('Not a readable image');
    expect(fs.existsSync(stagingDir)).toBe(false);
  });

  it('answers 415 to SVG and TIFF bytes, which are measured and refused whatever the type', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    expect((await upload(svg, 'image/png')).status).toBe(415);
    expect((await upload(await solid('tiff'), 'image/png')).status).toBe(415);
  });

  it('answers 415 to a header whose pixel count is over the limit (a decompression bomb)', async () => {
    const response = await upload(pngWithHeader(20000, 20000), 'image/png');
    expect(response.status).toBe(415);
    expect(await text(response)).toBe('Not a readable image');
    expect(fs.existsSync(stagingDir)).toBe(false);
  });

  it('lists the supported types in the 415 answer for an unsupported declared type', async () => {
    const response = await upload('<svg/>', 'image/svg+xml');
    expect(response.status).toBe(415);
    expect(await text(response)).toBe(
      'Supported types: image/png, image/jpeg, image/webp, image/avif, image/gif',
    );
  });

  it.each([
    'image/bmp',
    'image/tiff',
    'image/jpg',
    'image/x-png',
    'image/PNG',
    'image/',
  ])('answers 415 to the declared type %s', async (type) => {
    expect((await upload(PNG, type)).status).toBe(415);
  });
});

describe('POST /api/media: content type', () => {
  const type = async (contentType: string) =>
    (await upload(PNG, contentType)).status;

  it('takes the type before any parameter, ignoring spaces around it', async () => {
    expect(await type('image/png; charset=binary')).toBe(201);
    expect(await type('image/png ;x=1')).toBe(201);
    expect(await type('image/jpeg;q=1')).toBe(201);
  });

  it('answers 404 unless the content type starts with image/', async () => {
    expect(await type('text/image/png')).toBe(404);
    expect(await type('application/image/png')).toBe(404);
    expect(await type('IMAGE/PNG')).toBe(404);
    const noType = await app.request('/api/media', {
      method: 'POST',
      body: new Uint8Array([1]),
    });
    expect(noType.status).toBe(404);
  });

  it('answers 403 Forbidden to cross-site uploads, also with a valid image', async () => {
    const response = await upload(PNG, 'image/png', {
      'sec-fetch-site': 'cross-site',
    });
    expect(response.status).toBe(403);
    expect(await text(response)).toBe('Forbidden');
  });

  it('allows uploads from the same origin and from same-site pages', async () => {
    expect(
      (await upload(PNG, 'image/png', { 'sec-fetch-site': 'same-origin' }))
        .status,
    ).toBe(201);
    expect(
      (await upload(PNG, 'image/png', { 'sec-fetch-site': 'same-site' }))
        .status,
    ).toBe(201);
  });
});

describe('POST /api/media: size', () => {
  it('has a limit of 10 MB', () => {
    expect(MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('answers 413 with the reason to an empty body', async () => {
    const response = await upload(new Uint8Array(0), 'image/png');
    expect(response.status).toBe(413);
    expect(await text(response)).toBe('Image must be between 1 byte and 10 MB');
  });

  it('answers 413 to a body over the limit that declares its length', async () => {
    const response = await upload(new Uint8Array(MAX_BYTES + 1), 'image/png');
    expect(response.status).toBe(413);
    expect(await text(response)).toBe('Image must be between 1 byte and 10 MB');
  });

  it('answers 413 to a body over the limit that does not declare its length, after reading up to the cap', async () => {
    const { stream, state } = countedBody(11, 1024 * 1024);
    const response = await upload(stream, 'image/png');
    expect(response.status).toBe(413);
    expect(await text(response)).toBe('Image must be between 1 byte and 10 MB');
    // Ten chunks of 1 MiB fit the cap, the eleventh passes it, and nothing after it is read.
    expect(state.pulled).toBe(11);
    expect(fs.existsSync(stagingDir)).toBe(false);
  });

  it('refuses a declared length over the limit without reading the body', async () => {
    const { stream, state } = countedBody(1, 1024);
    const response = await upload(stream, 'image/png', {
      'content-length': String(MAX_BYTES + 1),
    });
    expect(response.status).toBe(413);
    expect(state.pulled).toBe(0);
  });

  it('stores nothing when the client disconnects mid-upload', async () => {
    const stream = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          controller.enqueue(PNG);
          controller.error(new Error('client went away'));
        },
      },
      { highWaterMark: 0 },
    );
    const response = await upload(stream, 'image/png');
    expect(response.status).toBe(500);
    expect(fs.existsSync(stagingDir)).toBe(false);
    expect(fs.existsSync(mediaFile)).toBe(false);
  });

  it('records two uploads that arrive together', async () => {
    const jpeg = await solid('jpeg');
    await Promise.all([upload(PNG, 'image/png'), upload(jpeg, 'image/jpeg')]);
    const entries = await readMedia(mediaFile);
    expect([...entries.keys()].sort()).toEqual([PNG_HASH, sha256(jpeg)].sort());
  });
});

describe('POST /api/media: preflight and other methods', () => {
  it('answers a CORS preflight with no CORS headers', async () => {
    const response = await app.request('/api/media', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://evil.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('has no GET or PUT on /api/media', async () => {
    expect((await app.request('/api/media')).status).toBe(404);
    expect(
      (await app.request('/api/media', { method: 'PUT', body: PNG })).status,
    ).toBe(404);
  });
});

describe('GET /media/staging/<name>', () => {
  it('serves an uploaded image with the safe headers', async () => {
    await upload(PNG, 'image/png');
    const response = await get(`${PNG_HASH}.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cross-origin-resource-policy')).toBe(
      'cross-origin',
    );
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  });

  it.each([
    ['webp', 'image/webp'],
    ['avif', 'image/avif'],
    ['gif', 'image/gif'],
    ['jpeg', 'image/jpeg'],
  ] as const)('serves a %s upload as %s', async (kind, mime) => {
    const bytes = await solid(kind);
    const { url } = await uploadJson(bytes, mime);
    const response = await get(url.slice(url.lastIndexOf('/') + 1));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(mime);
  });

  it('is not refused for cross-site requests: the preview iframe is cross-site', async () => {
    await upload(PNG, 'image/png');
    const response = await get(`${PNG_HASH}.png`, {
      'sec-fetch-site': 'cross-site',
    });
    expect(response.status).toBe(200);
  });

  it('answers 404 Not Found to a well-formed name that is not stored', async () => {
    const response = await get(`${PNG_HASH}.png`);
    expect(response.status).toBe(404);
    expect(await text(response)).toBe('Not Found');
  });

  it.each([
    `${PNG_HASH.slice(1)}.png`,
    `${PNG_HASH}0.png`,
    `${PNG_HASH.toUpperCase()}.png`,
    `x${PNG_HASH}.png`,
    `${PNG_HASH}.jpeg`,
    `${PNG_HASH}.svg`,
    `${PNG_HASH}.PNG`,
    `${PNG_HASH}.png.bak`,
    `${PNG_HASH}.`,
    PNG_HASH,
    '0123456789abcdef.png',
    'abc.png',
    '0123456789abcdef.svg',
    '..%2Fsecret.png',
    '.png',
  ])('answers 404 to the name %j', async (name) => {
    const response = await get(name);
    expect(response.status).toBe(404);
    expect(await text(response)).toBe('Not Found');
  });

  it('answers 404 to a near-miss name even when a file with that name exists', async () => {
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, `x${PNG_HASH}.png`), PNG);
    fs.writeFileSync(path.join(stagingDir, `${PNG_HASH}.png.bak`), PNG);
    expect((await get(`x${PNG_HASH}.png`)).status).toBe(404);
    expect((await get(`${PNG_HASH}.png.bak`)).status).toBe(404);
  });

  it('does not reach a file outside the staging folder', async () => {
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'outside.png'), 'secret');
    expect((await get('..%2Foutside.png')).status).toBe(404);
    expect((await get('../outside.png')).status).toBe(404);
    expect((await get('..\\outside.png')).status).toBe(404);
  });
});
