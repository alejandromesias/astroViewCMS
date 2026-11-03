// POST /api/media and GET /media/staging/<file> (design 5.5, 5.9; 2.7a gaps). Hono only
// routes: the checks and the files live in media/ and in body.ts and guard.ts.
import { Hono } from 'hono';
import { type MediaFormat, measureImage } from '../media/measure.ts';
import { recordMedia } from '../media/metadata.ts';
import { readStaged, stagedFormat, stageImage } from '../media/staging.ts';
import { BodyTooLargeError, readBody } from './body.ts';
import { rejectUnlessContentType } from './guard.ts';

/** Largest upload, in bytes: 10 MB, as the stopgap route. */
export const MAX_BYTES = 10 * 1024 * 1024;

export interface MediaRouteDeps {
  /** `.cms/<site>/staging`. */
  stagingDir: string;
  /** `.cms/<site>/media.json`. */
  mediaFile: string;
  /** The CMS origin without a trailing slash. The upload's URL is built on it, because the preview iframe is another origin. */
  cmsOrigin: string;
}

// The types an upload may declare. Only the bytes decide the file's extension.
const UPLOAD_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
]);

const CONTENT_TYPE_OF: Record<MediaFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};

const tooLarge = () =>
  new Response('Image must be between 1 byte and 10 MB', { status: 413 });

export function mediaRoutes(deps: MediaRouteDeps): Hono {
  const app = new Hono();

  app.post('/api/media', async (c) => {
    const request = c.req.raw;
    const rejection = rejectUnlessContentType(request, /^image\//);
    if (rejection) return rejection;

    // The type before any parameter, ignoring spaces around it.
    const declared = (request.headers.get('content-type') ?? '')
      .replace(/;.*/s, '')
      .trim();
    if (!UPLOAD_TYPES.has(declared)) {
      return new Response(`Supported types: ${[...UPLOAD_TYPES].join(', ')}`, {
        status: 415,
      });
    }

    let bytes: Uint8Array;
    try {
      bytes = await readBody(request, MAX_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return tooLarge();
      throw error;
    }
    if (bytes.byteLength === 0) return tooLarge();

    // Measured once, here: an SVG, a TIFF or a bomb is refused with 415.
    const measures = await measureImage(bytes);
    if (measures === undefined) {
      return new Response('Not a readable image', { status: 415 });
    }
    const { id, name } = await stageImage(
      deps.stagingDir,
      bytes,
      measures.format,
    );
    await recordMedia(deps.mediaFile, id, measures);
    return c.json(
      { id, url: `${deps.cmsOrigin}/media/staging/${name}`, ...measures },
      201,
    );
  });

  // Not guarded against cross-site requests: the preview iframe is cross-site by design.
  // The name is a hash, so it cannot be guessed.
  app.get('/media/staging/:file', async (c) => {
    const name = c.req.param('file');
    const format = stagedFormat(name);
    const bytes =
      format === undefined
        ? undefined
        : await readStaged(deps.stagingDir, name);
    if (format === undefined || bytes === undefined) {
      return new Response('Not Found', { status: 404 });
    }
    return new Response(bytes, {
      headers: {
        'Content-Type': CONTENT_TYPE_OF[format],
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  });

  return app;
}
