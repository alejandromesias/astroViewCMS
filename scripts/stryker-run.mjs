// Runs Stryker on an export of HEAD, in a folder with no git repository above it, so no git call
// made by a test or a mutant can reach the main checkout (WORKPLAN-PHASE-2 2.1h, action plan 3 and 4).
// Usage, from the repo root:
//   node scripts/stryker-run.mjs <config> --mutate <files> [other Stryker options]
//   node scripts/stryker-run.mjs stryker.config.json --full [other Stryker options]
// --full is the whole-repo run (WORKPLAN-PHASE-2 2.1h, the lead's full run); it needs stryker.config.json and no --mutate.
// Refuses a dirty tree and a run without --mutate or --full. Runs are always --force. Before and after the run
// it compares the main checkout's branch, HEAD, refs, local config and root node_modules; if any
// changed, nothing is copied back. Results go to reports/stryker-runs/<stamp>/.
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(readFileSync(join(MAIN, 'package.json'), 'utf8'));
const WORKSPACES = pkg.workspaces;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const ROOT = join(realpathSync(tmpdir()), 'avc-stryker');
const EXPORT = join(ROOT, stamp);
let interrupted = false;

function git(cwd, argv, env = process.env) {
  return spawnSync('git', argv, { cwd, env, encoding: 'utf8', windowsHide: true });
}

