import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { RENAME_ATTEMPTS, writeFileAtomic } from './atomic.ts';

let root: string;
beforeEach(async () => {
  root = await makeTestRoot();
});
afterEach(async () => {
  await removeTestRoot(root);
});

const codeError = (code: string) => Object.assign(new Error(code), { code });

// A rename that fails with the given codes, in order, and then does the real rename.
function failingRename(codes: string[]) {
  const calls: string[] = [];
  const rename = async (from: string, to: string): Promise<void> => {
    calls.push(from);
    const code = codes[calls.length - 1];
    if (code !== undefined) throw codeError(code);
    await fs.promises.rename(from, to);
  };
  return { rename, calls };
}

const noWait = async (): Promise<void> => undefined;

describe('writeFileAtomic', () => {
  it('writes the content and leaves no temp file behind', async () => {
    const file = path.join(root, 'media.json');
    await writeFileAtomic(file, '{"a":1}\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}\n');
    expect(fs.readdirSync(root)).toEqual(['media.json']);
  });

  it('replaces an existing file in one step', async () => {
    const file = path.join(root, 'media.json');
    fs.writeFileSync(file, 'old');
    await writeFileAtomic(file, new Uint8Array([1, 2, 3]));
    expect(fs.readFileSync(file)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('retries a rename that fails with EPERM or EBUSY, then succeeds', async () => {
    const file = path.join(root, 'media.json');
    const { rename, calls } = failingRename(['EPERM', 'EBUSY']);
    const waits: number[] = [];
    await writeFileAtomic(file, 'ok', {
      rename,
      wait: async (ms) => {
        waits.push(ms);
      },
      delayMs: 7,
    });
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([7, 7]);
    expect(fs.readFileSync(file, 'utf8')).toBe('ok');
    expect(fs.readdirSync(root)).toEqual(['media.json']);
  });

  it('gives up after the attempts with the last error and removes the temp file', async () => {
    const file = path.join(root, 'media.json');
    const { rename, calls } = failingRename(
      Array.from({ length: RENAME_ATTEMPTS }, () => 'EBUSY'),
    );
    await expect(
      writeFileAtomic(file, 'x', { rename, wait: noWait }),
    ).rejects.toMatchObject({ code: 'EBUSY', message: 'EBUSY' });
    expect(calls).toHaveLength(RENAME_ATTEMPTS);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('does not retry other rename errors', async () => {
    const file = path.join(root, 'media.json');
    const { rename, calls } = failingRename(['ENOENT']);
    await expect(
      writeFileAtomic(file, 'x', { rename, wait: noWait }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(calls).toHaveLength(1);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('leaves the target untouched when the write itself fails', async () => {
    const file = path.join(root, 'missing-folder', 'media.json');
    await expect(writeFileAtomic(file, 'x')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('waits between retries with the real timer when no wait is injected', async () => {
    const file = path.join(root, 'media.json');
    const { rename, calls } = failingRename(['EBUSY']);
    await writeFileAtomic(file, 'ok', { rename, delayMs: 1 });
    expect(calls).toHaveLength(2);
    expect(fs.readFileSync(file, 'utf8')).toBe('ok');
    expect(fs.readdirSync(root)).toEqual(['media.json']);
  });

  it('throws the rename error, not the cleanup error, when the temp file cannot be removed', async () => {
    const file = path.join(root, 'media.json');
    let temp = '';
    // Turns the temp file into a folder, so the removal in the cleanup fails.
    const rename = async (from: string): Promise<void> => {
      temp = from;
      fs.rmSync(from);
      fs.mkdirSync(from);
      throw codeError('ENOENT');
    };
    await expect(
      writeFileAtomic(file, 'x', { rename, wait: noWait }),
    ).rejects.toMatchObject({ code: 'ENOENT', message: 'ENOENT' });
    expect(fs.readdirSync(root)).toEqual([path.basename(temp)]);
    expect(fs.statSync(temp).isDirectory()).toBe(true);
  });
});
