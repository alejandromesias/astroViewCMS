import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundleFolder,
  FIXTURE_BUNDLE,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import { directoryBundleSource } from './source.ts';

afterEach(() => removeBundleFolders());

describe('directoryBundleSource', () => {
  it('names the folder and the parsed bundle.json of the fixture', async () => {
    expect(await directoryBundleSource(FIXTURE_BUNDLE).current()).toEqual({
      dir: FIXTURE_BUNDLE,
      identity: {
        bundleId: 'fixture-2026-11-03',
        siteCommit: '4523c67c55284f8bd3ae1b61caa6d5501ccc77ab',
        protocolVersion: 2,
        astroVersion: '7.4.2',
        builtAt: '2026-11-04T03:42:22.323Z',
      },
    });
  });

  it('has no bundle in a folder without bundle.json, or in a folder that does not exist', async () => {
    const dir = await bundleFolder({ 'bundle.json': null });
    expect(await directoryBundleSource(dir).current()).toBeNull();
    expect(
      await directoryBundleSource(join(dir, 'missing-folder')).current(),
    ).toBeNull();
  });

  it('sees a rebuilt bundle.json in the same folder on the next call', async () => {
    const dir = await bundleFolder();
    const source = directoryBundleSource(dir);
    expect((await source.current())?.identity.bundleId).toBe(
      'fixture-2026-11-03',
    );
    await writeFile(
      join(dir, 'bundle.json'),
      JSON.stringify({
        bundleId: 'second-build',
        siteCommit: null,
        protocolVersion: 2,
        astroVersion: '7.4.2',
        builtAt: '2026-11-02T09:00:00.000Z',
      }),
    );
    expect((await source.current())?.identity.bundleId).toBe('second-build');
  });

  it.each([
    ['bundle.json is not JSON', '{', 'bundle.json: is not valid JSON'],
    [
      'bundleId is ".."',
      '{"bundleId":"..","siteCommit":null,"protocolVersion":2,"astroVersion":"7.4.2","builtAt":"2026-11-01T10:00:00.000Z"}',
      'bundle.json at bundleId: Invalid string: must match pattern /^[A-Za-z0-9][\\w.-]*$/',
    ],
    [
      'builtAt is a date without a time',
      '{"bundleId":"b1","siteCommit":null,"protocolVersion":2,"astroVersion":"7.4.2","builtAt":"2026-11-01"}',
      'bundle.json at builtAt: Invalid ISO datetime',
    ],
    [
      'a key is unknown',
      '{"bundleId":"b1","siteCommit":null,"protocolVersion":2,"astroVersion":"7.4.2","builtAt":"2026-11-01T10:00:00.000Z","extra":true}',
      'bundle.json: Unrecognized key: "extra"',
    ],
  ])('refuses bundle.json where %s', async (_name, text, message) => {
    const dir = await bundleFolder({ 'bundle.json': text });
    await expect(directoryBundleSource(dir).current()).rejects.toMatchObject({
      name: 'BundleError',
      message,
    });
  });
});
