import { rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  removeWorkingCopies,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import { CodecError } from '../codecs/types.ts';
import {
  entryOf,
  type FileRead,
  type FileReads,
  readFileOnce,
} from './read.ts';

afterEach(() => removeWorkingCopies());

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

  it('resolves null for a path that leaves the root, and for the root itself', async () => {
    const root = await tempWorkingCopy({ 'ok.json': '{}' });
    const outside = await tempWorkingCopy({ 'secret.json': '{"secret":true}' });
    const relativeOutside = `${relative(root, outside)}/secret.json`;
    for (const file of [
      join(outside, 'secret.json'),
      relativeOutside,
      '..',
      '',
    ]) {
      expect(await readFileOnce(root, file, 'json', new Map())).toBeNull();
    }
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
      if (error instanceof Error && 'code' in error && error.code === 'EPERM')
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
