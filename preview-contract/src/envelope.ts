// The request body of the render and validate routes (SYSTEM-DESIGN.md
// section 3, D12): `{ documents, media }`. The renderer still checks it in
// preview-render-server/src/render/envelope.ts; this copy is the one cms-server
// will use, and envelope.test.ts holds both to the same cases (the point is
// that two readers can't drift). Messages match the renderer's, so a 400 body
// reads the same whichever side produced it.
import { z } from 'zod';
import type { MediaInfo } from 'preview-protocol';
import { objectOf } from './json.ts';

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

/** The body of POST /__preview/render and /__preview/validate. */
export interface RenderRequest {
  documents: Record<string, unknown>;
  media: Record<string, MediaInfo>;
}

/** Either the parsed request, or the one-line message that names the failing part. */
export type RenderRequestResult =
  | ({ ok: true } & RenderRequest)
  | { ok: false; message: string };

/** Checks that a value is a positive integer (width and height). */
const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

/** A schema for a positive integer field, named in the error message. */
const positiveInteger = (field: string) =>
  z.custom<number>(isPositiveInteger, {
    error: `"${field}" must be a positive integer`,
  });

/** Schema of one media entry. Messages are the text after the entry's
 *  location; `entryMessage` adds it. */
const mediaEntrySchema = z.object(
  {
    url: z
      .string({ error: '"url" must be a string' })
      .min(1, { error: '"url" must be a string' }),
    width: positiveInteger('width'),
    height: positiveInteger('height'),
    format: z.custom<string>(
      (value) => typeof value === 'string' && IMAGE_FORMATS.has(value),
      { error: `"format" must be one of ${[...IMAGE_FORMATS].join(', ')}` },
    ),
  },
  { error: 'must be an object' },
) satisfies z.ZodType<MediaInfo>;

/** The envelope as a whole. `media` may be left out; its entries are checked
 *  one by one in `parseRenderRequest`, because `z.record` would drop a
 *  `__proto__` key. */
export const renderRequestSchema = z.object(
  {
    documents: objectOf('"documents" must be an object'),
    media: objectOf('"media" must be an object').optional(),
  },
  { error: 'Body must be a JSON object with "documents"' },
);

/** The first issue of a failed media entry as a one-line message that names
 *  the entry and the field. */
function entryMessage(ref: string, error: z.ZodError): string {
  const issue = error.issues[0];
  const where = `"media" entry "${ref}"`;
  if (!issue) return `${where} is invalid`;
  return issue.path.length === 0
    ? `${where} ${issue.message}`
    : `${where}: ${issue.message}`;
}

/** Parses a request body. Refusals carry the message the render route
 *  answers with (a 400). */
export function parseRenderRequest(body: unknown): RenderRequestResult {
  const parsed = renderRequestSchema.safeParse(body);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid body',
    };
  // Entries are collected and then turned into an object, so that a ref named
  // `__proto__` becomes an ordinary key and not the prototype of the map.
  const media: Array<[string, MediaInfo]> = [];
  for (const [ref, value] of Object.entries(parsed.data.media ?? {})) {
    const entry = mediaEntrySchema.safeParse(value);
    if (!entry.success)
      return { ok: false, message: entryMessage(ref, entry.error) };
    media.push([ref, entry.data]);
  }
  return {
    ok: true,
    documents: parsed.data.documents,
    media: Object.fromEntries(media),
  };
}
