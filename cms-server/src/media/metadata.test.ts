import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { readMedia, recordMedia } from './metadata.ts';

let root: string;
let mediaFile: string;
beforeEach(async () => {
  root = await makeTestRoot();
  mediaFile = path.join(root, '.cms', 'sample-site', 'media.json');
});
afterEach(async () => {
  await removeTestRoot(root);
});

const jpg = { width: 40, height: 30, format: 'jpg' } as const;

describe('readMedia', () => {
  it('reads a missing file as an empty cache', async () => {
    expect(await readMedia(mediaFile)).toEqual(new Map());
  });

  it('rejects a file whose top level is not an object', async () => {
    fs.mkdirSync(path.dirname(mediaFile), { recursive: true });
    for (const text of ['[]', 'null', '"x"']) {
      fs.writeFileSync(mediaFile, text);
      await expect(readMedia(mediaFile)).rejects.toThrow(
        new Error('media.json must be an object'),
      );
    }
  });

  it('names the entry that is not a valid measure', async () => {
    fs.mkdirSync(path.dirname(mediaFile), { recursive: true });
    fs.writeFileSync(
      mediaFile,
      '{"abc": {"width": "40", "height": 30, "format": "jpg"}}',
    );
    await expect(readMedia(mediaFile)).rejects.toThrow(
      new Error('media.json entry abc is not valid'),
    );
  });

  it('refuses a format that is not accepted, such as svg', async () => {
    fs.mkdirSync(path.dirname(mediaFile), { recursive: true });
    fs.writeFileSync(
      mediaFile,
      '{"abc": {"width": 40, "height": 30, "format": "svg"}}',
    );
    await expect(readMedia(mediaFile)).rejects.toThrow(
      new Error('media.json entry abc is not valid'),
    );
  });

  it('reads a __proto__ key as an ordinary entry', async () => {
    fs.mkdirSync(path.dirname(mediaFile), { recursive: true });
    fs.writeFileSync(
      mediaFile,
      '{"__proto__": {"width": 1, "height": 1, "format": "png"}}',
    );
    const entries = await readMedia(mediaFile);
    expect(entries.get('__proto__')).toEqual({
      width: 1,
      height: 1,
      format: 'png',
    });
  });
});

describe('recordMedia', () => {
  it('creates the folder and writes the entry as JSON with a trailing newline', async () => {
    await recordMedia(mediaFile, 'abc', jpg);
    expect(fs.readFileSync(mediaFile, 'utf8')).toBe(
      '{\n  "abc": {\n    "width": 40,\n    "height": 30,\n    "format": "jpg"\n  }\n}\n',
    );
    expect(fs.readdirSync(path.dirname(mediaFile))).toEqual(['media.json']);
  });

  it('keeps the other entries and replaces the one with the same id', async () => {
    await recordMedia(mediaFile, 'abc', jpg);
    await recordMedia(mediaFile, 'def', { width: 1, height: 2, format: 'gif' });
    await recordMedia(mediaFile, 'abc', { width: 9, height: 9, format: 'png' });
    expect(await readMedia(mediaFile)).toEqual(
      new Map([
        ['abc', { width: 9, height: 9, format: 'png' }],
        ['def', { width: 1, height: 2, format: 'gif' }],
      ]),
    );
  });

  it('keeps both entries when two uploads record at the same time', async () => {
    await Promise.all([
      recordMedia(mediaFile, 'abc', jpg),
      recordMedia(mediaFile, 'def', { width: 1, height: 2, format: 'webp' }),
    ]);
    expect((await readMedia(mediaFile)).size).toBe(2);
  });

  it('a failed write does not block the next one', async () => {
    fs.mkdirSync(path.dirname(mediaFile), { recursive: true });
    fs.writeFileSync(mediaFile, '[]');
    await expect(recordMedia(mediaFile, 'abc', jpg)).rejects.toThrow(
      new Error('media.json must be an object'),
    );
    fs.rmSync(mediaFile);
    await recordMedia(mediaFile, 'abc', jpg);
    expect((await readMedia(mediaFile)).get('abc')).toEqual(jpg);
  });
});
