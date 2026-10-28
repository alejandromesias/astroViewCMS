// The request body of the render and validate routes (SYSTEM-DESIGN.md
// section 3, D12): `{ documents, media }`. Checked before anything else; a
// failure names the part that is wrong and becomes a 400.
import { z } from 'astro/zod';
import type { MediaEntry, MediaMap } from '../overlay/context.ts';

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

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;
const positiveInteger = (field: string) =>
  z.custom<number>(isPositiveInteger, {
    error: `"${field}" must be a positive integer`,
  });

// Messages are the text after the entry's location; `entryMessage` adds it, so
// today's 400 bodies stay as they were.
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
) satisfies z.ZodType<MediaEntry>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
// `z.record` would drop a `__proto__` key, so objects are only checked here and
// the media entries are validated one by one in `parseEnvelope`.
const objectOf = (error: string) =>
  z.custom<Record<string, unknown>>(isObject, { error });

const envelopeSchema = z.object(
  {
    documents: objectOf('"documents" must be an object'),
    media: objectOf('"media" must be an object').optional(),
  },
  { error: 'Body must be a JSON object with "documents"' },
);

/** The first issue as a one-line message that names the failing part. */
function entryMessage(ref: string, error: z.ZodError): string {
  const issue = error.issues[0];
  const where = `"media" entry "${ref}"`;
  if (!issue) return `${where} is invalid`;
  return issue.path.length === 0
    ? `${where} ${issue.message}`
    : `${where}: ${issue.message}`;
}

export function parseEnvelope(body: unknown): EnvelopeResult {
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid body',
    };
  // Entries are collected and then turned into an object, so that a ref named
  // `__proto__` becomes an ordinary key and not the prototype of the map.
  const media: Array<[string, MediaEntry]> = [];
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
