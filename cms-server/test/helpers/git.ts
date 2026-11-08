// Git test harness: real repositories in a temp folder inside the workspace.
// Every git call goes through git(), so the machine's git settings (CRLF,
// signing, credential helpers) cannot change a result. Test code only; it is
// outside Stryker's mutate and the coverage include.
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMP_ROOT = fileURLToPath(new URL('../../.test-tmp/', import.meta.url));
// Git must not look for a repo above the test folders. A test folder without its own .git would otherwise
// use the main checkout, and a test could switch its branch or change its config. Set before any git call.
process.env.GIT_CEILING_DIRECTORIES = TEMP_ROOT;
// The folders seedRemote can commit: sample-site (the default), and the git-site fixture for the git tests.
export type SeedSource = 'sample-site' | 'git-site';
const SITES: Record<SeedSource, string> = {
  'sample-site': fileURLToPath(
    new URL('../../../sample-site/', import.meta.url),
  ),
  'git-site': fileURLToPath(new URL('../fixtures/git-site/', import.meta.url)),
};
// Build output and installed packages are not part of a site's source.
const NOT_COPIED = new Set(['node_modules', 'dist', '.astro']);

// Settings that every call carries, so a result never depends on the machine.
const SETTINGS = [
  '-c',
  'user.name=Developer',
  '-c',
  'user.email=developer@example.invalid',
  '-c',
  'core.autocrlf=false',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'init.defaultBranch=main',
];

// git cannot open the `\\.\nul` path that os.devNull gives on Windows, so use `NUL`.
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

// The user's global and system git config is replaced by the null device, and
// inherited GIT_* variables (GIT_DIR, GIT_INDEX_FILE from a hook) are dropped.
const ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  ),
  GIT_CONFIG_GLOBAL: NULL_DEVICE,
  GIT_CONFIG_SYSTEM: NULL_DEVICE,
  GIT_TERMINAL_PROMPT: '0',
};

/** Runs git in `cwd` with no shell. Resolves with stdout; rejects with git's stderr. */
export function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...SETTINGS, ...args],
      { cwd, env: ENV, encoding: 'utf8', windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** A new, empty folder under cms-server/.test-tmp/. Call once per test. */
export async function makeTestRoot(): Promise<string> {
  await mkdir(TEMP_ROOT, { recursive: true });
  return mkdtemp(join(TEMP_ROOT, 'case-'));
}

/** Removes a folder made by makeTestRoot, with everything in it. */
// Windows keeps a file locked for a moment after a git child exits (EBUSY, EPERM); maxRetries waits it out.
export async function removeTestRoot(root: string): Promise<void> {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

/**
 * Makes a bare remote under `root` and a first commit holding the `source` folder (sample-site by default).
 * With `siteDir`, the site sits in that subfolder (a `siteDir` setting).
 * Returns the remote path.
 */
export async function seedRemote(
  root: string,
  options: { siteDir?: string; source?: SeedSource } = {},
): Promise<string> {
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const siteFolder = options.siteDir ? join(seed, options.siteDir) : seed;
  await git(root, ['init', '--bare', remote]);
  await mkdir(seed);
  await git(seed, ['init']);
  await cp(SITES[options.source ?? 'sample-site'], siteFolder, {
    recursive: true,
    filter: (source) => !NOT_COPIED.has(basename(source)),
  });
  await git(seed, ['add', '--all']);
  await git(seed, ['commit', '--message', 'seed: sample site']);
  await git(seed, ['remote', 'add', 'origin', remote]);
  await git(seed, ['push', 'origin', 'HEAD:main']);
  return remote;
}

/** Clones `remote` into `dir` (a second person's working copy). Returns `dir`. */
export async function cloneRemote(
  remote: string,
  dir: string,
): Promise<string> {
  await git(dirname(dir), ['clone', remote, dir]);
  return dir;
}

/**
 * Writes `files` (relative path to content) in the clone at `dir`, commits them
 * and pushes to origin. Resolves with the new commit id.
 */
export async function commitAndPush(
  dir: string,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(dir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await git(dir, ['add', '--all']);
  await git(dir, ['commit', '--message', message]);
  await git(dir, ['push', 'origin', 'HEAD']);
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

/** Reads a file from a clone or folder. */
export function readText(dir: string, relativePath: string): Promise<string> {
  return readFile(join(dir, relativePath), 'utf8');
}
