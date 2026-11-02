import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cloneRemote,
  commitAndPush,
  git,
  makeTestRoot,
  readText,
  removeTestRoot,
  seedRemote,
} from './git.ts';

// Real git on Windows: seeding a remote takes about 10 s on the dev machine
// (measured 2026-11-01), so each seeding case gets more than Vitest's 5 s default.
const SLOW_MS = 60_000;

// Each case gets its own temp folder, built before it and removed after it.
let root: string;
beforeEach(async () => {
  root = await makeTestRoot();
});
afterEach(async () => {
  await removeTestRoot(root);
});

describe('git test harness', () => {
  it('puts the test folder under cms-server/.test-tmp', () => {
    expect(root).toMatch(/[\\/]cms-server[\\/]\.test-tmp[\\/]case-/);
  });

  it(
    'seeds a remote, a developer pushes, and a second clone sees the push',
    async () => {
      const remote = await seedRemote(root);
      const developer = await cloneRemote(remote, join(root, 'developer'));
      const pushed = await commitAndPush(
        developer,
        { 'notes/hello.md': 'hello\n' },
        'add a note',
      );

      const cms = await cloneRemote(remote, join(root, 'cms'));
      expect(await readText(cms, 'notes/hello.md')).toBe('hello\n');
      expect(await git(cms, ['rev-parse', 'HEAD'])).toBe(`${pushed}\n`);
      expect(await git(remote, ['rev-parse', 'main'])).toBe(`${pushed}\n`);
    },
    SLOW_MS,
  );

  it(
    'copies sample-site without build output or installed packages',
    async () => {
      const remote = await seedRemote(root);
      const clone = await cloneRemote(remote, join(root, 'clone'));
      expect(existsSync(join(clone, 'astro.config.mjs'))).toBe(true);
      expect(
        ['dist', '.astro', 'node_modules'].map((name) =>
          existsSync(join(clone, name)),
        ),
      ).toEqual([false, false, false]);
    },
    SLOW_MS,
  );

  it(
    'puts the site in the siteDir subfolder when one is given',
    async () => {
      const remote = await seedRemote(root, { siteDir: 'site' });
      const clone = await cloneRemote(remote, join(root, 'clone'));
      expect(existsSync(join(clone, 'site', 'astro.config.mjs'))).toBe(true);
      expect(existsSync(join(clone, 'astro.config.mjs'))).toBe(false);
    },
    SLOW_MS,
  );

  it(
    'runs git with the harness settings, not the machine settings',
    async () => {
      const remote = await seedRemote(root);
      const clone = await cloneRemote(remote, join(root, 'clone'));
      expect(await git(clone, ['config', '--get', 'core.autocrlf'])).toBe(
        'false\n',
      );
      expect(await git(clone, ['config', '--get', 'user.name'])).toBe(
        'Developer\n',
      );
    },
    SLOW_MS,
  );

  it('rejects with git stderr when git fails', async () => {
    await expect(git(root, ['no-such-command'])).rejects.toThrow(
      "git no-such-command failed: git: 'no-such-command' is not a git command",
    );
  });

  it(
    'removes the test folder and everything in it',
    async () => {
      await seedRemote(root);
      await removeTestRoot(root);
      expect(existsSync(root)).toBe(false);
    },
    SLOW_MS,
  );
});
