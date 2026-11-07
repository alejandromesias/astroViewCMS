// Builds a worktree's node_modules from junctions to the main checkout's (WORKPLAN 2.1n).
// Third-party packages are shared, nothing is copied or installed. Workspace packages
// (links in main that point into main) become junctions to the worktree's own folders, so
// a worktree imports its own source. Junctions need no admin rights or Developer Mode on Windows.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

export const MARKER = '.avc-linked';

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

export interface LinkSummary {
  // Junctions created by this call (0 when everything was already in place).
  linked: number;
  // Files copied (the .bin shims).
  copied: number;
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// Removes a link itself. A junction is a directory on Windows, so it needs rmdir; nothing is followed.
function unlinkLink(path: string): void {
  if (process.platform === 'win32') rmdirSync(path);
  else unlinkSync(path);
}

function junction(target: string, path: string, summary: LinkSummary): void {
  if (existsSync(path) || isLink(path)) {
    if (!isLink(path)) throw new Error(`${path} is a real folder, not a link; refusing to replace it`);
    if (realpathSync(path) === realpathSync(target)) return;
    unlinkLink(path);
  }
  symlinkSync(target, path, LINK_TYPE);
  summary.linked += 1;
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function linkLevel(
  src: string,
  dst: string,
  mainReal: string,
  worktreeRoot: string,
  summary: LinkSummary,
): void {
  for (const name of readdirSync(src)) {
    // Caches and tool state (.vite, .vitest) stay per worktree; .bin is copied below.
    if (name.startsWith('.') && name !== '.bin') continue;
    const from = join(src, name);
    const to = join(dst, name);
    const info = lstatSync(from);

    if (info.isSymbolicLink()) {
      const target = realpathSync(from);
      const shared = isInside(target, mainReal)
        ? join(worktreeRoot, relative(mainReal, target))
        : target;
      junction(shared, to, summary);
      continue;
    }
    if (name === '.bin') {
      mkdirSync(to, { recursive: true });
      for (const shim of readdirSync(from)) {
        copyFileSync(join(from, shim), join(to, shim));
        summary.copied += 1;
      }
      continue;
    }
    if (info.isDirectory() && name.startsWith('@')) {
      mkdirSync(to, { recursive: true });
      linkLevel(from, to, mainReal, worktreeRoot, summary);
      continue;
    }
    if (info.isDirectory()) {
      junction(from, to, summary);
      continue;
    }
    copyFileSync(from, to);
    summary.copied += 1;
  }
}

// Builds worktreeRoot/node_modules from mainRoot/node_modules. Safe to run again: links already
// in place are left alone. Refuses a node_modules that is not one of ours (no marker), so a real
// install is never mixed with junctions.
export function linkModules(mainRoot: string, worktreeRoot: string): LinkSummary {
  const mainReal = realpathSync(mainRoot);
  const src = join(mainReal, 'node_modules');
  const dst = join(worktreeRoot, 'node_modules');
  if (existsSync(dst) && !existsSync(join(dst, MARKER))) {
    throw new Error(`${dst} exists and is not a linked folder; remove it or use --own-install`);
  }
  mkdirSync(dst, { recursive: true });
  const summary: LinkSummary = { linked: 0, copied: 0 };
  linkLevel(src, dst, mainReal, worktreeRoot, summary);
  writeFileSync(join(dst, MARKER), 'linked by scripts/worktree.ts (WORKPLAN 2.1n)\n');
  return summary;
}

// Removes worktreeRoot/node_modules. Links are removed as links and never followed, so the main
// checkout's packages are untouched. Returns the number of entries removed.
export function removeLinkedModules(worktreeRoot: string): number {
  const dst = join(worktreeRoot, 'node_modules');
  if (!existsSync(dst) && !isLink(dst)) return 0;
  let removed = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      removed += 1;
      if (isLink(path)) unlinkLink(path);
      else if (lstatSync(path).isDirectory()) {
        walk(path);
        rmdirSync(path);
      } else unlinkSync(path);
    }
  };
  if (isLink(dst)) {
    unlinkLink(dst);
    return 1;
  }
  walk(dst);
  rmdirSync(dst);
  return removed + 1;
}
