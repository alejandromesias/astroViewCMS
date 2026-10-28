import { describe, expect, it } from 'vitest';
import { isMediaMetadata, MEDIA_TAG, mediaMetadata } from './media.ts';

describe('mediaMetadata', () => {
  it('maps the entry to ImageMetadata, tagged', () => {
    const metadata = mediaMetadata({ url: '/m/a.png', width: 640, height: 480, format: 'png' });
    expect(metadata).toEqual({ src: '/m/a.png', width: 640, height: 480, format: 'png', [MEDIA_TAG]: true });
    expect(metadata[MEDIA_TAG]).toBe(true);
  });

  it('uses a symbol that other copies of the module share', () => {
    expect(Symbol.keyFor(MEDIA_TAG)).toBe('preview-render-server.media-map');
  });
});

describe('isMediaMetadata', () => {
  it('is true for tagged metadata, also for one tagged by another copy of the module', () => {
    expect(isMediaMetadata(mediaMetadata({ url: '/a.png', width: 1, height: 1, format: 'png' }))).toBe(true);
    expect(isMediaMetadata({ [Symbol.for('preview-render-server.media-map')]: true })).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
    ['a number', 1],
    ['true', true],
    ['an untagged object', { src: '/a.png', width: 1, height: 1, format: 'png' }],
    ['an object tagged false', { [MEDIA_TAG]: false }],
    ['an object tagged with a truthy non-true value', { [MEDIA_TAG]: 'true' }],
    ['a function carrying the tag', Object.assign(() => 1, { [MEDIA_TAG]: true })],
  ])('is false for %s', (_name, value) => {
    expect(isMediaMetadata(value)).toBe(false);
  });
});
