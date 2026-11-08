import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cloneRemote,
  commitAndPush,
  git,
  makeTestRoot,
  removeTestRoot,
  seedRemote,
} from '../../test/helpers/git.ts';
import { parseConfig } from '../config/schema.ts';
import type { Logger } from '../log.ts';
import { type ExecFn, realExec } from './exec.ts';
import { ensureRepo } from './repo.ts';

// Each test runs real git against local bare remotes, and one start takes several git calls.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const RECOVERED_MESSAGE =
  'Discarded the uncommitted changes of an unfinished save';

// A valid config for a test. Tests change only what they need.
function configFor(remote: string, overrides: Record<string, unknown> = {}) {
  return parseConfig({
    site: 'demo',
    remote,
    previewSiteConfig: 'preview.config.json',
    origins: {
      cms: 'https://cms.example.test',
      preview: 'https://preview.example.test',
    },
    ...overrides,
  });
}

// A logger whose three methods are spies.
function spyLog(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// An `exec` that fails the way `execFile` does, with a git exit code and the given stderr.
function failingExec(stderr: string): ExecFn {
  return () =>
    Promise.reject(
      Object.assign(new Error('Command failed'), {
        code: 128,
        killed: false,
        stderr,
      }),
    );
}

const roots: string[] = [];

// Each test gets its own folder under cms-server/.test-tmp/, removed after it.
async function newRoot(): Promise<string> {
  const root = await makeTestRoot();
  roots.push(root);
  return root;
}

function cmsDirOf(root: string): string {
  return join(root, '.cms');
}

function repoDirOf(root: string): string {
  return join(cmsDirOf(root), 'demo', 'repo');
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => removeTestRoot(root)));
});

// Makes one commit on cms/work, as a save would.
async function saveOn(repoDir: string, file: string): Promise<void> {
  await writeFile(join(repoDir, file), `${file}\n`);
  await git(repoDir, ['add', '--all']);
  await git(repoDir, ['commit', '--message', `save: ${file}`]);
}

