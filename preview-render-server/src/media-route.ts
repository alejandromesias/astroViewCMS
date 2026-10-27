// Draft images: images an editor uploads before they exist in the site.
//   POST /__preview-media/new   body = the image bytes, content-type image/*
//                               -> { "url": "/__preview-media/<hash>.<ext>" }
//   GET  /__preview-media/<file> serves it
// Files are named by content hash and kept in .build/<site>-media/. Nothing
// is written into the site; saving them there is a later step.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { mediaDir } from 'virtual:preview-site';
import { methodNotAllowed, rejectCrossSite, rejectUnlessContentType } from './request-guard.ts';

export const prerender = false;

export const MAX_BYTES = 10 * 1024 * 1024;
// No SVG: it can carry scripts.
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};
const CONTENT_TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]));
const FILE_NAME = /^[0-9a-f]{16}\.(png|jpg|webp|avif|gif)$/;

/**
 * POST /__preview-media/new: stores an uploaded draft image (the request body
 * is the raw image) and answers 201 with its URL. Only the types in
 * EXTENSIONS (no SVG) up to MAX_BYTES; the file is named by its content hash,
 * so uploading the same image twice is harmless.
 */
export const POST: APIRoute = async ({ params, request }) => {
  // Only "new" accepts uploads; every other name is a GET-only file.
  if (params.file !== 'new') return methodNotAllowed('GET');
  const rejection = rejectUnlessContentType(request, /^image\//);
  if (rejection) return rejection;

  // The extension comes from the declared content type, never from user input.
  const ext = EXTENSIONS[(request.headers.get('content-type') ?? '').split(';')[0].trim()];
  if (!ext) {
    return new Response(`Supported types: ${Object.keys(EXTENSIONS).join(', ')}`, { status: 415 });
  }
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return new Response('Image must be between 1 byte and 10 MB', { status: 413 });
  }

  const name = mediaFileName(bytes, ext);
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.writeFile(path.join(mediaDir, name), bytes);
  return Response.json({ url: `/__preview-media/${name}` }, { status: 201 });
};

/**
 * GET /__preview-media/<file>: serves a stored draft image. Only names that
 * match FILE_NAME (16 hex characters + a known extension) are looked up, so a
 * request can't reach any other file. `nosniff` keeps the browser from
 * treating the bytes as anything but the declared image type.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const rejection = rejectCrossSite(request);
  if (rejection) return rejection;
  const file = params.file ?? '';
  if (!FILE_NAME.test(file)) return new Response('Not Found', { status: 404 });

  try {
    const bytes = await fs.readFile(path.join(mediaDir, file));
    return new Response(bytes, {
      headers: {
        'Content-Type': CONTENT_TYPES[path.extname(file).slice(1)],
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
};

/** Any other method. */
export const ALL: APIRoute = () => methodNotAllowed('GET, POST');

/** Content-addressed name: the same image always gets the same file. */
export function mediaFileName(bytes: Uint8Array, ext: string): string {
  return `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
}
