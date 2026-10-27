import type { ImageMetadata } from 'astro';
import type { MediaEntry } from './context.ts';

/** Marks ImageMetadata built from a media-map entry (D12). The preview's image
 *  service passes tagged images through unchanged, so their `src` (a URL chosen
 *  by whoever sent the request) never reaches Astro's `/_image` optimizer. */
export const MEDIA_TAG = Symbol.for('preview-render-server.media-map');

export type TaggedImageMetadata = ImageMetadata & { [MEDIA_TAG]: true };

/** ImageMetadata for a media-map entry, tagged. */
export function mediaMetadata(entry: MediaEntry): TaggedImageMetadata {
  return {
    src: entry.url,
    width: entry.width,
    height: entry.height,
    format: entry.format as ImageMetadata['format'],
    [MEDIA_TAG]: true,
  };
}

export function isMediaMetadata(value: unknown): value is TaggedImageMetadata {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[MEDIA_TAG] === true;
}
