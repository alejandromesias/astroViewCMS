// Worktrees for task branches (WORKPLAN 2.1n). Run from the repo root:
//   npm run worktree -- new <id> <slug> [--own-install]   add task/<id>-<slug> from main, then link
//   npm run worktree -- link [<dir>] [--replace]           build or refresh node_modules junctions
//                                                          (--replace: first remove the folder's own node_modules)
//   npm run worktree -- remove <dir> [--force]             unlink, then git worktree remove (keeps the branch)
//   npm run worktree -- guard                              exits 1 in a linked worktree (root preinstall)
// The folders live in <CMSProject>\avc-wt\<id>, next to the repo. See DOCS/README.md, "Worktrees".
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MARKER,
  linkModules,
  removeLinkedModules,
} from './lib/link-modules.ts';

const ID = /^\d+\.\d+[a-z]$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEPENDENCY_KEYS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
  'workspaces',
] as const;

function git(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function gitText(cwd: string, args: string[]): string {
  const result = git(cwd, args);
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function worktreesDir(mainRoot: string): string {
  return join(dirname(mainRoot), 'avc-wt');
}

// The dependency fields of package.json (scripts and metadata do not change what is installed).
function dependencyShape(path: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<
    string,
    unknown
  >;
  return JSON.stringify(
    DEPENDENCY_KEYS.map((key) => [key, manifest[key] ?? null]),
  );
}

// The first file whose dependencies differ from main's, or undefined. A linked worktree shares
// main's packages, so they must match main's; otherwise the task needs its own install.
export function lockfileMismatch(
  mainRoot: string,
  worktreeRoot: string,
): string | undefined {
  if (
    dependencyShape(join(mainRoot, 'package.json')) !==
    dependencyShape(join(worktreeRoot, 'package.json'))
  ) {
    return 'package.json';
  }
  const lockInMain = readFileSync(join(mainRoot, 'package-lock.json'), 'utf8');
  const lockInWorktree = readFileSync(
    join(worktreeRoot, 'package-lock.json'),
    'utf8',
  );
  return lockInMain === lockInWorktree ? undefined : 'package-lock.json';
}

function setUp(mainRoot: string, dir: string, ownInstall: boolean): void {
  if (ownInstall) {
    const install = spawnSync('npm ci', {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
    });
    if (install.status !== 0) throw new Error(`npm ci failed in ${dir}`);
    return;
  }
  const mismatch = lockfileMismatch(mainRoot, dir);
  if (mismatch !== undefined) {
    throw new Error(
      `${mismatch} differs from main's. Merge main into the branch first, or use --own-install.`,
    );
  }
  const summary = linkModules(mainRoot, dir);
  console.log(
    `linked ${summary.linked} packages, copied ${summary.copied} files into ${dir}`,
  );
}

export function newWorktree(
  mainRoot: string,
  id: string,
  slug: string,
  ownInstall: boolean,
): string {
  if (!ID.test(id)) throw new Error(`task id "${id}" must look like 2.1n`);
  if (!SLUG.test(slug))
    throw new Error(`slug "${slug}" must be lowercase words joined by dashes`);
  const branch = `task/${id}-${slug}`;
  const dir = join(worktreesDir(mainRoot), id);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  if (
    git(mainRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
      .status === 0
  ) {
    throw new Error(`branch ${branch} already exists`);
  }
  mkdirSync(worktreesDir(mainRoot), { recursive: true });
  gitText(mainRoot, ['worktree', 'add', '-b', branch, dir, 'main']);
  try {
    setUp(mainRoot, dir, ownInstall);
  } catch (error) {
    throw new Error(
      `worktree ${dir} is created on ${branch}, but setup failed: ${(error as Error).message}. ` +
        'Fix it and run `link`, or `remove` the worktree.',
    );
  }
  return dir;
}

// `replace` first removes the folder's own node_modules (never main's), for a worktree whose
// install pruned the links or was run by hand.
export function linkWorktree(
  mainRoot: string,
  dir: string,
  replace: boolean,
): void {
  const abs = resolve(dir);
  if (replace) removeLinkedModules(abs);
  setUp(mainRoot, abs, false);
}

export function removeWorktree(
  mainRoot: string,
  dir: string,
  force: boolean,
): void {
  const abs = resolve(dir);
  if (!force && gitText(abs, ['status', '--porcelain']) !== '') {
    throw new Error(
      `${abs} has changes; commit or stash them, or pass --force`,
    );
  }
  const removed = removeLinkedModules(abs);
  console.log(`unlinked ${removed} entries from ${join(abs, 'node_modules')}`);
  gitText(mainRoot, ['worktree', 'remove', ...(force ? ['--force'] : []), abs]);
}

// Exit code for the root preinstall: 1 when the folder is a linked worktree.
export function guardLinked(dir: string): number {
  if (!existsSync(join(dir, 'node_modules', MARKER))) return 0;
  console.error(
    'This worktree shares node_modules with main (linked by `npm run worktree`). An install here ' +
      'removes the shared links and reinstalls this worktree alone. For a task that changes dependencies, ' +
      'use `new --own-install`. To go back to the shared packages, run `link --replace`.',
  );
  return 1;
}

// The main checkout, found through git's common folder, so the commands work from a linked worktree too.
function mainCheckout(cwd: string): string {
  const commonDir = gitText(cwd, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  return realpathSync(dirname(commonDir));
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const force = rest.includes('--force');
  const ownInstall = rest.includes('--own-install');
  const replace = rest.includes('--replace');
  const args = rest.filter((arg) => !arg.startsWith('--'));
  try {
    switch (command) {
      case 'new': {
        const [id, slug] = args;
        if (id === undefined || slug === undefined)
          throw new Error('usage: new <id> <slug> [--own-install]');
        console.log(
          `created ${newWorktree(mainCheckout(process.cwd()), id, slug, ownInstall)}`,
        );
        return 0;
      }
      case 'link':
        linkWorktree(
          mainCheckout(process.cwd()),
          args[0] ?? process.cwd(),
          replace,
        );
        return 0;
      case 'remove': {
        if (args[0] === undefined)
          throw new Error('usage: remove <dir> [--force]');
        removeWorktree(mainCheckout(process.cwd()), args[0], force);
        return 0;
      }
      case 'guard':
        return guardLinked(process.cwd());
      default:
        throw new Error('usage: worktree.ts new | link | remove | guard');
    }
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = main(process.argv.slice(2));
}