describe('ensureRepo with a real remote', () => {
  // Seeded once per file, about 10 s. The seed runs the test harness's git, not the code under test.
  let seedRoot: string;
  let remote: string;

  beforeAll(async () => {
    seedRoot = await makeTestRoot();
    remote = await seedRemote(seedRoot, { source: 'git-site' });
  }, 60_000);

  afterAll(async () => {
    await removeTestRoot(seedRoot);
  });

  describe('the first start (no clone yet)', () => {
    it('clones the remote, creates cms/work from origin/main and checks it out', async () => {
      const root = await newRoot();
      const log = spyLog();
      const repoDir = repoDirOf(root);
      const state = await ensureRepo({
        config: configFor(remote),
        cmsDir: cmsDirOf(root),
        log,
      });
      expect(state).toEqual({ repoDir, siteFolder: repoDir, recovered: false });
      expect(await git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
        'cms/work\n',
      );
      expect(await git(repoDir, ['rev-parse', 'cms/work'])).toBe(
        await git(repoDir, ['rev-parse', 'origin/main']),
      );
      expect(await git(repoDir, ['ls-files', 'astro.config.mjs'])).toBe(
        'astro.config.mjs\n',
      );
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('writes the identity, the empty hooks folder, gpgsign and autocrlf into the clone', async () => {
      const root = await newRoot();
      const repoDir = repoDirOf(root);
      await ensureRepo({
        config: configFor(remote, {
          git: { author: 'Site Bot <bot@example.test>' },
        }),
        cmsDir: cmsDirOf(root),
        log: spyLog(),
      });
      // `--local` reads the clone's own config. The harness passes -c overrides on every call.
      expect(
        await git(repoDir, ['config', '--local', '--get', 'user.name']),
      ).toBe('Site Bot\n');
      expect(
        await git(repoDir, ['config', '--local', '--get', 'user.email']),
      ).toBe('bot@example.test\n');
      expect(
        await git(repoDir, ['config', '--local', '--get', 'core.hooksPath']),
      ).toBe(`${join(cmsDirOf(root), 'demo', 'no-hooks')}\n`);
      expect(
        await git(repoDir, ['config', '--local', '--get', 'commit.gpgsign']),
      ).toBe('false\n');
      expect(
        await git(repoDir, ['config', '--local', '--get', 'core.autocrlf']),
      ).toBe('false\n');
    });
  });

  describe('a later start', () => {
    it('keeps cms/work and its saves', async () => {
      const root = await newRoot();
      const config = configFor(remote);
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({ config, cmsDir, log: spyLog() });
      await saveOn(repoDir, 'save.txt');
      const saved = await git(repoDir, ['rev-parse', 'cms/work']);
      const log = spyLog();
      const state = await ensureRepo({ config, cmsDir, log });
      expect(state.recovered).toBe(false);
      expect(await git(repoDir, ['rev-parse', 'cms/work'])).toBe(saved);
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('checks out cms/work again when HEAD is on another commit', async () => {
      const root = await newRoot();
      const config = configFor(remote);
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({ config, cmsDir, log: spyLog() });
      await git(repoDir, ['checkout', '--detach', 'origin/main']);
      const state = await ensureRepo({ config, cmsDir, log: spyLog() });
      expect(await git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
        'cms/work\n',
      );
      expect(state.recovered).toBe(false);
    });

    it('takes a changed author on the next start', async () => {
      const root = await newRoot();
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({
        config: configFor(remote, {
          git: { author: 'First <first@example.test>' },
        }),
        cmsDir,
        log: spyLog(),
      });
      await ensureRepo({
        config: configFor(remote, {
          git: { author: 'Second <second@example.test>' },
        }),
        cmsDir,
        log: spyLog(),
      });
      expect(
        await git(repoDir, ['config', '--local', '--get', 'user.name']),
      ).toBe('Second\n');
    });

    it('keeps an ignored file in the working copy when it discards the rest', async () => {
      const root = await newRoot();
      const config = configFor(remote);
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({ config, cmsDir, log: spyLog() });
      await writeFile(join(repoDir, '.git', 'info', 'exclude'), 'cache/\n');
      await mkdir(join(repoDir, 'cache'));
      await writeFile(join(repoDir, 'cache', 'keep.txt'), 'kept\n');
      const state = await ensureRepo({ config, cmsDir, log: spyLog() });
      expect(state.recovered).toBe(false);
      expect(await readFile(join(repoDir, 'cache', 'keep.txt'), 'utf8')).toBe(
        'kept\n',
      );
    });

    it('fetches origin and still leaves cms/work alone', async () => {
      const root = await newRoot();
      const config = configFor(remote);
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({ config, cmsDir, log: spyLog() });
      const other = join(root, 'other');
      await cloneRemote(remote, other);
      const pushed = await commitAndPush(
        other,
        { 'notes/from-other.md': 'hello\n' },
        'other: edit',
      );
      const work = await git(repoDir, ['rev-parse', 'cms/work']);
      await ensureRepo({ config, cmsDir, log: spyLog() });
      expect(await git(repoDir, ['rev-parse', 'origin/main'])).toBe(
        `${pushed}\n`,
      );
      expect(await git(repoDir, ['rev-parse', 'cms/work'])).toBe(work);
    });
  });

  describe('crash recovery', () => {
    // A dirty tree as a crash leaves it: one tracked file edited, one new file in a new folder.
    async function crashDirtyTree(repoDir: string): Promise<void> {
      await writeFile(join(repoDir, 'src', 'config', 'config.json'), '{}\n');
      await mkdir(join(repoDir, 'src', 'content', 'drafts'), {
        recursive: true,
      });
      await writeFile(
        join(repoDir, 'src', 'content', 'drafts', 'new-doc.md'),
        '# draft\n',
      );
    }

    it('discards the unfinished save, logs each removed path, and reports the recovery', async () => {
      const root = await newRoot();
      const config = configFor(remote);
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({ config, cmsDir, log: spyLog() });
      await crashDirtyTree(repoDir);
      const log = spyLog();
      const state = await ensureRepo({ config, cmsDir, log });
      expect(state.recovered).toBe(true);
      expect(await git(repoDir, ['status', '--porcelain'])).toBe('');
      expect(log.warn).toHaveBeenCalledWith(RECOVERED_MESSAGE, {
        paths: ['src/config/config.json', 'src/content/drafts/new-doc.md'],
      });
    });

    it('writes the recovery line to stderr when no logger is injected', async () => {
      const root = await newRoot();
      const config = configFor(remote);
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({ config, cmsDir, log: spyLog() });
      await crashDirtyTree(repoDir);
      const stderr = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      await ensureRepo({ config, cmsDir });
      const lines = stderr.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes(RECOVERED_MESSAGE));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? '')).toEqual({
        paths: ['src/config/config.json', 'src/content/drafts/new-doc.md'],
        time: expect.any(String),
        level: 'warn',
        message: RECOVERED_MESSAGE,
      });
    });

    it('prunes the record of a worktree whose folder a crash removed', async () => {
      const root = await newRoot();
      const config = configFor(remote);
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({ config, cmsDir, log: spyLog() });
      const crashed = join(cmsDir, 'demo', 'worktrees', 'crashed');
      await git(repoDir, ['worktree', 'add', '--detach', crashed, 'cms/work']);
      await rm(crashed, { recursive: true, force: true });
      await ensureRepo({ config, cmsDir, log: spyLog() });
      const records = (await git(repoDir, ['worktree', 'list', '--porcelain']))
        .split('\n')
        .filter((line) => line.startsWith('worktree '));
      expect(records).toHaveLength(1);
    });
  });

  describe('a different origin', () => {
    it('refuses it, changes nothing, and says whether the saves would be lost', async () => {
      const root = await newRoot();
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({
        config: configFor(remote),
        cmsDir,
        log: spyLog(),
      });
      const other = join(root, 'elsewhere.git');
      const mismatch = (saves: string) =>
        `The CMS clone ${repoDir} has origin ${remote}, but the config says ${other}. The CMS will not repoint or re-clone it. ${saves}`;
      await expect(
        ensureRepo({ config: configFor(other), cmsDir, log: spyLog() }),
      ).rejects.toMatchObject({
        name: 'RepoError',
        kind: 'url-mismatch',
        message: mismatch(
          'cms/work has no unpublished saves, so deleting the folder loses nothing.',
        ),
        stderr: '',
      });

      await saveOn(repoDir, 'save.txt');
      await expect(
        ensureRepo({ config: configFor(other), cmsDir, log: spyLog() }),
      ).rejects.toMatchObject({
        kind: 'url-mismatch',
        message: mismatch(
          'cms/work has 1 unpublished save commit(s); deleting the folder would lose them.',
        ),
      });
      expect(await git(repoDir, ['remote', 'get-url', 'origin'])).toBe(
        `${remote}\n`,
      );
    });

    it('says the saves could not be counted when git cannot count them', async () => {
      const root = await newRoot();
      const repoDir = repoDirOf(root);
      await mkdir(join(repoDir, '.git'), { recursive: true });
      const exec: ExecFn = (_file, args) => {
        if (args.includes('get-url'))
          return Promise.resolve({
            stdout: 'https://example.test/other.git\n',
            stderr: '',
          });
        // The clone folder answers as its own repo, so the ownership check passes (repo.ts assertOwnRepo).
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: `${repoDir}\n`, stderr: '' });
        if (args.includes('rev-parse'))
          return Promise.resolve({ stdout: '', stderr: '' });
        return Promise.reject(
          Object.assign(new Error('Command failed'), {
            code: 128,
            killed: false,
            stderr: "fatal: ambiguous argument 'origin/main..cms/work'",
          }),
        );
      };
      await expect(
        ensureRepo({
          config: configFor('https://example.test/demo.git'),
          cmsDir: cmsDirOf(root),
          exec,
          log: spyLog(),
        }),
      ).rejects.toMatchObject({
        kind: 'url-mismatch',
        message: `The CMS clone ${repoDir} has origin https://example.test/other.git, but the config says https://example.test/demo.git. The CMS will not repoint or re-clone it. Whether cms/work has unpublished saves could not be checked.`,
      });
    });

    it('says there are no unpublished saves when cms/work does not exist', async () => {
      const root = await newRoot();
      const cmsDir = cmsDirOf(root);
      const repoDir = repoDirOf(root);
      await ensureRepo({ config: configFor(remote), cmsDir, log: spyLog() });
      await git(repoDir, ['checkout', '--detach']);
      await git(repoDir, ['branch', '-D', 'cms/work']);
      const other = join(root, 'elsewhere.git');
      await expect(
        ensureRepo({ config: configFor(other), cmsDir, log: spyLog() }),
      ).rejects.toMatchObject({
        kind: 'url-mismatch',
        message: `The CMS clone ${repoDir} has origin ${remote}, but the config says ${other}. The CMS will not repoint or re-clone it. cms/work has no unpublished saves, so deleting the folder loses nothing.`,
      });
    });

    it('fails with the git error when counting the saves times out, not with an uncounted message', async () => {
      const root = await newRoot();
      const repoDir = repoDirOf(root);
      await mkdir(join(repoDir, '.git'), { recursive: true });
      const exec: ExecFn = (_file, args) => {
        if (args.includes('get-url'))
          return Promise.resolve({
            stdout: 'https://example.test/other.git\n',
            stderr: '',
          });
        if (args.includes('--show-toplevel'))
          return Promise.resolve({ stdout: `${repoDir}\n`, stderr: '' });
        if (args.includes('rev-parse'))
          return Promise.resolve({ stdout: '', stderr: '' });
        return Promise.reject(
          Object.assign(new Error('Command failed'), {
            killed: true,
            code: null,
            stderr: '',
          }),
        );
      };
      await expect(
        ensureRepo({
          config: configFor('https://example.test/demo.git'),
          cmsDir: cmsDirOf(root),
          exec,
          log: spyLog(),
        }),
      ).rejects.toMatchObject({
        name: 'RepoError',
        kind: 'failed',
        message: expect.stringContaining('timed out after'),
      });
    });
  });

  describe('a site inside a subfolder (siteDir)', () => {
    let siteSeedRoot: string;
    let siteRemote: string;

    beforeAll(async () => {
      siteSeedRoot = await makeTestRoot();
      siteRemote = await seedRemote(siteSeedRoot, {
        siteDir: 'site',
        source: 'git-site',
      });
    }, 60_000);

    afterAll(async () => {
      await removeTestRoot(siteSeedRoot);
    });

    it('joins siteDir to the clone once, and the site files sit under it', async () => {
      const root = await newRoot();
      const state = await ensureRepo({
        config: configFor(siteRemote, { siteDir: 'site' }),
        cmsDir: cmsDirOf(root),
        log: spyLog(),
      });
      expect(state.siteFolder).toBe(join(state.repoDir, 'site'));
      expect(
        await git(state.repoDir, ['ls-files', 'site/astro.config.mjs']),
      ).toBe('site/astro.config.mjs\n');
    });
  });
});

