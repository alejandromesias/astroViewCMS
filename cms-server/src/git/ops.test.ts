import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bundleFolder,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import {
  cloneRemote,
  git,
  makeTestRoot,
  removeTestRoot,
} from '../../test/helpers/git.ts';
import type { Bundle } from '../bundle/read.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import { type BundleStore, createBundleStore } from '../bundle/store.ts';
import { type CmsConfig, parseConfig } from '../config/schema.ts';
import type { Logger } from '../log.ts';
import { type ExecFn, realExec } from './exec.ts';
import { createMutex, type Mutex } from './mutex.ts';
import {
  type ChangedPath,
  type FetchResult,
  openRepo,
  parseNameStatus,
  parseOverwrote,
  type Repo,
} from './ops.ts';
import { ensureRepo, type RepoState, WORK } from './repo.ts';

// Each test makes its own small remote and clone, so one test may take a few git calls.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// What a test needs from one start: the config, the `.cms` folder and the state `ensureRepo` returned.
interface Fixture {
  config: CmsConfig;
  cmsDir: string;
  state: RepoState;
}

const roots: string[] = [];

// Each test gets its own folder, removed after it.
async function newRoot(): Promise<string> {
  const root = await makeTestRoot();
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTestRoot(root)));
});

// A logger whose three methods are spies.
function silentLog(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// A promise the test resolves by hand, to hold a lock for as long as it needs.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Writes each file under `dir` (keys are relative paths with forward slashes).
async function writeFiles(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, text] of Object.entries(files)) {
    const target = join(dir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
}

// A bare remote whose `main` holds the site under `siteDir` and a README outside it, cloned with `ensureRepo`.
async function fixtureIn(
  root: string,
  siteDir: string,
  extra: Record<string, string> = {},
): Promise<Fixture> {
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  await git(root, ['init', '--bare', remote]);
  await mkdir(seed);
  await git(seed, ['init']);
  await writeFiles(seed, {
    [posix.join(siteDir, 'notes/a.md')]: 'alpha\n',
    [posix.join(siteDir, 'notes/b.md')]: 'beta\n',
    'README.md': 'root\n',
    ...extra,
  });
  await git(seed, ['add', '--all']);
  await git(seed, ['commit', '--message', 'seed']);
  await git(seed, ['remote', 'add', 'origin', remote]);
  await git(seed, ['push', 'origin', 'HEAD:main']);
  const config = parseConfig({
    site: 'demo',
    remote,
    siteDir,
    previewSiteConfig: 'preview.config.json',
    origins: {
      cms: 'https://cms.example.test',
      preview: 'https://preview.example.test',
    },
  });
  const cmsDir = join(root, '.cms');
  const state = await ensureRepo({ config, cmsDir, log: silentLog() });
  return { config, cmsDir, state };
}

// The operations of a fixture. A `mutex` replaces the default lock when a test needs a short timeout.
function repoOf(fixture: Fixture, mutex?: Mutex): Repo {
  return mutex === undefined
    ? openRepo(fixture)
    : openRepo({ ...fixture, mutex });
}

// Overwrites a file of the site (the working copy).
async function edit(
  fixture: Fixture,
  file: string,
  text: string,
): Promise<void> {
  await writeFile(join(fixture.state.siteFolder, file), text);
}

// Commits the given site paths on cms/work, as a save does.
function save(
  repo: Repo,
  paths: string[],
  message: string,
): Promise<string | null> {
  return repo.locked('save', (tx) => tx.commitSave(paths, message));
}

// The sha of HEAD in the clone.
async function headOf(fixture: Fixture): Promise<string> {
  return (await git(fixture.state.repoDir, ['rev-parse', 'HEAD'])).trim();
}

// How many worktree records git lists for the clone (the main one counts).
async function worktreeRecords(fixture: Fixture): Promise<number> {
  const listing = await git(fixture.state.repoDir, [
    'worktree',
    'list',
    '--porcelain',
  ]);
  return listing.split('\n').filter((line) => line.startsWith('worktree '))
    .length;
}

describe('openRepo: commitSave', () => {
  it('treats glob characters in a path as literal: a save never commits the files that match them', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await edit(fixture, 'notes/b.md', 'beta 2\n');
    // Git would match both files as a pattern; as a literal path nothing matches and the save is refused.
    await save(repo, ['notes/*.md'], 'save all').catch(() => undefined);
    expect(await git(fixture.state.repoDir, ['status', '--porcelain'])).toBe(
      ' M site/notes/a.md\n M site/notes/b.md\n',
    );
  });

  it('commits only the given paths and returns the new sha', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await edit(fixture, 'notes/b.md', 'beta 2\n');
    const sha = await save(repo, ['notes/a.md'], 'save a');
    expect(sha).toBe(await headOf(fixture));
    expect(
      await git(fixture.state.repoDir, [
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        'HEAD',
      ]),
    ).toBe('site/notes/a.md\n');
    expect(await git(fixture.state.repoDir, ['log', '-1', '--format=%s'])).toBe(
      'save a\n',
    );
    // b.md was edited but not in the paths, so it stays uncommitted.
    expect(await git(fixture.state.repoDir, ['status', '--porcelain'])).toBe(
      ' M site/notes/b.md\n',
    );
  });

  it('returns null and makes no commit when the paths did not change', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const before = await headOf(fixture);
    await expect(
      save(repoOf(fixture), ['notes/a.md'], 'nothing'),
    ).resolves.toBe(null);
    expect(await headOf(fixture)).toBe(before);
  });

  it('commits a deletion, because the staging covers removed files', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await rm(join(fixture.state.siteFolder, 'notes/b.md'));
    const sha = await save(repoOf(fixture), ['notes/b.md'], 'drop b');
    expect(sha).toBe(await headOf(fixture));
    expect(
      await git(fixture.state.repoDir, [
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        'HEAD',
      ]),
    ).toBe('site/notes/b.md\n');
    expect(await git(fixture.state.repoDir, ['ls-files', 'site/notes'])).toBe(
      'site/notes/a.md\n',
    );
  });

  it('refuses an empty path list, so nothing else gets staged', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(save(repoOf(fixture), [], 'empty')).rejects.toThrow(
      new Error('commitSave needs at least one path'),
    );
  });

  it('refuses a save while HEAD is not on cms/work', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await git(fixture.state.repoDir, ['checkout', '-b', 'side']);
    await expect(
      save(repoOf(fixture), ['notes/a.md'], 'off branch'),
    ).rejects.toThrow(
      new Error(
        'HEAD is on side, not cms/work. A save needs cms/work checked out.',
      ),
    );
  });

  it('refuses a path that leaves the site', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(
      save(repoOf(fixture), ['../README.md'], 'escape'),
    ).rejects.toMatchObject({
      name: 'GitError',
      kind: 'invalid-argument',
      message: 'invalid path: "../README.md"',
    });
  });
});

