import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { pngWithHeader } from '../../test/helpers/png.ts';
import { MAX_PIXELS, measureImage } from './measure.ts';

const solid = (format: 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff') =>
  sharp({
    create: { width: 40, height: 30, channels: 3, background: '#09f' },
  })
    [format]()
    .toBuffer();

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
);

describe('measureImage', () => {
  it('reads width, height and format from the bytes', async () => {
    expect(await measureImage(await solid('png'))).toEqual({
      width: 40,
      height: 30,
      format: 'png',
    });
    expect(await measureImage(await solid('webp'))).toEqual({
      width: 40,
      height: 30,
      format: 'webp',
    });
    expect(await measureImage(await solid('gif'))).toEqual({
      width: 40,
      height: 30,
      format: 'gif',
    });
  });

  it('names JPEG `jpg`, as ImageMetadata does', async () => {
    expect(await measureImage(await solid('jpeg'))).toEqual({
      width: 40,
      height: 30,
      format: 'jpg',
    });
  });

  it('names AVIF `avif`, although sharp reports it as HEIF', async () => {
    expect(await measureImage(await solid('avif'))).toEqual({
      width: 40,
      height: 30,
      format: 'avif',
    });
  });

  it('is undefined for SVG and TIFF, which are not accepted formats', async () => {
    expect(await measureImage(SVG)).toBeUndefined();
    expect(await measureImage(await solid('tiff'))).toBeUndefined();
  });

  it('is undefined for bytes that are not an image, or are empty', async () => {
    expect(await measureImage(Buffer.from('not an image'))).toBeUndefined();
    expect(await measureImage(new Uint8Array(0))).toBeUndefined();
  });

  it('reads the size from a PNG header, without any pixel data', async () => {
    expect(await measureImage(pngWithHeader(10, 10))).toEqual({
      width: 10,
      height: 10,
      format: 'png',
    });
  });

  it('refuses a header whose pixel count is over the limit (a decompression bomb)', async () => {
    expect(await measureImage(pngWithHeader(20000, 20000))).toBeUndefined();
  });

  it('keeps the pixel limit at sharp default, 0x3fff squared', () => {
    expect(MAX_PIXELS).toBe(268402689);
  });
});
