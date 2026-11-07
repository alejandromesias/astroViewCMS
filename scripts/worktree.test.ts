import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MARKER } from './lib/link-modules.ts';
import {
  guardLinked,
  linkWorktree,
  lockfileMismatch,
  newWorktree,
  removeWorktree,
} from './worktree.ts';

// Each test runs in its own temp folder: a real git repo with one commit on `main`, and
// a node_modules folder that the commit does not track (as in the real repo).
let root: string;
let main: string;

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'avc-wt-'));
  main = join(root, 'astroViewCMS');
  mkdirSync(join(main, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(
    join(main, 'node_modules', 'left-pad', 'index.js'),
    'main left-pad',
  );
  writeFileSync(join(main, 'package.json'), '{"name":"fixture"}\n');
  writeFileSync(join(main, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(main, '.gitignore'), 'node_modules/\n');
  git(main, ['init', '-b', 'main']);
  git(main, ['add', '-A']);
  git(main, [
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'init',
  ]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('newWorktree and removeWorktree', () => {
  it('adds a task branch and worktree from main, linked to main packages', () => {
    const dir = newWorktree(main, '2.9z', 'demo', false);
    expect(dir).toBe(join(root, 'avc-wt', '2.9z'));
    expect(git(dir, ['branch', '--show-current'])).toBe('task/2.9z-demo');
    expect(existsSync(join(dir, 'node_modules', MARKER))).toBe(true);
    expect(
      readFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), 'utf8'),
    ).toBe('main left-pad');
    expect(realpathSync(join(dir, 'node_modules', 'left-pad'))).toBe(
      realpathSync(join(main, 'node_modules', 'left-pad')),
    );
  });

  it('removes the worktree, unlinks first, and keeps the branch and main packages', () => {
    const dir = newWorktree(main, '2.9z', 'demo', false);
    removeWorktree(main, dir, false);
    expect(existsSync(dir)).toBe(false);
    expect(
      git(main, ['rev-parse', '--verify', 'refs/heads/task/2.9z-demo']).length,
    ).toBeGreaterThan(0);
    expect(
      readFileSync(join(main, 'node_modules', 'left-pad', 'index.js'), 'utf8'),
    ).toBe('main left-pad');
  });

  it('refuses a bad task id, a bad slug and an existing branch', () => {
    expect(() => newWorktree(main, 'bad', 'demo', false)).toThrow(
      /must look like 2.1n/,
    );
    expect(() => newWorktree(main, '2.9z', 'Demo Name', false)).toThrow(
      /lowercase words/,
    );
    newWorktree(main, '2.9z', 'demo', false);
    expect(() => newWorktree(main, '2.9z', 'other', false)).toThrow(
      /already exists/,
    );
    git(main, ['branch', 'task/2.9y-demo']);
    expect(() => newWorktree(main, '2.9y', 'demo', false)).toThrow(
      /branch task\/2.9y-demo already exists/,
    );
  });

  it('refuses to remove a worktree with changes unless forced', () => {
    const dir = newWorktree(main, '2.9z', 'demo', false);
    writeFileSync(join(dir, 'note.txt'), 'uncommitted');
    expect(() => removeWorktree(main, dir, false)).toThrow(/has changes/);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('lockfileMismatch', () => {
  it('reports the lockfile when it differs from main', () => {
    const dir = join(root, 'other');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}\n');
    writeFileSync(
      join(dir, 'package-lock.json'),
      '{"lockfileVersion":3,"changed":true}\n',
    );
    expect(lockfileMismatch(main, dir)).toBe('package-lock.json');
    writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3}\n');
    expect(lockfileMismatch(main, dir)).toBeUndefined();
  });

  it('reports package.json only when a dependency field differs; scripts do not count', () => {
    const dir = join(root, 'other');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package-lock.json'), '{"lockfileVersion":3}\n');
    writeFileSync(
      join(dir, 'package.json'),
      '{"name":"fixture","scripts":{"x":"y"}}\n',
    );
    expect(lockfileMismatch(main, dir)).toBeUndefined();
    writeFileSync(
      join(dir, 'package.json'),
      '{"name":"fixture","devDependencies":{"left-pad":"1.0.0"}}\n',
    );
    expect(lockfileMismatch(main, dir)).toBe('package.json');
  });
});

describe('linkWorktree', () => {
  it('refuses a real node_modules, and replaces it with replace = true', () => {
    const dir = join(root, 'wt');
    mkdirSync(join(dir, 'node_modules', 'real'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'real', 'index.js'), 'own install');
    writeFileSync(
      join(dir, 'package.json'),
      readFileSync(join(main, 'package.json')),
    );
    writeFileSync(
      join(dir, 'package-lock.json'),
      readFileSync(join(main, 'package-lock.json')),
    );
    expect(() => linkWorktree(main, dir, false)).toThrow(
      /exists and is not a linked folder/,
    );
    linkWorktree(main, dir, true);
    expect(existsSync(join(dir, 'node_modules', 'real'))).toBe(false);
    expect(
      readFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), 'utf8'),
    ).toBe('main left-pad');
  });
});

describe('guardLinked', () => {
  it('exits 1 in a linked folder and 0 elsewhere', () => {
    const dir = join(root, 'linked');
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    expect(guardLinked(dir)).toBe(0);
    writeFileSync(join(dir, 'node_modules', MARKER), 'marker');
    expect(guardLinked(dir)).toBe(1);
  });
});
