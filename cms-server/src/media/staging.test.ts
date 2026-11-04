import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { readStaged, stagedFormat, stageImage } from './staging.ts';

let root: string;
let stagingDir: string;
beforeEach(async () => {
  root = await makeTestRoot();
  stagingDir = path.join(root, '.cms', 'sample-site', 'staging');
});
afterEach(async () => {
  await removeTestRoot(root);
});

// SHA-256 of the three bytes "abc" (FIPS 180 test vector).
const ABC_SHA256 =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('readStaged: a read error', () => {
  it('throws an error that is not a missing file, such as a folder under a staged name', async () => {
    const name = `${ABC_SHA256}.png`;
    fs.mkdirSync(path.join(stagingDir, name), { recursive: true });
    await expect(readStaged(stagingDir, name)).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });
});

describe('stageImage', () => {
  it('names the file by its sha256 and the format, and returns the id and name', async () => {
    const result = await stageImage(stagingDir, Buffer.from('abc'), 'png');
    expect(result).toEqual({
      id: ABC_SHA256,
      name: `${ABC_SHA256}.png`,
    });
    expect(
      fs.readFileSync(path.join(stagingDir, `${ABC_SHA256}.png`), 'utf8'),
    ).toBe('abc');
  });

  it('stores the same image once, under the same name', async () => {
    await stageImage(stagingDir, Buffer.from('abc'), 'jpg');
    await stageImage(stagingDir, Buffer.from('abc'), 'jpg');
    expect(fs.readdirSync(stagingDir)).toEqual([`${ABC_SHA256}.jpg`]);
  });
});

describe('stagedFormat', () => {
  it.each([['png'], ['jpg'], ['webp'], ['avif'], ['gif']])(
    'reads a %s name',
    (format) => {
      expect(stagedFormat(`${ABC_SHA256}.${format}`)).toBe(format);
    },
  );

  it.each([
    `${ABC_SHA256.slice(1)}.png`,
    `${ABC_SHA256}0.png`,
    `${ABC_SHA256.toUpperCase()}.png`,
    `x${ABC_SHA256}.png`,
    `${ABC_SHA256}.jpeg`,
    `${ABC_SHA256}.svg`,
    `${ABC_SHA256}.PNG`,
    `${ABC_SHA256}.png.bak`,
    `${ABC_SHA256}.png `,
    `${ABC_SHA256}.png\n`,
    `${ABC_SHA256}.`,
    ABC_SHA256,
    `${ABC_SHA256}pn`,
    `../${ABC_SHA256}.png`,
    `a/${ABC_SHA256}.png`,
    '',
  ])('refuses the near-miss name %j', (name) => {
    expect(stagedFormat(name)).toBeUndefined();
  });
});

describe('readStaged', () => {
  it('returns the bytes of a staged file', async () => {
    const { name } = await stageImage(stagingDir, Buffer.from('abc'), 'png');
    expect(
      Buffer.from((await readStaged(stagingDir, name)) ?? []).toString(),
    ).toBe('abc');
  });

  it('returns undefined for a well-formed name that is not stored', async () => {
    expect(await readStaged(stagingDir, `${ABC_SHA256}.png`)).toBeUndefined();
  });

  it('returns undefined for a name that is not a staged name, even when that file exists', async () => {
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, `x${ABC_SHA256}.png`), 'abc');
    fs.writeFileSync(path.join(root, 'outside.png'), 'secret');
    expect(await readStaged(stagingDir, `x${ABC_SHA256}.png`)).toBeUndefined();
    expect(await readStaged(stagingDir, '../outside.png')).toBeUndefined();
  });
});
