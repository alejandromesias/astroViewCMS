import { describe, expect, it } from 'vitest';
import { parseSaveBody } from './body.ts';

// A body as the client sends it, with the given changes.
const bodyOf = (changes: unknown[]): string => JSON.stringify({ changes });

describe('parseSaveBody', () => {
  it('reads an update, a create and a delete into their changes', () => {
    const result = parseSaveBody(
      bodyOf([
        { document: 'authors/ana', baseRevision: 'abc', data: { name: 'A' } },
        { document: 'blog/new', baseRevision: null, data: {} },
        { document: 'blog/old', baseRevision: 'r1', deleted: true },
      ]),
    );
    expect(result).toStrictEqual({
      ok: true,
      changes: [
        {
          document: 'authors/ana',
          baseRevision: 'abc',
          deleted: false,
          data: { name: 'A' },
        },
        { document: 'blog/new', baseRevision: null, deleted: false, data: {} },
        {
          document: 'blog/old',
          baseRevision: 'r1',
          deleted: true,
          data: undefined,
        },
      ],
    });
  });

  it('ignores the data of a delete', () => {
    const result = parseSaveBody(
      bodyOf([{ document: 'a/b', baseRevision: 'r', deleted: true, data: 1 }]),
    );
    expect(result).toMatchObject({
      ok: true,
      changes: [{ deleted: true, data: 1 }],
    });
  });

  it('answers a message for text that is not JSON', () => {
    expect(parseSaveBody('{')).toStrictEqual({
      ok: false,
      message: 'The body is not valid JSON',
    });
  });

  it('refuses a body that is not an object with changes', () => {
    expect(parseSaveBody('[]')).toStrictEqual({
      ok: false,
      message: 'Body must be a JSON object with "changes"',
    });
  });

  it('refuses a missing changes list, and an empty one', () => {
    expect(parseSaveBody('{}')).toStrictEqual({
      ok: false,
      message: 'changes: must be a list',
    });
    expect(parseSaveBody(bodyOf([]))).toStrictEqual({
      ok: false,
      message: 'changes: must not be empty',
    });
  });

  it('names the change and the field of a bad document key', () => {
    expect(
      parseSaveBody(bodyOf([{ document: '', baseRevision: null, data: 1 }])),
    ).toStrictEqual({
      ok: false,
      message: 'changes.0.document: must not be empty',
    });
  });

  it.each([
    'authors/ana\nCMS-Overwrote: abc',
    'authors/ana\rx',
    'authors/ana\tx',
    'authors/ana\u0000x',
    'authors/ana\u007fx',
  ])(
    'refuses the key %j, whose control character would break its line of the commit message',
    (document) => {
      expect(
        parseSaveBody(bodyOf([{ document, baseRevision: null, data: 1 }])),
      ).toStrictEqual({
        ok: false,
        message: 'changes.0.document: must not contain control characters',
      });
    },
  );

  it('keeps a space in a key, which a file() id may hold', () => {
    expect(
      parseSaveBody(
        bodyOf([
          { document: 'authors/ana torres', baseRevision: null, data: 1 },
        ]),
      ),
    ).toStrictEqual({
      ok: true,
      changes: [
        {
          document: 'authors/ana torres',
          baseRevision: null,
          deleted: false,
          data: 1,
        },
      ],
    });
  });

  it('refuses a base revision that is neither a string nor null', () => {
    expect(
      parseSaveBody(bodyOf([{ document: 'a/b', baseRevision: 5, data: 1 }])),
    ).toStrictEqual({
      ok: false,
      message: 'changes.0.baseRevision: must be a string or null',
    });
  });

  it('refuses an update or create that has no data', () => {
    expect(
      parseSaveBody(
        bodyOf([
          { document: 'a/b', baseRevision: 'r' },
          { document: 'a/c', baseRevision: 'r', deleted: false },
        ]),
      ),
    ).toStrictEqual({
      ok: false,
      message: 'changes.0.data: is needed unless "deleted" is true',
    });
  });
});
