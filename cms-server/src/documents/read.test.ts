import { rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  removeWorkingCopies,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import { jsonCodec } from '../codecs/json.ts';
import { CodecError } from '../codecs/types.ts';
import {
  entriesOf,
  entryOf,
  type FileRead,
  type FileReads,
  readFileOnce,
} from './read.ts';

afterEach(async () => {
  vi.restoreAllMocks();
  await removeWorkingCopies();
});

/** The file read at `file`, failing the test when it is missing. */
async function readOf(
  root: string,
  file: string,
  format: 'json' | 'md' | 'toml' = 'json',
  reads: FileReads = new Map(),
): Promise<FileRead> {
  const read = await readFileOnce(root, file, format, reads);
  if (read === null) throw new Error(`no read of ${file}`);
  return read;
}

describe('readFileOnce', () => {
  it('reads the bytes of a file under the root', async () => {
    const root = await tempWorkingCopy({ 'src/a.json': '{"a":1}' });
    const read = await readOf(root, 'src/a.json');
    expect(Buffer.from(read.bytes).toString('utf8')).toBe('{"a":1}');
  });

  it('resolves null for a file that is missing', async () => {
    const root = await tempWorkingCopy({ 'src/a.json': '{}' });
    expect(
      await readFileOnce(root, 'src/gone.json', 'json', new Map()),
    ).toBeNull();
  });

  it('resolves null for a path that leaves the root, and for the root itself, and remembers none of them', async () => {
    const root = await tempWorkingCopy({ 'ok.json': '{}' });
    const outside = await tempWorkingCopy({ 'secret.json': '{"secret":true}' });
    const relativeOutside = `${relative(root, outside)}/secret.json`;
    const reads: FileReads = new Map();
    for (const file of [
      join(outside, 'secret.json'),
      relativeOutside,
      '..',
      '',
    ]) {
      expect(await readFileOnce(root, file, 'json', reads)).toBeNull();
    }
    expect(reads.size).toBe(0);
  });

  it('resolves null for a folder in the root that links to a folder outside it', async () => {
    const root = await tempWorkingCopy({ 'ok.json': '{}' });
    const outside = await tempWorkingCopy({ 'secret.json': '{"secret":true}' });
    // A junction is a Windows folder link that needs no privilege, so this check runs on every account.
    await symlink(outside, join(root, 'linked'), 'junction');
    expect(
      await readFileOnce(root, 'linked/secret.json', 'json', new Map()),
    ).toBeNull();
  });

  it('throws a read error that is not a missing file, such as a folder read as a file', async () => {
    const root = await tempWorkingCopy({ 'src/a.json': '{}' });
    await expect(
      readFileOnce(root, 'src', 'json', new Map()),
    ).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('resolves null for a symlink in the root that points outside it', async (ctx) => {
    const root = await tempWorkingCopy({ 'ok.json': '{}' });
    const outside = await tempWorkingCopy({ 'secret.json': '{"secret":true}' });
    try {
      await symlink(
        join(outside, 'secret.json'),
        join(root, 'link.json'),
        'file',
      );
    } catch (error) {
      // Creating a symlink needs a privilege some Windows accounts lack; the check cannot run there.
      // On CI the privilege is there, so a refusal is a failure, not a skip (WORKPLAN 2.1k).
      if (
        !process.env.CI &&
        error instanceof Error &&
        'code' in error &&
        error.code === 'EPERM'
      )
        return ctx.skip();
      throw error;
    }
    expect(await readFileOnce(root, 'link.json', 'json', new Map())).toBeNull();
  });

  it('reads a file once per request: a later read gives the same read, even after the file is gone', async () => {
    const root = await tempWorkingCopy({ 'a.json': '{"n":1}' });
    const reads: FileReads = new Map();
    const first = await readFileOnce(root, 'a.json', 'json', reads);
    await rm(join(root, 'a.json'));
    const second = await readFileOnce(root, 'a.json', 'json', reads);
    expect(second).toBe(first);
    expect(second).not.toBeNull();
  });

  it('remembers a missing file for the request too', async () => {
    const root = await tempWorkingCopy({});
    const reads: FileReads = new Map();
    expect(await readFileOnce(root, 'a.json', 'json', reads)).toBeNull();
    await writeFile(join(root, 'a.json'), '{}');
    expect(await readFileOnce(root, 'a.json', 'json', reads)).toBeNull();
  });
});

describe('FileRead.parse', () => {
  it('parses the bytes with the codec of the format', async () => {
    const root = await tempWorkingCopy({ 'a.json': '{"a":[1,2]}' });
    const outcome = (await readOf(root, 'a.json')).parse();
    expect(outcome).toEqual({ value: { a: [1, 2] } });
  });

  it('decodes the bytes as UTF-8', async () => {
    const root = await tempWorkingCopy({
      'post.md': '---\ntitle: Café\n---\nBody\n',
    });
    const outcome = (await readOf(root, 'post.md', 'md')).parse();
    expect(outcome).toEqual({
      value: { data: { title: 'Café' }, body: 'Body\n' },
    });
  });

  it('gives the CodecError of a file that does not parse, with its position', async () => {
    const root = await tempWorkingCopy({ 'a.json': '{\n  "a": 1,,\n}' });
    const outcome = (await readOf(root, 'a.json')).parse();
    expect(outcome).toHaveProperty('error');
    if (outcome === null || !('error' in outcome)) throw new Error('no error');
    expect(outcome.error).toBeInstanceOf(CodecError);
    expect(outcome.error.message).toBe(
      'Invalid JSON at line 2, column 10: PropertyNameExpected',
    );
    expect(outcome.error.line).toBe(2);
    expect(outcome.error.column).toBe(10);
  });

  it('keeps a byte-order mark in the text, so JSON that starts with one is an error', async () => {
    const root = await tempWorkingCopy({});
    await writeFile(join(root, 'a.json'), Buffer.from('﻿{"a":1}', 'utf8'));
    const outcome = (await readOf(root, 'a.json')).parse();
    if (outcome === null || !('error' in outcome)) throw new Error('no error');
    expect(outcome.error.message).toBe(
      'Invalid JSON at line 1, column 1: InvalidSymbol',
    );
  });

  it('keeps the same outcome for every call', async () => {
    const root = await tempWorkingCopy({ 'a.json': '{"a":1}' });
    const read = await readOf(root, 'a.json');
    expect(read.parse()).toBe(read.parse());
  });

  it('gives null for a format with no codec', async () => {
    const root = await tempWorkingCopy({ 'rules.toml': 'a = 1\n' });
    const read = await readOf(root, 'rules.toml', 'toml');
    expect(read.parse()).toBeNull();
  });

  it('lets an error that is not a CodecError through, rather than taking it for a bad file', async () => {
    const root = await tempWorkingCopy({ 'a.json': '{}' });
    const read = await readOf(root, 'a.json');
    const failure = new TypeError('codec bug');
    vi.spyOn(jsonCodec, 'parse').mockImplementation(() => {
      throw failure;
    });
    expect(() => read.parse()).toThrow(failure);
  });
});

describe('entryOf', () => {
  it('finds an array entry by its id', () => {
    const items = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
    ];
    expect(entryOf(items, 'b')).toEqual({ id: 'b', v: 2 });
  });

  it('finds an array entry by its slug when it has no id, and by the slug when the id is null', () => {
    expect(entryOf([{ slug: 's1', v: 1 }], 's1')).toEqual({ slug: 's1', v: 1 });
    const nullId = [{ id: null, slug: 's2', v: 2 }];
    expect(entryOf(nullId, 's2')).toEqual({ id: null, slug: 's2', v: 2 });
    expect(entryOf(nullId, 'null')).toBeUndefined();
  });

  it('compares an id that is a number as its text', () => {
    expect(entryOf([{ id: 7, v: 'seven' }], '7')).toEqual({
      id: 7,
      v: 'seven',
    });
  });

  it('skips items that are not objects or have no id, and takes the first of several with one id', () => {
    const items = [
      null,
      5,
      'a',
      ['a'],
      { v: 'no id' },
      { id: 'a', v: 1 },
      { id: 'a', v: 2 },
    ];
    expect(entryOf(items, 'a')).toEqual({ id: 'a', v: 1 });
    expect(entryOf(items, '')).toBeUndefined();
  });

  it('finds an own property of an object, also one whose value is falsy', () => {
    const file = { a: null, b: 0, c: '', d: false };
    expect(entryOf(file, 'a')).toBeNull();
    expect(entryOf(file, 'b')).toBe(0);
    expect(entryOf(file, 'c')).toBe('');
    expect(entryOf(file, 'd')).toBe(false);
  });

  it('does not find inherited members, but finds an own __proto__ key', () => {
    expect(entryOf({}, 'toString')).toBeUndefined();
    expect(entryOf({}, 'constructor')).toBeUndefined();
    expect(entryOf({}, '__proto__')).toBeUndefined();
    expect(entryOf(JSON.parse('{"__proto__": 1}'), '__proto__')).toBe(1);
  });

  it('finds nothing in a value that is neither an array nor an object', () => {
    expect(entryOf(null, 'a')).toBeUndefined();
    expect(entryOf(5, 'a')).toBeUndefined();
    expect(entryOf('text', 'length')).toBeUndefined();
  });
});

describe('entriesOf', () => {
  it('maps the items of an array by their id, or by their slug when they have no id', () => {
    expect(
      entriesOf([
        { id: 'a', v: 1 },
        { slug: 'b', v: 2 },
      ]),
    ).toStrictEqual(
      new Map<string, unknown>([
        ['a', { id: 'a', v: 1 }],
        ['b', { slug: 'b', v: 2 }],
      ]),
    );
  });

  it('skips items that are not objects, and items whose id and slug are missing or null', () => {
    const items = [
      null,
      5,
      'a',
      ['a'],
      { v: 'no id' },
      { id: null, v: 'null id' },
      { id: null, slug: null, v: 'null slug' },
      { id: 0, v: 'zero' },
    ];
    expect([...entriesOf(items).keys()]).toStrictEqual(['0']);
  });

  it('keeps the first of several items with one id', () => {
    const entries = entriesOf([
      { id: 'a', v: 1 },
      { id: 'a', v: 2 },
    ]);
    expect(entries).toStrictEqual(new Map([['a', { id: 'a', v: 1 }]]));
  });

  it('keys the members of an object by their names, except $schema', () => {
    expect(
      entriesOf({ $schema: './schema.json', a: { v: 1 }, b: null }),
    ).toStrictEqual(
      new Map<string, unknown>([
        ['a', { v: 1 }],
        ['b', null],
      ]),
    );
  });

  it('keeps an own __proto__ member of an object as an entry', () => {
    expect(entriesOf(JSON.parse('{"__proto__": 1}')).get('__proto__')).toBe(1);
  });

  it('finds no entries in a value that is neither an array nor an object', () => {
    expect(entriesOf(null)).toStrictEqual(new Map());
    expect(entriesOf(5)).toStrictEqual(new Map());
    expect(entriesOf('text')).toStrictEqual(new Map());
  });
});
