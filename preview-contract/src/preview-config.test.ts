import { describe, expect, it } from 'vitest';
import { previewConfigSchema } from './preview-config.ts';

describe('previewConfigSchema', () => {
  it('parses the full answer of a bundle with a bundle.json', () => {
    const answer = {
      editorOrigins: ['https://editor.example', 'http://localhost:3000'],
      bundleId: 'b-2026-11-02',
      protocolVersion: 3,
    };
    expect(previewConfigSchema.parse(answer)).toEqual(answer);
  });

  it('parses the nulls of a bundle without a bundle.json', () => {
    expect(
      previewConfigSchema.parse({
        editorOrigins: [],
        bundleId: null,
        protocolVersion: null,
      }),
    ).toEqual({ editorOrigins: [], bundleId: null, protocolVersion: null });
  });

  it('drops keys it does not know instead of refusing them', () => {
    expect(
      previewConfigSchema.parse({
        editorOrigins: [],
        bundleId: 'x',
        protocolVersion: 1,
        extra: true,
      }),
    ).toEqual({ editorOrigins: [], bundleId: 'x', protocolVersion: 1 });
  });

  it.each([
    ['no editorOrigins', { bundleId: 'x', protocolVersion: 1 }],
    [
      'editorOrigins not an array',
      { editorOrigins: 'https://a.test', bundleId: 'x', protocolVersion: 1 },
    ],
    ['no bundleId key', { editorOrigins: [], protocolVersion: 1 }],
    [
      'a numeric bundleId',
      { editorOrigins: [], bundleId: 7, protocolVersion: 1 },
    ],
    [
      'protocolVersion zero',
      { editorOrigins: [], bundleId: 'x', protocolVersion: 0 },
    ],
    [
      'protocolVersion not an integer',
      { editorOrigins: [], bundleId: 'x', protocolVersion: 1.5 },
    ],
    ['null', null],
  ])('refuses %s', (_label, answer) => {
    expect(previewConfigSchema.safeParse(answer).success).toBe(false);
  });
});
