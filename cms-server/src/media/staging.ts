// Staged uploads (design 5.5, 2.7a gaps): `<stagingDir>/<sha256>.<ext>`. The name is the
// content hash, so it cannot be guessed and one image is stored once. Each file is written
// atomically, so a file exists only once the whole image has been read and measured.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { errorCode, writeFileAtomic } from '../fs/atomic.ts';
import { MEDIA_FORMATS, type MediaFormat } from './measure.ts';

// 64 lowercase hex characters, a dot, then an accepted extension. Anchored at both ends.
const STAGED_NAME = new RegExp(`^[0-9a-f]{64}\\.(${MEDIA_FORMATS.join('|')})$`);

/** The format a staged file name stands for, or undefined if the name is not one. */
export function stagedFormat(name: string): MediaFormat | undefined {
  const extension = STAGED_NAME.exec(name)?.[1];
  return MEDIA_FORMATS.find((format) => format === extension);
}

/** Stores the image under its content hash, and returns that id and the file name. */
export async function stageImage(
  stagingDir: string,
  bytes: Uint8Array,
  format: MediaFormat,
): Promise<{ id: string; name: string }> {
  const id = crypto.createHash('sha256').update(bytes).digest('hex');
  const name = `${id}.${format}`;
  await fs.mkdir(stagingDir, { recursive: true });
  await writeFileAtomic(path.join(stagingDir, name), bytes);
  return { id, name };
}

/** The bytes of a staged file, or undefined if the name is not a staged name or nothing is stored under it. */
export async function readStaged(
  stagingDir: string,
  name: string,
): Promise<Buffer<ArrayBuffer> | undefined> {
  if (stagedFormat(name) === undefined) return undefined;
  try {
    // readFile allocates a plain ArrayBuffer; the type parameter does not say so.
    return (await fs.readFile(
      path.join(stagingDir, name),
    )) as Buffer<ArrayBuffer>;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}