describe('openRepo: restore', () => {
  it('puts back a modified file, and unstages and removes a new file that the index holds', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await edit(fixture, 'notes/new.md', 'new\n');
    await git(fixture.state.repoDir, ['add', '--', 'site/notes/new.md']);
    await repo.locked('save', (tx) =>
      tx.restore(['notes/a.md', 'notes/new.md']),
    );
    expect(
      await readFile(join(fixture.state.siteFolder, 'notes/a.md'), 'utf8'),
    ).toBe('alpha\n');
    await expect(
      stat(join(fixture.state.siteFolder, 'notes/new.md')),
    ).rejects.toThrow('ENOENT');
    expect(await git(fixture.state.repoDir, ['status', '--porcelain'])).toBe(
      '',
    );
  });

  it('checks out a deleted file again', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await rm(join(fixture.state.siteFolder, 'notes/b.md'));
    await repoOf(fixture).locked('save', (tx) => tx.restore(['notes/b.md']));
    expect(
      await readFile(join(fixture.state.siteFolder, 'notes/b.md'), 'utf8'),
    ).toBe('beta\n');
    expect(await git(fixture.state.repoDir, ['status', '--porcelain'])).toBe(
      '',
    );
  });

  it('ignores a path that matches nothing', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(
      repoOf(fixture).locked('save', (tx) => tx.restore(['notes/none.md'])),
    ).resolves.toBeUndefined();
    expect(await git(fixture.state.repoDir, ['status', '--porcelain'])).toBe(
      '',
    );
  });

  it('does nothing for an empty list, and keeps what the index holds', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await edit(fixture, 'notes/new.md', 'new\n');
    await git(fixture.state.repoDir, ['add', '--', 'site/notes/new.md']);
    await repoOf(fixture).locked('save', (tx) => tx.restore([]));
    expect(
      await git(fixture.state.repoDir, ['diff', '--cached', '--name-only']),
    ).toContain('site/notes/new.md');
  });

  it('removes a new file at an ignored path, so a failed save leaves nothing behind', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', {
      'site/.gitignore': 'notes/ignored/\n',
    });
    await mkdir(join(fixture.state.siteFolder, 'notes/ignored'), {
      recursive: true,
    });
    await edit(fixture, 'notes/ignored/new.md', 'new\n');
    await repoOf(fixture).locked('save', (tx) =>
      tx.restore(['notes/ignored/new.md']),
    );
    await expect(
      stat(join(fixture.state.siteFolder, 'notes/ignored/new.md')),
    ).rejects.toThrow('ENOENT');
  });

  it('leaves an untracked file outside the list alone', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await edit(fixture, 'notes/other.md', 'kept\n');
    await repoOf(fixture).locked('save', (tx) => tx.restore(['notes/a.md']));
    expect(
      await readFile(join(fixture.state.siteFolder, 'notes/other.md'), 'utf8'),
    ).toBe('kept\n');
  });
});

