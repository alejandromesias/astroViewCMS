import { beforeEach, describe, expect, it, vi } from 'vitest';
import { measureImage } from './media-route.ts';

// sharp is replaced here so that the metadata can be anything. (A plain
// function rather than vi.fn(): Vitest reports an error thrown inside a mock
// as a failure of the test even when the code under test catches it.)
const state = vi.hoisted(() => ({
  result: undefined as unknown,
  error: undefined as Error | undefined,
}));
vi.mock('sharp', () => ({
  default: () => ({
    metadata: async () => {
      if (state.error) throw state.error;
      return state.result;
    },
  }),
}));

describe('measureImage with the metadata that sharp reports', () => {
  beforeEach(() => {
    state.result = undefined;
    state.error = undefined;
  });
  const bytes = new Uint8Array([1]);

  it('gives width, height and format', async () => {
    state.result = { width: 10, height: 20, format: 'png' };
    expect(await measureImage(bytes)).toEqual({
      width: 10,
      height: 20,
      format: 'png',
    });
  });

  it('renames jpeg to jpg and keeps every other format as it is', async () => {
    state.result = { width: 1, height: 1, format: 'jpeg' };
    expect((await measureImage(bytes))?.format).toBe('jpg');
    state.result = { width: 1, height: 1, format: 'heif' };
    expect((await measureImage(bytes))?.format).toBe('heif');
  });

  it.each([
    ['width', { height: 1, format: 'png' }],
    ['height', { width: 1, format: 'png' }],
    ['format', { width: 1, height: 1 }],
    ['a zero width', { width: 0, height: 1, format: 'png' }],
    ['a zero height', { width: 1, height: 0, format: 'png' }],
    ['an empty format', { width: 1, height: 1, format: '' }],
  ])('is undefined without %s', async (_name, result) => {
    state.result = result;
    expect(await measureImage(bytes)).toBeUndefined();
  });

  it('is undefined when sharp throws', async () => {
    state.error = new Error('unsupported image format');
    expect(await measureImage(bytes)).toBeUndefined();
  });
});
