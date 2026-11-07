import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MARKER, linkModules, removeLinkedModules } from './link-modules.ts';

// Each test gets its own folders: a fake main checkout (with node_modules and two workspace
// packages) and a worktree with its own copy of one workspace package.
let root: string;
let main: string;
let worktree: string;

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

// A workspace link as npm makes it: a directory link from main's node_modules into main's package.
function workspaceLink(from: string, target: string): void {
  symlinkSync(target, from, process.platform === 'win32' ? 'junction' : 'dir');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'avc-link-'));
  main = join(root, 'main');
  worktree = join(root, 'wt');
  write(join(main, 'node_modules', 'left-pad', 'index.js'), 'main left-pad');
  write(join(main, 'node_modules', '@scope', 'pkg', 'index.js'), 'main scoped');
  write(join(main, 'node_modules', '.bin', 'vitest.cmd'), 'shim');
  write(join(main, 'node_modules', '.vite', 'cache.json'), 'main cache');
  write(join(main, 'preview-protocol', 'src', 'index.ts'), 'main protocol');
  workspaceLink(join(main, 'node_modules', 'preview-protocol'), join(main, 'preview-protocol'));
  write(join(worktree, 'preview-protocol', 'src', 'index.ts'), 'worktree protocol');
  mkdirSync(worktree, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('linkModules', () => {
  it('points third-party packages at the main folder', () => {
    linkModules(main, worktree);
    const path = join(worktree, 'node_modules', 'left-pad', 'index.js');
    expect(lstatSync(join(worktree, 'node_modules', 'left-pad')).isSymbolicLink()).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('main left-pad');
  });

  it('points workspace packages at the worktree, not at main', () => {
    linkModules(main, worktree);
    const linked = join(worktree, 'node_modules', 'preview-protocol');
    expect(realpathSync(linked)).toBe(realpathSync(join(worktree, 'preview-protocol')));
    expect(readFileSync(join(linked, 'src', 'index.ts'), 'utf8')).toBe('worktree protocol');
  });

  it('does not link dot-entries, and copies .bin', () => {
    linkModules(main, worktree);
    expect(existsSync(join(worktree, 'node_modules', '.vite'))).toBe(false);
    expect(lstatSync(join(worktree, 'node_modules', '.bin', 'vitest.cmd')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(worktree, 'node_modules', '.bin', 'vitest.cmd'), 'utf8')).toBe('shim');
  });

  it('links scoped packages one by one inside a real scope folder', () => {
    linkModules(main, worktree);
    const scope = join(worktree, 'node_modules', '@scope');
    expect(lstatSync(scope).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(scope, 'pkg')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(scope, 'pkg', 'index.js'), 'utf8')).toBe('main scoped');
  });

  it('writes the marker and reports what it did', () => {
    const summary = linkModules(main, worktree);
    expect(existsSync(join(worktree, 'node_modules', MARKER))).toBe(true);
    expect(summary.linked).toBe(3);
    expect(summary.copied).toBe(1);
  });

  it('runs again without changing anything', () => {
    linkModules(main, worktree);
    const second = linkModules(main, worktree);
    expect(second.linked).toBe(0);
    expect(readFileSync(join(worktree, 'node_modules', 'left-pad', 'index.js'), 'utf8')).toBe('main left-pad');
  });

  it('refuses a node_modules that was not made by this module', () => {
    write(join(worktree, 'node_modules', 'real-pkg', 'index.js'), 'real install');
    expect(() => linkModules(main, worktree)).toThrow(/exists and is not a linked folder/);
    expect(readFileSync(join(worktree, 'node_modules', 'real-pkg', 'index.js'), 'utf8')).toBe('real install');
  });
});

describe('removeLinkedModules', () => {
  it('removes the links without touching main', () => {
    linkModules(main, worktree);
    const removed = removeLinkedModules(worktree);
    expect(removed).toBeGreaterThan(0);
    expect(existsSync(join(worktree, 'node_modules'))).toBe(false);
    expect(readFileSync(join(main, 'node_modules', 'left-pad', 'index.js'), 'utf8')).toBe('main left-pad');
    expect(readFileSync(join(main, 'preview-protocol', 'src', 'index.ts'), 'utf8')).toBe('main protocol');
    expect(readFileSync(join(main, 'node_modules', '@scope', 'pkg', 'index.js'), 'utf8')).toBe('main scoped');
  });

  it('returns 0 when there is nothing to remove', () => {
    expect(removeLinkedModules(worktree)).toBe(0);
  });
});