describe('openRepo: bytes, merge base and trailers', () => {
  it('showAtBytes returns the stored bytes, a byte-order mark and invalid UTF-8 included; showAt decodes them', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    const raw = Buffer.from([0xef, 0xbb, 0xbf, 0xff, 0x41]);
    await writeFile(join(fixture.state.siteFolder, 'notes/raw.bin'), raw);
    await save(repo, ['notes/raw.bin'], 'raw');
    await expect(repo.showAtBytes(WORK, 'notes/raw.bin')).resolves.toEqual(raw);
    await expect(repo.showAt(WORK, 'notes/raw.bin')).resolves.toBe('﻿�A');
  });

  it('showAtBytes and showAt give null for a missing path and for a folder', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await expect(
      repo.showAtBytes(WORK, 'notes/missing.md'),
    ).resolves.toBeNull();
    await expect(repo.showAtBytes(WORK, 'notes')).resolves.toBeNull();
    await expect(repo.showAt(WORK, 'notes/missing.md')).resolves.toBeNull();
  });

  it('mergeBase is the commit that origin and cms/work share, and an upstream commit does not move it', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site');
    const repo = repoOf(fixture);
    const shared = (
      await git(fixture.state.repoDir, ['rev-parse', 'origin/main'])
    ).trim();
    await expect(repo.mergeBase()).resolves.toBe(shared);
    await writeFile(join(root, 'seed', 'site/notes/a.md'), 'upstream\n');
    await git(join(root, 'seed'), ['commit', '--all', '--message', 'upstream']);
    await git(join(root, 'seed'), ['push', 'origin', 'HEAD:main']);
    await git(fixture.state.repoDir, ['fetch', 'origin']);
    await expect(repo.mergeBase()).resolves.toBe(shared);
  });

  it('overwrittenSince reads the CMS-Overwrote trailers of the saves that origin lacks, and the newest value wins', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await save(repo, ['notes/a.md'], 'save');
    await git(fixture.state.repoDir, [
      'commit',
      '--allow-empty',
      '--message',
      'reapply one',
      '--trailer',
      'CMS-Overwrote: notes/a 1111111',
      '--trailer',
      'CMS-Overwrote: notes/x y 2222222',
    ]);
    await git(fixture.state.repoDir, [
      'commit',
      '--allow-empty',
      '--message',
      'reapply two',
      '--trailer',
      'CMS-Overwrote: notes/a 3333333',
    ]);
    await expect(repo.overwrittenSince()).resolves.toEqual(
      new Map([
        ['notes/a', '3333333'],
        ['notes/x y', '2222222'],
      ]),
    );
  });

  it('overwrittenSince is empty when no save is ahead of origin', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(repoOf(fixture).overwrittenSince()).resolves.toEqual(
      new Map(),
    );
  });
});

