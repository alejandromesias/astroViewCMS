import { describe, expect, it } from 'vitest';
import {
  documentsQuerySchema,
  previewUrlQuerySchema,
  saveRequestSchema,
} from './requests.ts';

describe('saveRequestSchema', () => {
  it('accepts an update, a create and a delete', () => {
    const body = {
      changes: [
        { document: 'posts/a', baseRevision: 'r1', data: { title: 'A' } },
        { document: 'posts/b', baseRevision: null, data: {} },
        { document: 'posts/c', baseRevision: 'r2', deleted: true },
      ],
    };
    expect(saveRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['an empty list', { changes: [] }, 'changes: must not be empty'],
    [
      'a key with a line break',
      { changes: [{ document: 'a\nb', baseRevision: 'r', data: {} }] },
      'changes.0.document: must not contain control characters',
    ],
    [
      'an empty key',
      { changes: [{ document: '', baseRevision: 'r', data: {} }] },
      'changes.0.document: must not be empty',
    ],
    [
      'a base revision that is a number',
      { changes: [{ document: 'a/b', baseRevision: 1, data: {} }] },
      'changes.0.baseRevision: must be a string or null',
    ],
    [
      'an update without data',
      { changes: [{ document: 'a/b', baseRevision: 'r' }] },
      'changes.0.data: is needed unless "deleted" is true',
    ],
  ])('refuses %s', (_name, body, message) => {
    const result = saveRequestSchema.safeParse(body);
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(`${issue?.path.join('.')}: ${issue?.message}`).toBe(message);
  });
});

describe('query schemas', () => {
  it('reads a key and a collection, each optional', () => {
    expect(documentsQuerySchema.parse({ key: 'posts/a' })).toEqual({
      key: 'posts/a',
    });
    expect(documentsQuerySchema.parse({})).toEqual({});
  });

  it('needs a path for the preview URL', () => {
    expect(previewUrlQuerySchema.safeParse({}).success).toBe(false);
    expect(previewUrlQuerySchema.parse({ path: '/about' })).toEqual({
      path: '/about',
    });
  });
});