function gitText(cwd, argv) {
  const result = git(cwd, argv);
  if (result.status !== 0) throw new Error(`git ${argv.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

// The main checkout's state, read without changing it. Entries with a leading dot are left out of
// node_modules, since vitest writes its cache there during a run.
function snapshot() {
  return {
    branch: gitText(MAIN, ['rev-parse', '--abbrev-ref', 'HEAD']),
    head: gitText(MAIN, ['rev-parse', 'HEAD']),
    // refs/t3/ holds checkpoint refs that the T3 Code app writes during a session, not branch state.
    refs: gitText(MAIN, ['for-each-ref', '--format=%(refname) %(objectname)'])
      .split('\n')
      .filter((line) => !line.startsWith('refs/t3/'))
      .join('\n'),
    hooksPath: git(MAIN, ['config', '--local', '--get', 'core.hooksPath']).stdout.trim(),
    localConfig: gitText(MAIN, ['config', '--local', '--list']),
    nodeModules: readdirSync(join(MAIN, 'node_modules'))
      .filter((name) => !name.startsWith('.'))
      .sort()
      .join('\n'),
  };
}

function changedFields(before, after) {
  return Object.keys(before).filter((key) => before[key] !== after[key]);
}

function within(path, dir) {
  const rel = relative(dir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function realpathOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

// Copies HEAD into EXPORT through `git archive`. The archive has no .git and no untracked files.
function exportHead() {
  mkdirSync(EXPORT, { recursive: true });
  const archive = spawnSync('git', ['-C', MAIN, 'archive', '--format=tar', 'HEAD'], {
    maxBuffer: 1 << 30,
  });
  if (archive.status !== 0) throw new Error(`git archive failed: ${archive.stderr}`);
  // No drive letter in the arguments: GNU tar reads `C:...` as a remote host.
  const tar = spawnSync('tar', ['-x', '-f', '-'], { cwd: EXPORT, input: archive.stdout });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
}

// Each node_modules of the main checkout becomes a folder of its own in EXPORT, whose entries are
// junctions to the main checkout's packages: nothing is installed or copied. A workspace package
// is linked to the export's own copy instead, so tests and mutants use the same source.
function linkNodeModules() {
  for (const dir of ['', ...WORKSPACES]) {
    const from = join(MAIN, dir, 'node_modules');
    if (!existsSync(from)) continue;
    const to = join(EXPORT, dir, 'node_modules');
    mkdirSync(to);
    for (const name of readdirSync(from)) {
      const target = realpathSync(join(from, name));
      const dest = join(to, name);
      const workspace = WORKSPACES.find((ws) => target === join(MAIN, ws));
      if (workspace !== undefined) symlinkSync(join(EXPORT, workspace), dest, 'junction');
      else if (statSync(target).isDirectory()) symlinkSync(target, dest, 'junction');
      else copyFileSync(target, dest);
    }
  }
}

// Refuses the run if git finds any repository from the export, with or without the ceiling.
function guard() {
  if (existsSync(join(EXPORT, '.git'))) throw new Error('the export contains a .git folder');
  const withCeiling = { ...process.env, GIT_CEILING_DIRECTORIES: ROOT };
  const noCeiling = { ...process.env };
  delete noCeiling.GIT_CEILING_DIRECTORIES;
  for (const cwd of [EXPORT, join(EXPORT, 'cms-server')]) {
    for (const env of [withCeiling, noCeiling]) {
      if (git(cwd, ['rev-parse', '--show-toplevel'], env).status === 0) {
        throw new Error(`git finds a repository from ${cwd}; the run is refused`);
      }
    }
  }
}

function runStryker(config, args) {
  const bin = join(EXPORT, 'node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js');
  const child = spawn(process.execPath, [bin, 'run', config, ...args], {
    cwd: EXPORT,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: ROOT },
    stdio: 'inherit',
    windowsHide: true,
  });
  process.once('SIGINT', () => {
    interrupted = true;
  });
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolvePromise(signal ? null : code));
  });
}

function copyReports(run) {
  const out = join(MAIN, 'reports', 'stryker-runs', stamp);
  mkdirSync(out, { recursive: true });
  if (existsSync(join(EXPORT, 'reports'))) cpSync(join(EXPORT, 'reports'), out, { recursive: true });
  writeFileSync(join(out, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  return out;
}

// Removes EXPORT without following a link: a junction into the main checkout is removed as a link
// only, so the packages it points to are never touched.
function removeOwn(path, root) {
  const st = lstatSync(path);
  const real = realpathOrNull(path);
  if (st.isSymbolicLink() || real === null || !within(real, root)) {
    try {
      rmdirSync(path);
    } catch {
      unlinkSync(path);
    }
  } else if (st.isDirectory()) {
    for (const name of readdirSync(path)) removeOwn(join(path, name), root);
    rmdirSync(path);
  } else {
    unlinkSync(path);
  }
}

async function main() {
  const [config, ...given] = process.argv.slice(2);
  const full = given.includes('--full');
  const rest = given.filter((arg) => arg !== '--full');
  if (!config || !/^stryker[\w.-]*\.(mjs|json)$/.test(config) || !existsSync(join(MAIN, config))) {
    throw new Error('the first argument must be a Stryker config in the repo root, such as stryker.cms-server.config.mjs or stryker.config.json');
  }
  if (full && config !== 'stryker.config.json') {
    throw new Error('--full runs with stryker.config.json only');
  }
  if (!full && !rest.some((arg) => arg === '--mutate' || arg.startsWith('--mutate='))) {
    throw new Error('give --mutate <files>, or --full for the whole repo');
  }
  if (!rest.includes('--force')) rest.push('--force');

  const dirty = gitText(MAIN, ['status', '--porcelain']);
  if (dirty !== '') {
    throw new Error(`uncommitted changes in the main checkout; commit or stash them first:\n${dirty}`);
  }

  const before = snapshot();
  const run = { stamp, config, args: rest, head: before.head, branch: before.branch, exitCode: null };
  console.log(`stryker-run: export ${EXPORT}`);
  let code = null;
  try {
    exportHead();
    linkNodeModules();
    guard();
    code = await runStryker(config, rest);
    if (interrupted) throw new Error('interrupted; nothing copied back');
    const changed = changedFields(before, snapshot());
    if (changed.length > 0) {
      throw new Error(`the main checkout changed during the run (${changed.join(', ')}); nothing copied back`);
    }
    run.exitCode = code;
    console.log(`stryker-run: reports in ${relative(MAIN, copyReports(run))}`);
  } finally {
    if (existsSync(EXPORT)) removeOwn(EXPORT, realpathSync(EXPORT));
    const changed = changedFields(before, snapshot());
    if (changed.length > 0) {
      throw new Error(`the main checkout changed after cleanup (${changed.join(', ')})`);
    }
  }
  console.log(`stryker-run: Stryker exit code ${code}`);
  process.exitCode = code ?? 1;
}

main().catch((error) => {
  console.error(`stryker-run: ${error.message}`);
  process.exitCode = 1;
});
