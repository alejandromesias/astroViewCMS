// Draft images: images an editor uploads before they exist in the site.
//   POST /__preview-media/new   body = the image bytes, content-type image/*
//                               -> { "url": "/__preview-media/<hash>.<ext>" }
//   GET  /__preview-media/<file> serves it
// Files are named by content hash and kept in .build/<site>-media/. Nothing
// is written into the site; saving them there is a later step.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mediaDir } from 'virtual:preview-islands';
import { methodNotAllowed, rejectCrossSite, rejectUnlessContentType } from './request-guard.js';

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024;
// No SVG: it can carry scripts.
const TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};
const CONTENT_TYPES = Object.fromEntries(Object.entries(TYPES).map(([type, ext]) => [ext, type]));
const FILE_NAME = /^[0-9a-f]{16}\.(png|jpg|webp|avif|gif)$/;

export async function POST({ params, request }) {
  if (params.file !== 'new') return methodNotAllowed('GET');
  const rejection = rejectUnlessContentType(request, /^image\//);
  if (rejection) return rejection;

  const ext = TYPES[request.headers.get('content-type').split(';')[0].trim()];
  if (!ext) {
    return new Response(`Supported types: ${Object.keys(TYPES).join(', ')}`, { status: 415 });
  }
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return new Response('Image must be between 1 byte and 10 MB', { status: 413 });
  }

  const name = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.writeFile(path.join(mediaDir, name), bytes);
  return Response.json({ url: `/__preview-media/${name}` }, { status: 201 });
}

export async function GET({ params, request }) {
  const rejection = rejectCrossSite(request);
  if (rejection) return rejection;
  if (!FILE_NAME.test(params.file)) return new Response('Not Found', { status: 404 });

  try {
    const bytes = await fs.readFile(path.join(mediaDir, params.file));
    return new Response(bytes, {
      headers: {
        'Content-Type': CONTENT_TYPES[path.extname(params.file).slice(1)],
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

export function ALL() {
  return methodNotAllowed('GET, POST');
}