// A clone folder that git does not read as its own repo must not change the repo above it.
describe('a clone folder that is not its own repo', () => {
  let seedRoot: string;
  let remote: string;

  beforeAll(async () => {
    seedRoot = await makeTestRoot();
    remote = await seedRemote(seedRoot, { source: 'git-site' });
  }, 60_000);

  afterAll(async () => {
    await removeTestRoot(seedRoot);
  });

  it('refuses it, and changes no setting or branch of the parent repo', async () => {
    const root = await newRoot();
    const parent = join(root, 'parent');
    const cmsDir = join(parent, '.cms');
    const repoDir = join(cmsDir, 'demo', 'repo');
    await mkdir(parent);
    await git(parent, ['init']);
    await git(parent, ['remote', 'add', 'origin', remote]);
    await git(parent, ['config', 'user.name', 'Parent Owner']);
    await git(parent, ['config', 'user.email', 'parent@example.test']);
    await git(parent, ['config', 'core.hooksPath', '.githooks']);
    // An empty `.git` folder: isRepo sees a repo, but git does not read it, so git would use the parent.
    await mkdir(join(repoDir, '.git'), { recursive: true });
    const settingsBefore = await git(parent, ['config', '--local', '--list']);
    await expect(
      ensureRepo({ config: configFor(remote), cmsDir, log: spyLog() }),
    ).rejects.toMatchObject({
      kind: 'failed',
      message: `The CMS clone ${repoDir} is not a git repository of its own. Git would use a parent repository, so the CMS will not change it. Check or remove the folder by hand, then start the CMS again.`,
      stderr: '',
    });
    expect(await git(parent, ['config', '--local', '--list'])).toBe(
      settingsBefore,
    );
    expect(await git(parent, ['branch', '--list', 'cms/work'])).toBe('');
  });

  it('refuses a .git folder that git cannot read, and keeps the git message', async () => {
    const root = await newRoot();
    const repoDir = repoDirOf(root);
    // No parent repo here: git fails on the empty `.git` folder itself.
    await mkdir(join(repoDir, '.git'), { recursive: true });
    await expect(
      ensureRepo({
        config: configFor(remote),
        cmsDir: cmsDirOf(root),
        log: spyLog(),
      }),
    ).rejects.toMatchObject({
      kind: 'failed',
      message: `The CMS clone ${repoDir} is not a git repository of its own. Git would use a parent repository, so the CMS will not change it. Check or remove the folder by hand, then start the CMS again.`,
      stderr: expect.stringContaining('not a git repository'),
    });
  });

  it('refuses a folder where git prints no work tree', async () => {
    const root = await newRoot();
    const repoDir = repoDirOf(root);
    await mkdir(join(repoDir, '.git'), { recursive: true });
    const exec: ExecFn = () => Promise.resolve({ stdout: '', stderr: '' });
    await expect(
      ensureRepo({
        config: configFor(remote),
        cmsDir: cmsDirOf(root),
        exec,
        log: spyLog(),
      }),
    ).rejects.toMatchObject({
      kind: 'failed',
      message: `The CMS clone ${repoDir} is not a git repository of its own. Git would use a parent repository, so the CMS will not change it. Check or remove the folder by hand, then start the CMS again.`,
      stderr: '',
    });
  });

  it('reports a timeout of the ownership check as git failed, not as a foreign repo', async () => {
    const root = await newRoot();
    const repoDir = repoDirOf(root);
    await mkdir(join(repoDir, '.git'), { recursive: true });
    const exec: ExecFn = () =>
      Promise.reject(
        Object.assign(new Error('Command failed'), {
          killed: true,
          code: null,
          stderr: '',
        }),
      );
    await expect(
      ensureRepo({
        config: configFor(remote),
        cmsDir: cmsDirOf(root),
        exec,
        log: spyLog(),
      }),
    ).rejects.toMatchObject({
      name: 'RepoError',
      kind: 'failed',
      message: expect.stringContaining('timed out after'),
    });
  });
});

