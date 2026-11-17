import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { bundleIdPattern } from 'preview-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { astroVersion, newBundleId, readSiteCommit } from './bundle.ts';

// createRequire is wrapped, not replaced: the default still reads the real astro package.
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return { ...actual, createRequire: vi.fn(actual.createRequire) };
});

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
  // A fresh folder per test, in the OS temp folder (outside any git checkout).
  const folders: string[] = [];
  const tempFolder = () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-git-'));
    folders.push(folder);
    return folder;
  };
  afterEach(() => {
    for (const folder of folders.splice(0))
      fs.rmSync(folder, { recursive: true, force: true });
  });

  it('gives null outside a git checkout, with the real git', () => {
    expect(readSiteCommit(tempFolder())).toBeNull();
  });

  it('reads HEAD with the real git when no runGit is given', () => {
    const folder = tempFolder();
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: folder, encoding: 'utf8' }).trim();
    git('init', '-q');
    git(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'init',
    );
    expect(readSiteCommit(folder)).toBe(git('rev-parse', 'HEAD'));
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
      '40 characters that use every hex digit',
      '0123456789abcdef0123456789abcdef01234567',
    ],
    ['64 characters of f', 'f'.repeat(64)],
  ])('accepts a commit id of %s', (_name, commit) => {
    expect(readSiteCommit('/site', () => `${commit}\n`)).toBe(commit);
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
    ['git prints 39 hex digits', () => 'a'.repeat(39)],
    ['git prints 65 hex digits', () => 'a'.repeat(65)],
    ['the id has a letter after it', () => `${HASH}z`],
    ['the id has a word after it', () => `${HASH} extra`],
    ['the id has a word before it', () => `extra ${HASH}`],
    ['git prints two ids, one per line', () => `${HASH}\n${HASH}`],
  ])('gives null when %s', (_name, runGit) => {
    expect(readSiteCommit('/site', runGit)).toBeNull();
  });
});

describe('astroVersion', () => {
  it('reads the version of the astro package this build runs with', () => {
    expect(astroVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns the version the package reports, after asking for its package.json', () => {
    const requested: string[] = [];
    vi.mocked(createRequire).mockReturnValueOnce(((id: string) => {
      requested.push(id);
      return { version: '5.0.0' };
    }) as unknown as NodeRequire);
    expect(astroVersion()).toBe('5.0.0');
    expect(requested).toEqual(['astro/package.json']);
  });

  it.each([
    ['the package has no version key', () => ({})],
    ['the version is a number', () => ({ version: 5 })],
    ['the version is undefined', () => ({ version: undefined })],
    ['the package is undefined', () => undefined],
    ['the package is null', () => null],
    ['the package is a string', () => '5.0.0'],
    [
      'the package is a function with a version',
      () => Object.assign(() => undefined, { version: '5.0.0' }),
    ],
    [
      'the version is not reported by the in operator',
      () => new Proxy({}, { has: () => false, get: () => '5.0.0' }),
    ],
  ])('refuses a package when %s', (_name, makePackage) => {
    const requested: string[] = [];
    vi.mocked(createRequire).mockReturnValueOnce(((id: string) => {
      requested.push(id);
      return makePackage();
    }) as unknown as NodeRequire);
    expect(() => astroVersion()).toThrow(
      new Error('astro/package.json has no version'),
    );
    expect(requested).toEqual(['astro/package.json']);
  });
});