describe('parseOverwrote', () => {
  it('splits each value at its last space, so a key may hold spaces', () => {
    expect(parseOverwrote('pages/My Post 1234abcd\n')).toEqual(
      new Map([['pages/My Post', '1234abcd']]),
    );
  });

  it('skips a line with no key, no sha, or no space at all', () => {
    expect(parseOverwrote('nosha\n 1234abcd\npages/a \n\n')).toEqual(new Map());
  });

  it('keeps the later line for a key that repeats, across and within commits', () => {
    expect(
      parseOverwrote('blog/a 1111\nblog/b 2222\nblog/a 3333\nblog/a 4444\n'),
    ).toEqual(
      new Map([
        ['blog/a', '4444'],
        ['blog/b', '2222'],
      ]),
    );
  });

  it('reads empty output as no trailers', () => {
    expect(parseOverwrote('')).toEqual(new Map());
  });
});

describe('openRepo: changedPaths', () => {
  it('lists created, modified and deleted paths relative to the site, and leaves out paths outside it', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await rm(join(fixture.state.siteFolder, 'notes/b.md'));
    await edit(fixture, 'notes/c.md', 'gamma\n');
    await save(repo, ['notes/a.md', 'notes/b.md', 'notes/c.md'], 'save');
    await writeFile(join(fixture.state.repoDir, 'README.md'), 'root 2\n');
    await git(fixture.state.repoDir, [
      'commit',
      '--all',
      '--message',
      'readme',
    ]);
    const changed: ChangedPath[] = await repo.changedPaths();
    expect(changed).toEqual([
      { path: 'notes/a.md', status: 'modified' },
      { path: 'notes/b.md', status: 'deleted' },
      { path: 'notes/c.md', status: 'created' },
    ]);
  });

  it('with the site at the repo root, returns the paths without a prefix', async () => {
    const fixture = await fixtureIn(await newRoot(), '.');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await save(repo, ['notes/a.md'], 'save');
    await expect(repo.changedPaths()).resolves.toEqual([
      { path: 'notes/a.md', status: 'modified' },
    ]);
  });

  it('does not report a new upstream commit as reversed edits (merge-base diff)', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await save(repo, ['notes/a.md'], 'save');
    // Someone else pushes a new file to main, then this clone fetches it.
    const other = join(root, 'other');
    await git(root, ['clone', fixture.config.remote, other]);
    await writeFiles(other, { 'site/notes/z.md': 'zeta\n' });
    await git(other, ['add', '--all']);
    await git(other, ['commit', '--message', 'upstream']);
    await git(other, ['push', 'origin', 'HEAD:main']);
    await git(fixture.state.repoDir, ['fetch', 'origin']);
    await expect(repo.changedPaths()).resolves.toEqual([
      { path: 'notes/a.md', status: 'modified' },
    ]);
  });
});

describe('parseNameStatus', () => {
  it('reads each status letter, strips the site folder, and maps a type change to modified', () => {
    expect(
      parseNameStatus(
        'M\0site/a.md\0A\0site/b.md\0D\0site/c.md\0T\0site/d.md\0',
        'site',
      ),
    ).toEqual([
      { path: 'a.md', status: 'modified' },
      { path: 'b.md', status: 'created' },
      { path: 'c.md', status: 'deleted' },
      { path: 'd.md', status: 'modified' },
    ]);
  });

  it('with the scope ".", strips nothing', () => {
    expect(parseNameStatus('A\0x/y.md\0', '.')).toEqual([
      { path: 'x/y.md', status: 'created' },
    ]);
  });

  it('an empty diff gives an empty list', () => {
    expect(parseNameStatus('', 'site')).toEqual([]);
  });

  it('an unknown status letter throws, rather than guessing', () => {
    expect(() => parseNameStatus('U\0site/a.md\0', 'site')).toThrow(
      new Error('git diff gave an unexpected status "U"'),
    );
  });
});

