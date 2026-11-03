import { describe, expect, it } from 'vitest';
import {
  documentRecordSchema,
  imagesJsonSchema,
  mintPreviewToken,
  parseRenderRequest,
  previewConfigSchema,
  routeRecordSchema,
  schemaJsonSchema,
  verifyPreviewToken,
} from './index.ts';

describe('the package entry point', () => {
  it('exposes the schemas and the request parser the renderer and cms-server import', () => {
    expect(
      documentRecordSchema.safeParse({
        key: 'data:x.json',
        format: 'json',
        buildTime: false,
        revision: '0123456789abcdef',
      }).success,
    ).toBe(true);
    expect(routeRecordSchema.safeParse({}).success).toBe(false);
    expect(schemaJsonSchema.safeParse({}).success).toBe(true);
    expect(imagesJsonSchema.safeParse([]).success).toBe(true);
    expect(
      previewConfigSchema.safeParse({
        editorOrigins: [],
        bundleId: 'b',
        protocolVersion: 1,
      }).success,
    ).toBe(true);
    expect(parseRenderRequest({ documents: {} })).toEqual({
      ok: true,
      documents: {},
      media: {},
    });
  });

  it('exposes the preview token functions', () => {
    const token = mintPreviewToken({
      secret: 'a-secret-that-is-long-enough-for-tests',
      site: 'sample-site',
      ttlSeconds: 60,
      now: 1_800_000_000,
    });
    expect(
      verifyPreviewToken(token, {
        secret: 'a-secret-that-is-long-enough-for-tests',
        site: 'sample-site',
        now: 1_800_000_001,
      }),
    ).toEqual({ ok: true, exp: 1_800_000_060 });
  });
});
