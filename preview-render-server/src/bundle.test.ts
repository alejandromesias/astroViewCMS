import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleIdPattern } from 'preview-contract';
import { afterEach, describe, expect, it } from 'vitest';
import { astroVersion, newBundleId, readSiteCommit } from './bundle.ts';

const HASH = 'a'.repeat(40);

describe('newBundleId', () => {
  it('is a fresh id that the bundle id pattern accepts', () => {
    const id = newBundleId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(bundleIdPattern.test(id)).toBe(true);
    expect(newBundleId()).not.toBe(id);
  });
});

describe('readSiteCommit', () => {
  // A folder outside any git checkout, per test.
  const folders: string[] = [];
  const outsideGit = () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-git-'));
    folders.push(folder);
    return folder;
  };
  afterEach(() => {
    for (const folder of folders.splice(0))
      fs.rmSync(folder, { recursive: true, force: true });
  });

  it('gives null outside a git checkout, with the real git', () => {
    expect(readSiteCommit(outsideGit())).toBeNull();
  });

  it('gives the commit git prints, trimmed, for the folder it runs in', () => {
    const seen: string[] = [];
    const runGit = (cwd: string) => {
      seen.push(cwd);
      return `${HASH}\n`;
    };
    expect(readSiteCommit('/site', runGit)).toBe(HASH);
    expect(seen).toEqual(['/site']);
  });

  it('accepts a SHA-256 commit id, 64 characters long', () => {
    expect(readSiteCommit('/site', () => 'b'.repeat(64))).toBe('b'.repeat(64));
  });

  it.each([
    [
      'git exits with an error',
      () => {
        throw new Error('not a git repository');
      },
    ],
    ['git prints something that is not a commit', () => 'fatal: ambiguous'],
    ['git prints a short id', () => 'abc123'],
    ['git prints uppercase hex', () => 'A'.repeat(40)],
  ])('gives null when %s', (_name, runGit) => {
    expect(readSiteCommit('/site', runGit)).toBeNull();
  });
});

describe('astroVersion', () => {
  it('reads the version of the astro package this build runs with', () => {
    expect(astroVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