describe('openRepo: showAt', () => {
  it('returns the text at a ref, so a save shows on cms/work and not on origin/main', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await save(repo, ['notes/a.md'], 'save');
    await expect(repo.showAt('cms/work', 'notes/a.md')).resolves.toBe(
      'alpha 2\n',
    );
    await expect(repo.showAt('origin/main', 'notes/a.md')).resolves.toBe(
      'alpha\n',
    );
  });

  it('returns null for a path missing at the ref, and for a folder', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/c.md', 'gamma\n');
    await save(repo, ['notes/c.md'], 'add c');
    await expect(repo.showAt('origin/main', 'notes/c.md')).resolves.toBeNull();
    await expect(repo.showAt('cms/work', 'notes')).resolves.toBeNull();
  });

  it('throws when the ref does not exist', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(
      repoOf(fixture).showAt('no-such-ref', 'notes/a.md'),
    ).rejects.toMatchObject({
      name: 'GitError',
      kind: 'failed',
      message:
        'git ls-tree -z no-such-ref -- site/notes/a.md failed (exit 128)',
    });
  });

  it('refuses a path that leaves the site', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(
      repoOf(fixture).showAt('cms/work', '../README.md'),
    ).rejects.toMatchObject({
      name: 'GitError',
      kind: 'invalid-argument',
      message: 'invalid path: "../README.md"',
    });
  });
});

describe('openRepo: worktrees', () => {
  it('adds a detached worktree at a ref, and removes it with its record', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    const path = await repo.locked('sync', (tx) =>
      tx.worktreeAdd('origin/main', 'preview'),
    );
    expect(path).toBe(join(fixture.cmsDir, 'demo', 'worktrees', 'preview'));
    expect(await readFile(join(path, 'site', 'notes', 'a.md'), 'utf8')).toBe(
      'alpha\n',
    );
    expect(await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
      'HEAD\n',
    );
    expect(await worktreeRecords(fixture)).toBe(2);
    await repo.locked('sync', (tx) => tx.worktreeRemove('preview'));
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await worktreeRecords(fixture)).toBe(1);
  });

  // A path that fails the relative-path check is a GitError; one that resolves outside the folder is a plain Error.
  it.each([
    [
      '..',
      {
        name: 'GitError',
        kind: 'invalid-argument',
        message: 'invalid path: ".."',
      },
    ],
    [
      '../escape',
      {
        name: 'GitError',
        kind: 'invalid-argument',
        message: 'invalid path: "../escape"',
      },
    ],
    [
      '/tmp/escape',
      {
        name: 'GitError',
        kind: 'invalid-argument',
        message: 'invalid path: "/tmp/escape"',
      },
    ],
    [
      '-x',
      {
        name: 'GitError',
        kind: 'invalid-argument',
        message: 'invalid path: "-x"',
      },
    ],
    [
      '.',
      {
        name: 'Error',
        message:
          'worktree "." must be one folder directly inside the worktrees folder',
      },
    ],
    [
      'a/b',
      {
        name: 'Error',
        message:
          'worktree "a/b" must be one folder directly inside the worktrees folder',
      },
    ],
  ])('refuses the folder %j', async (dir, expected) => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(
      repoOf(fixture).locked('sync', (tx) =>
        tx.worktreeAdd('origin/main', dir),
      ),
    ).rejects.toMatchObject(expected);
  });

  it('refuses to remove a folder outside the worktrees folder', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(
      repoOf(fixture).locked('sync', (tx) => tx.worktreeRemove('../repo')),
    ).rejects.toMatchObject({
      name: 'GitError',
      kind: 'invalid-argument',
      message: 'invalid path: "../repo"',
    });
  });

  it('refuses a ref that starts with a dash, and makes no folder', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(
      repoOf(fixture).locked('sync', (tx) => tx.worktreeAdd('-x', 'preview')),
    ).rejects.toMatchObject({ name: 'GitError', kind: 'invalid-argument' });
    await expect(
      stat(join(fixture.cmsDir, 'demo', 'worktrees', 'preview')),
    ).rejects.toThrow('ENOENT');
  });
});

describe('openRepo: the lock', () => {
  it('two saves racing for the lock run one after the other, in arrival order', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    await edit(fixture, 'notes/b.md', 'beta 2\n');
    await Promise.all([
      save(repo, ['notes/a.md'], 'first'),
      save(repo, ['notes/b.md'], 'second'),
    ]);
    expect(await git(fixture.state.repoDir, ['log', '--format=%s', '-2'])).toBe(
      'second\nfirst\n',
    );
  });

  it('releases the lock when the work throws', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture);
    await expect(
      repo.locked('save', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow(new Error('boom'));
    await expect(repo.locked('save', async () => 'next ran')).resolves.toBe(
      'next ran',
    );
  });

  it('a waiter that waits past the timeout gets a LockTimeoutError that names the holder', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    const repo = repoOf(fixture, createMutex({ timeoutMs: 20 }));
    const gate = deferred();
    const holding = repo.locked('publish', () => gate.promise);
    await expect(
      repo.locked('save', async () => 'never'),
    ).rejects.toMatchObject({
      name: 'LockTimeoutError',
      holder: 'publish',
      message:
        'Timed out after 20 ms waiting for the repo lock, which publish holds.',
    });
    gate.resolve();
    await holding;
  });
});

