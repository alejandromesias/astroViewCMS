// Plans and runs Stryker on the source files a branch changed (WORKPLAN 2.1l). Usage, from the repo root:
//   node scripts/stryker-changed.ts [--base <ref>]               the plan only: groups and files, no Stryker
//   node scripts/stryker-changed.ts --run [--base <ref>]         runs each group, then judges the changed set (blocking)
//   node scripts/stryker-changed.ts --all --run                  every source file, run and judged as a full run
//   node scripts/stryker-changed.ts --all --group <name> --run   one shard of the nightly run (no judgement)
// --base defaults to origin/main. The changed set is the diff from the merge base to HEAD, so commit first:
// stryker-run.mjs refuses a dirty tree. Each group runs through stryker-run.mjs, never `npx stryker run`.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GROUP_NAMES, type Plan, planFiles } from './lib/stryker-plan.ts';
import {
  REPO_ROOT,
  REPORT_ROOT,
  WAIVERS_FILE,
  judgeRun,
  publish,
  readWaivers,
  writePlan,
} from './lib/stryker-reports.ts';

const STRYKER_RUN = fileURLToPath(
  new URL('./stryker-run.mjs', import.meta.url),
);

interface Options {
  base: string;
  run: boolean;
  all: boolean;
  group: string | undefined;
}

export function parseOptions(args: readonly string[]): Options {
  const options: Options = {
    base: 'origin/main',
    run: false,
    all: false,
    group: undefined,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--run') options.run = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--base' || arg === '--group') {
      const value = args[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === '--base') options.base = value;
      else options.group = value;
      i += 1;
    } else throw new Error(`unknown option: ${arg ?? ''}`);
  }
  if (options.group !== undefined) {
    if (!options.all)
      throw new Error(
        '--group needs --all (a shard covers every file of its group)',
      );
    if (!GROUP_NAMES.includes(options.group)) {
      throw new Error(`--group must be one of ${GROUP_NAMES.join(', ')}`);
    }
  }
  return options;
}

function gitLines(args: string[]): string[] {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function mutateList(): string[] {
  const config: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, 'stryker.config.json'), 'utf8'),
  );
  if (
    typeof config !== 'object' ||
    config === null ||
    !('mutate' in config) ||
    !Array.isArray(config.mutate)
  ) {
    throw new Error('stryker.config.json has no mutate list');
  }
  return config.mutate.map(String);
}

// Writes the plan and prints it: one line per group, and the dropped files.
function plan(options: Options): { plan: Plan; mergeBase: string | undefined } {
  let mergeBase: string | undefined;
  let changed: string[];
  if (options.all) {
    changed = gitLines(['ls-files', '--', '*.ts']);
  } else {
    const found = spawnSync(
      'git',
      ['rev-parse', '--verify', '--quiet', options.base],
      { cwd: REPO_ROOT },
    );
    if (found.status !== 0)
      throw new Error(
        `${options.base} not found; run git fetch origin main first`,
      );
    mergeBase = gitLines(['merge-base', options.base, 'HEAD'])[0];
    if (mergeBase === undefined)
      throw new Error(`no merge base of ${options.base} and HEAD`);
    changed = gitLines([
      'diff',
      '--name-only',
      '--diff-filter=ACMR',
      mergeBase,
      'HEAD',
    ]);
  }
  const full = planFiles(changed, mutateList());
  const selected: Plan =
    options.group === undefined
      ? full
      : {
          groups: full.groups[options.group]
            ? { [options.group]: full.groups[options.group] }
            : {},
          dropped: full.dropped,
        };
  const scope = options.all
    ? 'every source file'
    : `changed files since ${options.base}`;
  console.log(
    `stryker-changed: ${scope}, ${Object.values(selected.groups).flat().length} to mutate`,
  );
  for (const [group, files] of Object.entries(selected.groups)) {
    console.log(`  ${group} (${files.length}): ${files.join(', ')}`);
  }
  if (selected.dropped.length > 0)
    console.log(`  not mutated: ${selected.dropped.length} file(s)`);
  return { plan: selected, mergeBase };
}

function clean(options: Options): void {
  // A shard clears only its own group; a full or diff run clears every report.
  rmSync(
    options.group === undefined
      ? REPORT_ROOT
      : join(REPORT_ROOT, options.group),
    {
      recursive: true,
      force: true,
    },
  );
}

function runGroups(groups: Record<string, string[]>): number {
  for (const [group, files] of Object.entries(groups)) {
    const out = join(REPORT_ROOT, group);
    console.log(`\nstryker-changed: group ${group}, ${files.length} file(s)`);
    const result = spawnSync(
      process.execPath,
      [STRYKER_RUN, `stryker.${group}.config.mjs`, '--mutate', files.join(',')],
      {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        windowsHide: true,
        env: { ...process.env, AVC_STRYKER_OUT: out },
      },
    );
    if (result.status !== 0) {
      console.error(
        `stryker-changed: group ${group} failed (exit ${result.status ?? 'signal'})`,
      );
      return result.status ?? 1;
    }
  }
  return 0;
}

function main(args: readonly string[]): number {
  const options = parseOptions(args);
  const { plan: planned, mergeBase } = plan(options);
  if (!options.run) return 0;
  clean(options);
  writePlan(REPORT_ROOT, { ...planned, base: options.base, mergeBase });
  const failed = runGroups(planned.groups);
  if (failed !== 0) return failed;
  // A shard leaves the judgement to the merge job of mutation-full.yml.
  if (options.group !== undefined) return 0;
  const mode = options.all ? 'full' : 'diff';
  const verdict = judgeRun({
    mode,
    root: REPORT_ROOT,
    plan: options.all ? undefined : planned,
    waivers: readWaivers(WAIVERS_FILE),
  });
  publish(verdict, mode, REPORT_ROOT);
  return verdict.failures.length > 0 ? 1 : 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(
      `stryker-changed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  }
}
