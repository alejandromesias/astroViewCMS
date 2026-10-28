// The request body of the render and validate routes (SYSTEM-DESIGN.md
// section 3, D12): `{ documents, media }`. Checked before anything else; a
// failure names the part that is wrong and becomes a 400.
import type { MediaMap } from '../overlay/context.ts';

// The formats of Astro's ImageMetadata.
const IMAGE_FORMATS = new Set([
  'png',
  'jpg',
  'jpeg',
  'tiff',
  'webp',
  'gif',
  'svg',
  'avif',
]);

export interface Envelope {
  documents: Record<string, unknown>;
  media: MediaMap;
}

export type EnvelopeResult =
  | ({ ok: true } & Envelope)
  | { ok: false; message: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

export function parseEnvelope(body: unknown): EnvelopeResult {
  if (!isObject(body))
    return {
      ok: false,
      message: 'Body must be a JSON object with "documents"',
    };
  if (!isObject(body.documents))
    return { ok: false, message: '"documents" must be an object' };
  // Entries are collected and then turned into an object, so that a ref named
  // `__proto__` becomes an ordinary key and not the prototype of the map.
  const media: Array<[string, MediaMap[string]]> = [];
  if (body.media !== undefined) {
    if (!isObject(body.media))
      return { ok: false, message: '"media" must be an object' };
    for (const [ref, entry] of Object.entries(body.media)) {
      const where = `"media" entry "${ref}"`;
      if (!isObject(entry))
        return { ok: false, message: `${where} must be an object` };
      if (typeof entry.url !== 'string' || entry.url === '')
        return { ok: false, message: `${where}: "url" must be a string` };
      if (!isPositiveInteger(entry.width))
        return {
          ok: false,
          message: `${where}: "width" must be a positive integer`,
        };
      if (!isPositiveInteger(entry.height))
        return {
          ok: false,
          message: `${where}: "height" must be a positive integer`,
        };
      if (
        typeof entry.format !== 'string' ||
        !IMAGE_FORMATS.has(entry.format)
      ) {
        return {
          ok: false,
          message: `${where}: "format" must be one of ${[...IMAGE_FORMATS].join(', ')}`,
        };
      }
      media.push([
        ref,
        {
          url: entry.url,
          width: entry.width,
          height: entry.height,
          format: entry.format,
        },
      ]);
    }
  }
  return {
    ok: true,
    documents: body.documents,
    media: Object.fromEntries(media),
  };
}