describe('openRepo: showAt refs', () => {
  it('refuses a ref that starts with a dash before git sees it', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site');
    await expect(
      repoOf(fixture).showAt('-x', 'notes/a.md'),
    ).rejects.toMatchObject({
      name: 'GitError',
      kind: 'invalid-argument',
    });
  });
});

// Pushes one commit to `remote` from a second clone in `root`. `edit` changes that clone's files before the commit.
async function pushFrom(
  root: string,
  remote: string,
  edit: (dir: string) => Promise<void>,
): Promise<string> {
  const dir = await cloneRemote(remote, join(root, 'second'));
  await edit(dir);
  await git(dir, ['add', '--all']);
  await git(dir, ['commit', '--message', 'upstream change']);
  await git(dir, ['push', 'origin', 'HEAD']);
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

// The extra files of a sync test's site: a content.config.ts, a build-time theme and an image.
function syncFiles(): Record<string, string> {
  return {
    'site/content.config.ts': 'export default {};\n',
    'site/src/config/theme.json': '{"color":"red"}\n',
    'site/src/assets/logo.png': 'logo v1\n',
  };
}

// The documents of the sync tests' bundle: two content documents (the notes) and the build-time theme.
function syncDocuments(): Record<string, string | boolean>[] {
  const revision = '0123456789abcdef';
  return [
    {
      key: 'notes/a',
      file: 'notes/a.md',
      format: 'md',
      buildTime: false,
      revision,
    },
    {
      key: 'notes/b',
      file: 'notes/b.md',
      format: 'md',
      buildTime: false,
      revision,
    },
    {
      key: 'data:src/config/theme.json',
      file: 'src/config/theme.json',
      format: 'json',
      buildTime: true,
      revision,
    },
  ];
}

// A store over a bundle whose bundle.json names `siteCommit` (null for none) and whose documents are the sync ones.
async function bundleOf(siteCommit: string | null): Promise<BundleStore> {
  const dir = await bundleFolder({
    'bundle.json': `${JSON.stringify({ bundleId: 'fixture-2026-11-03', siteCommit, protocolVersion: 2, astroVersion: '7.4.2', builtAt: '2026-11-04T03:42:22.323Z' }, null, 2)}\n`,
    'documents.json': JSON.stringify(syncDocuments()),
  });
  return createBundleStore(directoryBundleSource(dir));
}

// Runs `tx.fetch` under the lock. `exec` replaces the git runner, and `fixture` may carry another config.
function syncOf(
  fixture: Fixture,
  bundles: BundleStore,
  exec?: ExecFn,
): Promise<FetchResult> {
  const repo = openRepo(exec === undefined ? fixture : { ...fixture, exec });
  return repo.locked('sync', (tx) => tx.fetch(bundles));
}

// A git runner that fails each call whose arguments include `word` with the fields of `failure`, and runs every
// other call for real.
function failing(word: string, failure: Record<string, unknown>): ExecFn {
  return (file, args, options) =>
    args.includes(word)
      ? Promise.reject(Object.assign(new Error('git failed'), failure))
      : realExec(file, args, options);
}

describe('openRepo: fetch', () => {
  afterEach(async () => {
    await removeBundleFolders();
  });

  it('reports no change, and no reapply, when origin has not moved since the bundle', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', syncFiles());
    const seed = await headOf(fixture);
    await expect(syncOf(fixture, await bundleOf(seed))).resolves.toEqual({
      ok: true,
      upstream: seed,
      reapply: false,
      change: 'none',
      paths: [],
    });
  });

  it('is content-only for a push that edits a content document, and reapply is true', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    const pushed = await pushFrom(root, fixture.config.remote, (dir) =>
      writeFiles(dir, { 'site/notes/a.md': 'alpha, edited\n' }),
    );
    await expect(syncOf(fixture, bundles)).resolves.toEqual({
      ok: true,
      upstream: pushed,
      reapply: true,
      change: 'content-only',
      paths: [{ path: 'site/notes/a.md', status: 'modified' }],
    });
  });

  it('is code for a push that edits content.config.ts', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    const pushed = await pushFrom(root, fixture.config.remote, (dir) =>
      writeFiles(dir, {
        'site/content.config.ts': 'export default { edited: true };\n',
      }),
    );
    await expect(syncOf(fixture, bundles)).resolves.toEqual({
      ok: true,
      upstream: pushed,
      reapply: true,
      change: 'code',
      paths: [{ path: 'site/content.config.ts', status: 'modified' }],
    });
  });

  it('is code for a push that edits theme.json, a build-time document', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    const pushed = await pushFrom(root, fixture.config.remote, (dir) =>
      writeFiles(dir, { 'site/src/config/theme.json': '{"color":"blue"}\n' }),
    );
    await expect(syncOf(fixture, bundles)).resolves.toEqual({
      ok: true,
      upstream: pushed,
      reapply: true,
      change: 'code',
      paths: [{ path: 'site/src/config/theme.json', status: 'modified' }],
    });
  });

  it('is code for a push that adds a document', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    const pushed = await pushFrom(root, fixture.config.remote, (dir) =>
      writeFiles(dir, { 'site/notes/new.md': 'new\n' }),
    );
    await expect(syncOf(fixture, bundles)).resolves.toEqual({
      ok: true,
      upstream: pushed,
      reapply: true,
      change: 'code',
      paths: [{ path: 'site/notes/new.md', status: 'created' }],
    });
  });

  it('is code for a push that deletes a content document', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    const pushed = await pushFrom(root, fixture.config.remote, (dir) =>
      rm(join(dir, 'site/notes/b.md')),
    );
    await expect(syncOf(fixture, bundles)).resolves.toEqual({
      ok: true,
      upstream: pushed,
      reapply: true,
      change: 'code',
      paths: [{ path: 'site/notes/b.md', status: 'deleted' }],
    });
  });

  it('is code for a push that changes an image', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    const pushed = await pushFrom(root, fixture.config.remote, (dir) =>
      writeFiles(dir, { 'site/src/assets/logo.png': 'logo v2\n' }),
    );
    await expect(syncOf(fixture, bundles)).resolves.toEqual({
      ok: true,
      upstream: pushed,
      reapply: true,
      change: 'code',
      paths: [{ path: 'site/src/assets/logo.png', status: 'modified' }],
    });
  });

  it('is code for a push outside the site folder', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    const pushed = await pushFrom(root, fixture.config.remote, (dir) =>
      writeFiles(dir, { 'README.md': 'root, edited\n' }),
    );
    await expect(syncOf(fixture, bundles)).resolves.toEqual({
      ok: true,
      upstream: pushed,
      reapply: true,
      change: 'code',
      paths: [{ path: 'README.md', status: 'modified' }],
    });
  });

  it('never gives a siteCommit that starts with a dash to git, and reads the change as code', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', syncFiles());
    const calls: string[][] = [];
    const recording: ExecFn = (file, args, options) => {
      calls.push([...args]);
      return realExec(file, args, options);
    };
    // The bundle parser refuses this value, so the store is replaced to reach the git call.
    const bundle: Bundle = {
      identity: {
        bundleId: 'fixture-2026-11-03',
        siteCommit: '--output=poisoned',
        protocolVersion: 2,
        astroVersion: '7.4.2',
        builtAt: '2026-11-04T03:42:22.323Z',
      },
      documents: new Map(),
      collections: new Map(),
      routes: [],
      images: [],
    };
    const bundles: BundleStore = { current: () => Promise.resolve(bundle) };
    await expect(syncOf(fixture, bundles, recording)).resolves.toEqual({
      ok: true,
      upstream: await headOf(fixture),
      reapply: false,
      change: 'code',
      paths: [],
    });
    expect(calls.filter((args) => args[0] === 'diff')).toStrictEqual([]);
  });

  it('is code when the bundle has no commit (siteCommit null), even with no change', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', syncFiles());
    const seed = await headOf(fixture);
    await expect(syncOf(fixture, await bundleOf(null))).resolves.toEqual({
      ok: true,
      upstream: seed,
      reapply: false,
      change: 'code',
      paths: [],
    });
  });

  it('is code when the bundle commit is missing from the clone', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', syncFiles());
    const seed = await headOf(fixture);
    await expect(
      syncOf(fixture, await bundleOf('f'.repeat(40))),
    ).resolves.toEqual({
      ok: true,
      upstream: seed,
      reapply: false,
      change: 'code',
      paths: [],
    });
  });

  it('is code when the diff against the bundle commit fails', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    const pushed = await pushFrom(root, fixture.config.remote, (dir) =>
      writeFiles(dir, { 'site/notes/a.md': 'alpha, edited\n' }),
    );
    await expect(
      syncOf(
        fixture,
        bundles,
        failing('diff', { code: 128, stderr: 'fatal: bad revision\n' }),
      ),
    ).resolves.toEqual({
      ok: true,
      upstream: pushed,
      reapply: true,
      change: 'code',
      paths: [],
    });
  });

  it('is code when there is no bundle', async () => {
    const root = await newRoot();
    const fixture = await fixtureIn(root, 'site', syncFiles());
    const seed = await headOf(fixture);
    const empty = join(root, 'no-bundle');
    await mkdir(empty);
    await expect(
      syncOf(fixture, createBundleStore(directoryBundleSource(empty))),
    ).resolves.toEqual({
      ok: true,
      upstream: seed,
      reapply: false,
      change: 'code',
      paths: [],
    });
  });

  it('is code when the bundle cannot be read', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', syncFiles());
    const seed = await headOf(fixture);
    const dir = await bundleFolder({ 'documents.json': 'not json' });
    await expect(
      syncOf(fixture, createBundleStore(directoryBundleSource(dir))),
    ).resolves.toEqual({
      ok: true,
      upstream: seed,
      reapply: false,
      change: 'code',
      paths: [],
    });
  });

  it('is a sync error when the bundle store fails with something that is not a bundle error', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', syncFiles());
    await expect(
      syncOf(
        fixture,
        createBundleStore({
          current: () => Promise.reject(new Error('disk gone')),
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      syncError: { kind: 'failed', message: 'disk gone' },
    });
  });

  it('is a sync error, not a throw, when origin cannot be reached', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    await expect(
      syncOf(
        fixture,
        bundles,
        failing('fetch', {
          code: 128,
          stderr:
            'fatal: unable to access: Could not resolve host: github.com\n',
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      syncError: {
        kind: 'failed',
        message:
          'git fetch origin failed (exit 128): fatal: unable to access: Could not resolve host: github.com',
      },
    });
  });

  it('is a sync error when the fetch times out at the 60 s default', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    await expect(
      syncOf(fixture, bundles, failing('fetch', { killed: true, code: null })),
    ).resolves.toEqual({
      ok: false,
      syncError: {
        kind: 'failed',
        message: 'git fetch origin timed out after 60000 ms',
      },
    });
  });

  it('keeps the auth kind of ensureRepo, and redacts the remote', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site', syncFiles());
    const bundles = await bundleOf(await headOf(fixture));
    const github = {
      ...fixture,
      config: {
        ...fixture.config,
        remote: 'https://user:secret@github.com/owner/repo.git',
      },
    };
    await expect(
      syncOf(
        github,
        bundles,
        failing('fetch', {
          code: 128,
          stderr:
            "fatal: Authentication failed for 'https://github.com/owner/repo.git/'\n",
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      syncError: {
        kind: 'auth-failed',
        message:
          "Git could not sign in to https://***@github.com/owner/repo.git. Check the machine's git credential helper or SSH key.",
      },
    });
  });
});

describe('openRepo: site folder with a trailing slash', () => {
  it('strips the trailing slash, so the paths come back site-relative', async () => {
    const fixture = await fixtureIn(await newRoot(), 'site/');
    await edit(fixture, 'notes/a.md', 'alpha 2\n');
    const repo = repoOf(fixture);
    await save(repo, ['notes/a.md'], 'save');
    await expect(repo.changedPaths()).resolves.toEqual([
      { path: 'notes/a.md', status: 'modified' },
    ]);
  });
});
