// Measures an uploaded image once, with sharp (design 5.5, 2.7a gaps). The format is the
// one sharp reads from the bytes, never the declared content type, and only the formats
// below are accepted (no SVG: it can carry scripts; no TIFF).
import sharp from 'sharp';

/** Largest image sharp will decode, in pixels: its own default (0x3fff squared), kept explicit. */
export const MAX_PIXELS = 0x3fff * 0x3fff;

export const MEDIA_FORMATS = ['png', 'jpg', 'webp', 'avif', 'gif'] as const;
export type MediaFormat = (typeof MEDIA_FORMATS)[number];

export interface Measures {
  width: number;
  height: number;
  format: MediaFormat;
}

// sharp's names for the accepted formats. AVIF is reported as HEIF with AV1 compression.
const FORMAT_OF_SHARP = new Map<string, MediaFormat>([
  ['png', 'png'],
  ['jpeg', 'jpg'],
  ['webp', 'webp'],
  ['avif', 'avif'],
  ['gif', 'gif'],
]);

/** Width, height and format of the image, or undefined if sharp cannot read it or it is not an accepted format. */
export async function measureImage(
  bytes: Uint8Array,
): Promise<Measures | undefined> {
  try {
    const { width, height, format, compression } = await sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
    }).metadata();
    const sharpFormat =
      format === 'heif' && compression === 'av1' ? 'avif' : format;
    const known =
      sharpFormat === undefined ? undefined : FORMAT_OF_SHARP.get(sharpFormat);
    if (!width || !height || known === undefined) return undefined;
    return { width, height, format: known };
  } catch {
    return undefined;
  }
}
