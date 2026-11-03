import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { git, makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import { type CmsConfig, parseConfig } from '../config/schema.ts';
import type { Logger } from '../log.ts';
import { createMutex, type Mutex } from './mutex.ts';
import {
  type ChangedPath,
  openRepo,
  parseNameStatus,
  type Repo,
} from './ops.ts';
import { ensureRepo, type RepoState } from './repo.ts';

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
async function fixtureIn(root: string, siteDir: string): Promise<Fixture> {
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  await git(root, ['init', '--bare', remote]);
  await mkdir(seed);
  await git(seed, ['init']);
  await writeFiles(seed, {
    [posix.join(siteDir, 'notes/a.md')]: 'alpha\n',
    [posix.join(siteDir, 'notes/b.md')]: 'beta\n',
    'README.md': 'root\n',
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
