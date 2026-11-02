// The metadata cache `.cms/<site>/media.json` (design 5.5, 2.7a gaps): the staged image's
// id (sha256 hex) to { width, height, format }. Writes go through one queue per file, so two
// uploads cannot lose each other's entry, and each write is atomic (fs/atomic.ts).
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { errorCode, writeFileAtomic } from '../fs/atomic.ts';
import { MEDIA_FORMATS, type Measures } from './measure.ts';

const MeasuresSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  format: z.enum(MEDIA_FORMATS),
});

/** The entries of media.json. A missing file is an empty cache; a damaged one throws, naming the entry. */
export async function readMedia(
  mediaFile: string,
): Promise<Map<string, Measures>> {
  let text: string;
  try {
    text = await fs.readFile(mediaFile, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return new Map();
    throw error;
  }
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('media.json must be an object');
  }
  const entries = new Map<string, Measures>();
  // Map keeps a `__proto__` key as an ordinary entry.
  for (const [id, value] of Object.entries(raw)) {
    const parsed = MeasuresSchema.safeParse(value);
    if (!parsed.success) throw new Error(`media.json entry ${id} is not valid`);
    entries.set(id, parsed.data);
  }
  return entries;
}

// The last queued write per file. A failed write does not block the ones after it.
const queues = new Map<string, Promise<void>>();

/** Adds or replaces the entry for `id`, after any write already queued for the same file. */
export function recordMedia(
  mediaFile: string,
  id: string,
  measures: Measures,
): Promise<void> {
  const previous = queues.get(mediaFile) ?? Promise.resolve();
  const write = previous.then(async () => {
    const entries = await readMedia(mediaFile);
    entries.set(id, measures);
    await fs.mkdir(path.dirname(mediaFile), { recursive: true });
    await writeFileAtomic(
      mediaFile,
      `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`,
    );
  });
  queues.set(
    mediaFile,
    write.catch(() => undefined),
  );
  return write;
}
