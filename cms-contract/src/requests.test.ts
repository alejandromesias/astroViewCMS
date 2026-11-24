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

  it('keeps a key with a space and with "~", the printable characters at the edges of the control range', () => {
    const body = {
      changes: [{ document: 'posts/a b~', baseRevision: 'r', data: {} }],
    };
    expect(saveRequestSchema.parse(body)).toEqual(body);
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
    [
      'an update with "deleted" false and no data',
      { changes: [{ document: 'a/b', baseRevision: 'r', deleted: false }] },
      'changes.0.data: is needed unless "deleted" is true',
    ],
    [
      'a key with a tab',
      { changes: [{ document: 'a\tb', baseRevision: 'r', data: {} }] },
      'changes.0.document: must not contain control characters',
    ],
    [
      'a key with a NUL character',
      { changes: [{ document: 'a\u0000b', baseRevision: 'r', data: {} }] },
      'changes.0.document: must not contain control characters',
    ],
    [
      'a key with the last control character before the space',
      { changes: [{ document: 'a\u001fb', baseRevision: 'r', data: {} }] },
      'changes.0.document: must not contain control characters',
    ],
    [
      'a key with DEL',
      { changes: [{ document: 'a\u007fb', baseRevision: 'r', data: {} }] },
      'changes.0.document: must not contain control characters',
    ],
    [
      'a document that is a number',
      { changes: [{ document: 1, baseRevision: 'r', data: {} }] },
      'changes.0.document: must be a string',
    ],
    [
      'a delete flag that is text',
      { changes: [{ document: 'a/b', baseRevision: 'r', deleted: 'yes' }] },
      'changes.0.deleted: must be true or false',
    ],
    ['changes that is not a list', { changes: 'x' }, 'changes: must be a list'],
  ])('refuses %s', (_name, body, message) => {
    const result = saveRequestSchema.safeParse(body);
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(`${issue?.path.join('.')}: ${issue?.message}`).toBe(message);
  });

  it('answers a body that is not an object with the body message', () => {
    const result = saveRequestSchema.safeParse(null);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Body must be a JSON object with "changes"',
    );
  });
});

describe('query schemas', () => {
  it('reads a key and a collection, each optional', () => {
    expect(documentsQuerySchema.parse({ key: 'posts/a' })).toEqual({
      key: 'posts/a',
    });
    expect(documentsQuerySchema.parse({ collection: 'posts' })).toEqual({
      collection: 'posts',
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
