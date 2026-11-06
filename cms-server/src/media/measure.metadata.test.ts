import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PIXELS, measureImage } from './measure.ts';

// What sharp's `metadata()` answers, set per test. The real sharp cannot be made to report a HEIF that is not AV1,
// or an image with no size, so these cases fake it. The real-image cases are in measure.test.ts.
const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  sharp: vi.fn(),
}));

vi.mock('sharp', () => ({ default: mocks.sharp }));

beforeEach(() => {
  mocks.metadata.mockReset();
  mocks.sharp.mockReset();
  mocks.sharp.mockImplementation(() => ({ metadata: mocks.metadata }));
});

const reads = (metadata: Record<string, unknown>) =>
  mocks.metadata.mockResolvedValue(metadata);

describe('measureImage over the metadata sharp reports', () => {
  it('asks sharp to decode no more than MAX_PIXELS', async () => {
    reads({ width: 4, height: 3, format: 'png' });
    const bytes = new Uint8Array([1, 2, 3]);
    await measureImage(bytes);
    expect(mocks.sharp).toHaveBeenCalledExactlyOnceWith(bytes, {
      limitInputPixels: MAX_PIXELS,
    });
  });

  it('takes a HEIF with AV1 compression for AVIF', async () => {
    reads({ width: 4, height: 3, format: 'heif', compression: 'av1' });
    expect(await measureImage(new Uint8Array(1))).toEqual({
      width: 4,
      height: 3,
      format: 'avif',
    });
  });

  it('refuses a HEIF that is not AV1, such as HEIC', async () => {
    reads({ width: 4, height: 3, format: 'heif', compression: 'hevc' });
    expect(await measureImage(new Uint8Array(1))).toBeUndefined();
    reads({ width: 4, height: 3, format: 'heif' });
    expect(await measureImage(new Uint8Array(1))).toBeUndefined();
  });

  it('refuses an AV1 compression on a format that is not HEIF', async () => {
    reads({ width: 4, height: 3, format: 'tiff', compression: 'av1' });
    expect(await measureImage(new Uint8Array(1))).toBeUndefined();
  });

  it('refuses an image with no format, no width or no height', async () => {
    reads({ width: 4, height: 3 });
    expect(await measureImage(new Uint8Array(1))).toBeUndefined();
    reads({ height: 3, format: 'png' });
    expect(await measureImage(new Uint8Array(1))).toBeUndefined();
    reads({ width: 4, format: 'png' });
    expect(await measureImage(new Uint8Array(1))).toBeUndefined();
    reads({ width: 0, height: 3, format: 'png' });
    expect(await measureImage(new Uint8Array(1))).toBeUndefined();
    reads({ width: 4, height: 0, format: 'png' });
    expect(await measureImage(new Uint8Array(1))).toBeUndefined();
  });

  it('is undefined when sharp throws', async () => {
    mocks.metadata.mockRejectedValue(new Error('corrupt'));
    expect(await measureImage(new Uint8Array(1))).toBeUndefined();
  });
});
