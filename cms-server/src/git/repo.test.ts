import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
import type { ExecFn } from './exec.ts';
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
    remote = await seedRemote(seedRoot);
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
  });

  describe('a site inside a subfolder (siteDir)', () => {
    let siteSeedRoot: string;
    let siteRemote: string;

    beforeAll(async () => {
      siteSeedRoot = await makeTestRoot();
      siteRemote = await seedRemote(siteSeedRoot, { siteDir: 'site' });
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
