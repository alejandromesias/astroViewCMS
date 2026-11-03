// A local stand-in for the site's GitHub remote (WORKPLAN 2.1i, manual run). It seeds a bare repo at
// <repo>/.dev/remote.git from sample-site (once: an existing remote is left alone, because the CMS's clone
// may already hold saves), and writes <repo>/cms.config.ts from cms.config.example.ts with that remote.
// Both are gitignored. Run `npm run dev:remote -w cms-server`, then
// `npm start -w cms-server -- ../cms.config.ts`.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = resolve(import.meta.dirname, '../..');
const SAMPLE_SITE = join(REPO, 'sample-site');
const REMOTE_DIR = join(REPO, '.dev', 'remote.git');
const EXAMPLE = join(REPO, 'cms.config.example.ts');
const CONFIG = join(REPO, 'cms.config.ts');
// Build output and installed packages are not part of a site's source.
const NOT_COPIED = new Set(['node_modules', 'dist', '.astro']);
// The one line of the example that names the remote. Its indent is kept.
const REMOTE_LINE = /^([ \t]*)remote: '[^']*',[ \t]*$/gm;
// Settings every git call carries, so the result does not depend on the machine.
const GIT_SETTINGS = [
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

/** Runs git in `cwd`, with the settings above. Throws git's error output when it fails. */
function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...GIT_SETTINGS, ...args], {
    cwd,
    stdio: 'pipe',
    windowsHide: true,
  });
}

/** The example config with its remote line set to `remote`. Throws unless the example has exactly one such line. */
export function renderConfig(example: string, remote: string): string {
  const found = [...example.matchAll(REMOTE_LINE)];
  if (found.length !== 1) {
    throw new Error(
      `cms.config.example.ts must have one remote line, found ${found.length}`,
    );
  }
  return example.replace(
    REMOTE_LINE,
    (_line: string, indent: string) =>
      `${indent}remote: ${JSON.stringify(remote)},`,
  );
}

/** Makes the bare repo at `remoteDir` with one commit of the files in `siteDir`. Does nothing when `remoteDir` exists. */
export function seedRemote(remoteDir: string, siteDir: string): void {
  if (existsSync(remoteDir)) return;
  mkdirSync(remoteDir, { recursive: true });
  git(remoteDir, ['init', '--bare']);
  const seed = mkdtempSync(join(tmpdir(), 'cms-seed-'));
  try {
    cpSync(siteDir, seed, {
      recursive: true,
      filter: (source) => !NOT_COPIED.has(basename(source)),
    });
    git(seed, ['init']);
    git(seed, ['add', '--all']);
    git(seed, ['commit', '--message', 'seed: sample site']);
    git(seed, ['remote', 'add', 'origin', remoteDir]);
    git(seed, ['push', 'origin', 'HEAD:main']);
  } finally {
    rmSync(seed, { recursive: true, force: true });
  }
}

/** Seeds the remote, then writes cms.config.ts for it. */
function main(): void {
  seedRemote(REMOTE_DIR, SAMPLE_SITE);
  const remote = pathToFileURL(REMOTE_DIR).href;
  writeFileSync(
    CONFIG,
    renderConfig(readFileSync(EXAMPLE, 'utf8'), remote),
    'utf8',
  );
  process.stdout.write(
    `Remote ${remote}\nConfig ${CONFIG}\nRun: npm start -w cms-server -- ../cms.config.ts\n`,
  );
}

if (import.meta.main) main();