describe('ensureRepo finishes an unfinished re-apply (WORKPLAN 2.10b)', () => {
  // Seeded once per file, as the first describe does.
  let seedRoot: string;
  let remote: string;

  beforeAll(async () => {
    seedRoot = await makeTestRoot();
    remote = await seedRemote(seedRoot, { source: 'git-site' });
  }, 60_000);

  afterAll(async () => {
    await removeTestRoot(seedRoot);
  });

  // The refs under refs/heads/cms/ of the clone, as git lists them.
  async function cmsRefsOf(repoDir: string): Promise<string[]> {
    const listed = await git(repoDir, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads/cms/',
    ]);
    return listed.split('\n').filter((ref) => ref !== '');
  }

  // Makes a child of the tip of cms/work that adds `file`. Returns the tip and the child. HEAD is on cms/work at the tip.
  async function childOfWork(
    repoDir: string,
    file: string,
  ): Promise<{ tip: string; child: string }> {
    const tip = (await git(repoDir, ['rev-parse', 'cms/work'])).trim();
    await git(repoDir, ['checkout', '--quiet', '--detach', tip]);
    await writeFile(join(repoDir, file), `${file}\n`);
    await git(repoDir, ['add', '--all']);
    await git(repoDir, ['commit', '--message', `commit: ${file}`]);
    const child = (await git(repoDir, ['rev-parse', 'HEAD'])).trim();
    await git(repoDir, ['checkout', '--quiet', '--force', 'cms/work']);
    return { tip, child };
  }

  // Moves cms/work to `sha` and checks it out, so HEAD and the working copy are at `sha`.
  async function setWork(repoDir: string, sha: string): Promise<void> {
    await git(repoDir, ['update-ref', 'refs/heads/cms/work', sha]);
    await git(repoDir, ['checkout', '--quiet', '--force', 'cms/work']);
  }

  it('moves cms/work to work-next when cms/work still has the old tip (work-prev)', async () => {
    const root = await newRoot();
    const config = configFor(remote);
    const cmsDir = cmsDirOf(root);
    const repoDir = repoDirOf(root);
    await ensureRepo({ config, cmsDir, log: spyLog() });
    const { tip, child } = await childOfWork(repoDir, 'saved.md');
    await git(repoDir, ['update-ref', 'refs/heads/cms/work-next', child]);
    await git(repoDir, ['update-ref', 'refs/heads/cms/work-prev', tip]);
    const log = spyLog();
    await ensureRepo({ config, cmsDir, log });
    expect(await git(repoDir, ['rev-parse', 'cms/work'])).toBe(`${child}\n`);
    expect(await readFile(join(repoDir, 'saved.md'), 'utf8')).toBe(
      'saved.md\n',
    );
    expect(await cmsRefsOf(repoDir)).toEqual(['refs/heads/cms/work']);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('deletes both refs when the move had already happened', async () => {
    const root = await newRoot();
    const config = configFor(remote);
    const cmsDir = cmsDirOf(root);
    const repoDir = repoDirOf(root);
    await ensureRepo({ config, cmsDir, log: spyLog() });
    const { tip, child } = await childOfWork(repoDir, 'saved.md');
    await git(repoDir, ['update-ref', 'refs/heads/cms/work-next', child]);
    await git(repoDir, ['update-ref', 'refs/heads/cms/work-prev', tip]);
    await setWork(repoDir, child);
    const log = spyLog();
    await ensureRepo({ config, cmsDir, log });
    expect(await git(repoDir, ['rev-parse', 'cms/work'])).toBe(`${child}\n`);
    expect(await cmsRefsOf(repoDir)).toEqual(['refs/heads/cms/work']);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('keeps cms/work when it is neither the old tip nor the re-applied commit, and logs both shas', async () => {
    const root = await newRoot();
    const config = configFor(remote);
    const cmsDir = cmsDirOf(root);
    const repoDir = repoDirOf(root);
    await ensureRepo({ config, cmsDir, log: spyLog() });
    const first = await childOfWork(repoDir, 'saved.md');
    const second = await childOfWork(repoDir, 'other.md');
    await git(repoDir, ['update-ref', 'refs/heads/cms/work-next', first.child]);
    await git(repoDir, ['update-ref', 'refs/heads/cms/work-prev', first.tip]);
    await setWork(repoDir, second.child);
    const log = spyLog();
    await ensureRepo({ config, cmsDir, log });
    expect(await git(repoDir, ['rev-parse', 'cms/work'])).toBe(
      `${second.child}\n`,
    );
    expect(await cmsRefsOf(repoDir)).toEqual(['refs/heads/cms/work']);
    expect(log.warn).toHaveBeenCalledWith(
      'An unfinished re-apply left cms/work on a commit that is neither its old tip nor the re-applied commit, so cms/work was kept. The re-applied commit stays in the object store.',
      { kept: second.child, reapplied: first.child },
    );
  });

  it('deletes a leftover work-prev once the move has finished', async () => {
    const root = await newRoot();
    const config = configFor(remote);
    const cmsDir = cmsDirOf(root);
    const repoDir = repoDirOf(root);
    await ensureRepo({ config, cmsDir, log: spyLog() });
    const tip = (await git(repoDir, ['rev-parse', 'cms/work'])).trim();
    await git(repoDir, ['update-ref', 'refs/heads/cms/work-prev', tip]);
    await ensureRepo({ config, cmsDir, log: spyLog() });
    expect(await git(repoDir, ['rev-parse', 'cms/work'])).toBe(`${tip}\n`);
    expect(await cmsRefsOf(repoDir)).toEqual(['refs/heads/cms/work']);
  });

  it('creates cms/work at work-next when cms/work is missing', async () => {
    const root = await newRoot();
    const config = configFor(remote);
    const cmsDir = cmsDirOf(root);
    const repoDir = repoDirOf(root);
    await ensureRepo({ config, cmsDir, log: spyLog() });
    const { tip, child } = await childOfWork(repoDir, 'saved.md');
    await git(repoDir, ['checkout', '--quiet', '--detach', tip]);
    await git(repoDir, ['update-ref', '-d', 'refs/heads/cms/work']);
    await git(repoDir, ['update-ref', 'refs/heads/cms/work-next', child]);
    const log = spyLog();
    await ensureRepo({ config, cmsDir, log });
    expect(await git(repoDir, ['rev-parse', 'cms/work'])).toBe(`${child}\n`);
    expect(await readFile(join(repoDir, 'saved.md'), 'utf8')).toBe(
      'saved.md\n',
    );
    expect(await cmsRefsOf(repoDir)).toEqual(['refs/heads/cms/work']);
  });
  it('fails when reading a ref fails for a reason other than a missing ref', async () => {
    const root = await newRoot();
    const config = configFor(remote);
    const cmsDir = cmsDirOf(root);
    await ensureRepo({ config, cmsDir, log: spyLog() });
    // The ref read is killed by the timeout: that is an error, not "the ref is missing".
    const killed: ExecFn = (file, args, options) =>
      args.includes('--verify')
        ? Promise.reject(Object.assign(new Error('killed'), { killed: true }))
        : realExec(file, args, options);
    await expect(
      ensureRepo({ config, cmsDir, log: spyLog(), exec: killed }),
    ).rejects.toMatchObject({
      kind: 'failed',
      message:
        'git rev-parse --verify --quiet refs/heads/cms/work-next timed out after 60000 ms',
    });
  });
});

describe('ensureRepo errors from git', () => {
  const GITHUB = 'https://github.com/owner/repo.git';
  const GITHUB_SSH = 'git@github.com:owner/repo.git';
  const GITLAB = 'https://gitlab.com/owner/repo.git';
  const AUTH_HTTPS =
    "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/owner/repo.git/'\n";
  const AUTH_SSH =
    'git@github.com: Permission denied (publickey).\r\nfatal: Could not read from remote repository.\n';
  const NOT_FOUND =
    "remote: Repository not found.\nfatal: repository 'https://github.com/owner/repo.git/' not found\n";
  const UNKNOWN = 'fatal: unable to access the remote: connection reset\n';

  // The clone is the first git call of a fresh folder, so a failing clone answers each row.
  it.each<{
    name: string;
    remote: string;
    stderr: string;
    kind: string;
    message: (repoDir: string) => string;
  }>([
    {
      name: 'an HTTPS sign-in failure on GitHub',
      remote: GITHUB,
      stderr: AUTH_HTTPS,
      kind: 'auth-failed',
      message: () =>
        `Git could not sign in to ${GITHUB}. Check the machine's git credential helper or SSH key.`,
    },
    {
      name: 'an SSH key failure on GitHub',
      remote: GITHUB_SSH,
      stderr: AUTH_SSH,
      kind: 'auth-failed',
      message: () =>
        `Git could not sign in to ${GITHUB_SSH}. Check the machine's git credential helper or SSH key.`,
    },
    {
      name: 'a repository that GitHub does not find',
      remote: GITHUB,
      stderr: NOT_FOUND,
      kind: 'remote-not-found',
      message: () =>
        `The remote ${GITHUB} was not found, or this machine has no access to it. Check the URL.`,
    },
    {
      name: 'an unrecognised GitHub failure, which keeps git stderr',
      remote: GITHUB,
      stderr: UNKNOWN,
      kind: 'failed',
      message: (repoDir) =>
        `git clone -c core.autocrlf=false --branch main -- ${GITHUB} ${repoDir} failed (exit 128): ${UNKNOWN.trim()}`,
    },
    {
      name: 'a sign-in failure on another host, which is not classified',
      remote: GITLAB,
      stderr: AUTH_HTTPS,
      kind: 'failed',
      message: (repoDir) =>
        `git clone -c core.autocrlf=false --branch main -- ${GITLAB} ${repoDir} failed (exit 128): ${AUTH_HTTPS.trim()}`,
    },
  ])(
    'maps $name to a RepoError of kind $kind',
    async ({ remote, stderr, kind, message }) => {
      const root = await newRoot();
      const repoDir = repoDirOf(root);
      await expect(
        ensureRepo({
          config: configFor(remote),
          cmsDir: cmsDirOf(root),
          exec: failingExec(stderr),
          log: spyLog(),
        }),
      ).rejects.toMatchObject({
        name: 'RepoError',
        kind,
        message: message(repoDir),
        stderr,
      });
    },
  );

  it('does not read the stderr of a timeout as a sign-in failure', async () => {
    const root = await newRoot();
    const exec: ExecFn = () =>
      Promise.reject(
        Object.assign(new Error('Command failed'), {
          killed: true,
          code: null,
          stderr: AUTH_HTTPS,
        }),
      );
    await expect(
      ensureRepo({
        config: configFor(GITHUB),
        cmsDir: cmsDirOf(root),
        exec,
        log: spyLog(),
      }),
    ).rejects.toMatchObject({
      name: 'RepoError',
      kind: 'failed',
      message: expect.stringContaining('timed out after'),
    });
  });

  it('rethrows a timed-out ref lookup, so the start stops instead of creating the work branch', async () => {
    const remote = 'https://example.test/site.git';
    const root = await newRoot();
    const repoDir = repoDirOf(root);
    await mkdir(join(repoDir, '.git'), { recursive: true });
    const exec: ExecFn = (_file, args) => {
      if (args.includes('get-url'))
        return Promise.resolve({ stdout: `${remote}\n`, stderr: '' });
      if (args.includes('--show-toplevel'))
        return Promise.resolve({ stdout: `${repoDir}\n`, stderr: '' });
      if (args.includes('--verify'))
        return Promise.reject(
          Object.assign(new Error('Command failed'), {
            killed: true,
            code: null,
            stderr: '',
          }),
        );
      return Promise.resolve({ stdout: '', stderr: '' });
    };
    await expect(
      ensureRepo({
        config: configFor(remote),
        cmsDir: cmsDirOf(root),
        exec,
        log: spyLog(),
      }),
    ).rejects.toMatchObject({
      name: 'RepoError',
      kind: 'failed',
      message: expect.stringContaining('timed out after'),
    });
  });

  it('trims the spaces around git.author before it reads the name and the email', async () => {
    const remote = 'https://example.test/site.git';
    const root = await newRoot();
    const repoDir = repoDirOf(root);
    await mkdir(join(repoDir, '.git'), { recursive: true });
    const calls: string[][] = [];
    const exec: ExecFn = (_file, args) => {
      calls.push([...args]);
      if (args.includes('get-url'))
        return Promise.resolve({ stdout: `${remote}\n`, stderr: '' });
      if (args.includes('--show-toplevel'))
        return Promise.resolve({ stdout: `${repoDir}\n`, stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' });
    };
    await ensureRepo({
      config: configFor(remote, {
        git: { author: '  Ada Lovelace <ada@example.test>  ' },
      }),
      cmsDir: cmsDirOf(root),
      exec,
      log: spyLog(),
    });
    const written = calls.map((args) => args.slice(-2));
    expect(written).toContainEqual(['user.name', 'Ada Lovelace']);
    expect(written).toContainEqual(['user.email', 'ada@example.test']);
  });

  it('refuses an author without an email, before any git call', async () => {
    const root = await newRoot();
    const exec: ExecFn = vi.fn(() =>
      Promise.resolve({ stdout: '', stderr: '' }),
    );
    await expect(
      ensureRepo({
        config: configFor(GITHUB, { git: { author: 'no-email' } }),
        cmsDir: cmsDirOf(root),
        exec,
        log: spyLog(),
      }),
    ).rejects.toMatchObject({
      kind: 'failed',
      message: 'git.author must look like "Name <email>"',
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('reports an invalid branch name as failed, before any git call', async () => {
    const root = await newRoot();
    const exec: ExecFn = vi.fn(() =>
      Promise.resolve({ stdout: '', stderr: '' }),
    );
    await expect(
      ensureRepo({
        config: configFor(GITHUB, { branch: 'a..b' }),
        cmsDir: cmsDirOf(root),
        exec,
        log: spyLog(),
      }),
    ).rejects.toMatchObject({
      kind: 'failed',
      message: 'invalid ref: "a..b"',
    });
    expect(exec).not.toHaveBeenCalled();
  });
});
