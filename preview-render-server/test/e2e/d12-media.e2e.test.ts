// End-to-end decision tests for D12: image metadata travels in the request.
// A media-map entry is rendered as its own URL (the optimizer is bypassed), a
// bundle image still goes through /_image, and validate agrees with render.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');
const SITE = path.resolve(import.meta.dirname, '../../../sample-site');
const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(SITE, file), 'utf8'));

const METADATA_URL = 'http://169.254.169.254/x.png';
const entry = (url: string) => ({
  url,
  width: 1200,
  height: 800,
  format: 'png',
});

async function post(route: string, body: unknown, search = '') {
  const response = await fetch(`${BASE}/__preview/${route}${search}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: response.headers.get('content-type')?.includes('json')
      ? (JSON.parse(text) as any)
      : undefined,
  };
}

const render = (
  path_: string,
  documents: Record<string, unknown>,
  media?: Record<string, unknown>,
) =>
  post(
    'render',
    { documents, ...(media === undefined ? {} : { media }) },
    `?path=${encodeURIComponent(path_)}`,
  );

// The src of every <img> in the page, in order.
const imageSources = (html: string) =>
  [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g)].map(([, src = '']) => src);

// A draft of the ana-torres author whose avatar is `avatar`.
const anaWithAvatar = (avatar: string) => ({
  ...readJson('src/content/authors/ana-torres.json'),
  avatar,
});

describe('D12: a media-map entry is rendered as its own URL', () => {
  it('renders the entry url unchanged and never sends it through /_image', async () => {
    const { status, json } = await render(
      '/blog/blog-1',
      { 'authors/ana-torres': anaWithAvatar('uploads/evil.png') },
      { 'uploads/evil.png': entry(METADATA_URL) },
    );

    expect(status).toBe(200);
    expect(
      imageSources(json.html).filter((src) => src.includes('169')),
    ).toEqual([METADATA_URL]);
    expect(json.html).not.toContain('/_image?href=http%3A%2F%2F169');
    expect(json.html).not.toContain('/_image?href=http://169');
    expect(json.limits).toEqual([]);
  });

  it('a relative draft path resolves to the project path that the map is keyed by (D5)', async () => {
    const avatar = '../../assets/authors/new-avatar.png';
    const { status, json } = await render(
      '/blog/blog-1',
      { 'authors/ana-torres': anaWithAvatar(avatar) },
      { 'src/assets/authors/new-avatar.png': entry(METADATA_URL) },
    );
    expect(status).toBe(200);
    expect(imageSources(json.html)).toContain(METADATA_URL);
  });

  it('near miss: a map entry for another project path does not supply the avatar', async () => {
    const avatar = '../../assets/authors/new-avatar.png';
    const { status, json } = await render(
      '/blog/blog-1',
      { 'authors/ana-torres': anaWithAvatar(avatar) },
      { 'src/assets/authors/other-avatar.png': entry(METADATA_URL) },
    );
    expect(status).toBe(422);
    expect(json.errors).toEqual([
      {
        key: 'authors/ana-torres',
        path: ['avatar'],
        message: `image not found: ${avatar}`,
      },
    ]);
  });

  it('makes no outbound request while rendering it', async () => {
    const hits: string[] = [];
    const listener = http.createServer((request, response) => {
      hits.push(request.url ?? '');
      response.end();
    });
    await new Promise<void>((resolve) =>
      listener.listen(0, '127.0.0.1', () => resolve()),
    );
    try {
      const { port } = listener.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}/x.png`;
      const { status, json } = await render(
        '/blog/blog-1',
        { 'authors/ana-torres': anaWithAvatar('uploads/local.png') },
        { 'uploads/local.png': entry(url) },
      );
      expect(status).toBe(200);
      expect(imageSources(json.html)).toContain(url);
      expect(hits).toEqual([]);
    } finally {
      listener.close();
    }
  });

  it('GET /_image refuses the same host, because the site does not allow it', async () => {
    const response = await fetch(
      `${BASE}/_image?href=${encodeURIComponent(METADATA_URL)}`,
    );
    expect(response.status).toBe(403);
  });

  it('validate answers the same as render for a map entry and for a missing one', async () => {
    const author = anaWithAvatar('uploads/evil.png');
    const withMap = await post('validate', {
      documents: { 'authors/ana-torres': author },
      media: { 'uploads/evil.png': entry(METADATA_URL) },
    });
    expect(withMap.status).toBe(200);
    expect(withMap.json).toMatchObject({ valid: true });

    const withoutMap = await post('validate', {
      documents: { 'authors/ana-torres': author },
    });
    expect(withoutMap.status).toBe(422);
    expect(withoutMap.json.errors).toEqual([
      {
        key: 'authors/ana-torres',
        path: ['avatar'],
        message: 'image not found: uploads/evil.png',
      },
    ]);
  });
});

describe('D12: resolution order in flavor 2', () => {
  it('an upload with no map entry answers image not found (422)', async () => {
    const { status, json } = await render('/blog/blog-1', {
      'authors/ana-torres': anaWithAvatar('uploads/new-avatar.png'),
    });
    expect(status).toBe(422);
    expect(json.errors).toEqual([
      {
        key: 'authors/ana-torres',
        path: ['avatar'],
        message: 'image not found: uploads/new-avatar.png',
      },
    ]);
  });

  it('a bundle image beats a map entry for the same path, and still goes through /_image', async () => {
    const { status, json } = await render(
      '/blog/blog-1',
      {
        'authors/ana-torres': anaWithAvatar(
          '../../assets/authors/ana-torres.png',
        ),
      },
      { 'src/assets/authors/ana-torres.png': entry(METADATA_URL) },
    );
    expect(status).toBe(200);
    const sources = imageSources(json.html);
    expect(sources.some((src) => src.startsWith('/_image?'))).toBe(true);
    expect(sources.some((src) => src.includes('169'))).toBe(false);
  });
});
