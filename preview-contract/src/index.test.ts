import { describe, expect, it } from 'vitest';
import {
  documentRecordSchema,
  parseRenderRequest,
  routeRecordSchema,
  schemaJsonSchema,
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
    expect(parseRenderRequest({ documents: {} })).toEqual({
      ok: true,
      documents: {},
      media: {},
    });
  });
});
