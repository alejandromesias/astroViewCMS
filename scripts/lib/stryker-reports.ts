// Reads the per-group Stryker reports and writes the verdict (WORKPLAN 2.1l). Shared by
// scripts/stryker-changed.ts (plans, runs, judges) and scripts/stryker-summary.ts (judges a finished run).
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUP_NAMES, type Plan, groupOf } from './stryker-plan.ts';
import {
  FILE_FLOOR,
  type Mode,
  type MutantCounts,
  OVERALL_FLOOR,
  type Verdict,
  type Waiver,
  countsByFile,
  judge,
  parseWaivers,
} from './stryker-score.ts';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
// Each group's run writes here: <REPORT_ROOT>/<group>/mutation/triage-<group>.json. plan.json sits beside them.
export const REPORT_ROOT = join(REPO_ROOT, 'reports', 'mutation-diff');
export const WAIVERS_FILE = join(REPO_ROOT, '.mutation-waivers.json');
const REPORT = /(?:^|\/)mutation\/triage-([a-z-]+)\.json$/;

// Every group report under root, found by its path (`<anything>/mutation/triage-<group>.json`).
export function findReports(
  root: string,
): Array<{ group: string; file: string }> {
  if (!existsSync(root)) return [];
  const found: Array<{ group: string; file: string }> = [];
  for (const relative of readdirSync(root, { recursive: true }).map(String)) {
    const match = REPORT.exec(relative.replaceAll('\\', '/'));
    if (match?.[1] !== undefined)
      found.push({ group: match[1], file: join(root, relative) });
  }
  return found.sort((a, b) => a.group.localeCompare(b.group));
}

// The counts of every file in every group report, and the groups that reported.
export function loadCounts(root: string): {
  counts: Map<string, MutantCounts>;
  reported: Set<string>;
} {
  const counts = new Map<string, MutantCounts>();
  const reported = new Set<string>();
  for (const { group, file } of findReports(root)) {
    reported.add(group);
    const report: unknown = JSON.parse(readFileSync(file, 'utf8'));
    for (const [name, tally] of countsByFile(report)) {
      if (counts.has(name)) throw new Error(`${name} is in two group reports`);
      counts.set(name, tally);
    }
  }
  return { counts, reported };
}

export function readWaivers(file: string): Waiver[] {
  if (!existsSync(file)) return [];
  return parseWaivers(JSON.parse(readFileSync(file, 'utf8')));
}

export function writePlan(
  root: string,
  plan: Plan & { base: string; mergeBase: string | undefined },
): string {
  mkdirSync(root, { recursive: true });
  const file = join(root, 'plan.json');
  writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
  return file;
}

// Reads the plan that stryker-changed wrote. Throws on any other shape.
export function readPlan(file: string): Plan {
  if (!existsSync(file))
    throw new Error(`${file} is missing: run scripts/stryker-changed.ts first`);
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (
    typeof value !== 'object' ||
    value === null ||
    !('groups' in value) ||
    !('dropped' in value)
  ) {
    throw new Error(`${file} is not a mutation plan`);
  }
  const { groups, dropped } = value;
  if (
    typeof groups !== 'object' ||
    groups === null ||
    !Array.isArray(dropped)
  ) {
    throw new Error(`${file} is not a mutation plan`);
  }
  const planned: Record<string, string[]> = {};
  for (const [name, files] of Object.entries(groups)) {
    if (!Array.isArray(files))
      throw new Error(`${file}: group ${name} has no file list`);
    const list: string[] = [];
    for (const item of files) {
      if (typeof item !== 'string')
        throw new Error(`${file}: group ${name} has a file that is not a path`);
      list.push(item);
    }
    planned[name] = list;
  }
  return { groups: planned, dropped: dropped.map(String) };
}

// Judges a finished run. diff: the planned groups and files must all report. full: every group must report.
export function judgeRun(options: {
  mode: Mode;
  root: string;
  plan: Plan | undefined;
  waivers: readonly Waiver[];
}): Verdict {
  const { counts, reported } = loadCounts(options.root);
  const expected =
    options.mode === 'full'
      ? new Map(
          GROUP_NAMES.map((group) => [
            group,
            [...counts.keys()].filter((file) => groupOf(file) === group).sort(),
          ]),
        )
      : new Map(Object.entries(options.plan?.groups ?? {}));
  return judge({
    mode: options.mode,
    expected,
    reported,
    counts,
    waivers: options.waivers,
  });
}

function statusText(row: Verdict['rows'][number]): string {
  const label = {
    pass: 'pass',
    fail: 'FAIL',
    'under-80': 'under 80',
    'no-mutants': 'no mutants',
  }[row.status];
  return row.waived ? `${label} (waived)` : label;
}

function renderMarkdown(verdict: Verdict, mode: Mode): string {
  const title =
    mode === 'diff'
      ? 'Mutation testing: changed files'
      : 'Mutation testing: full run';
  const overall =
    verdict.overall === undefined
      ? 'no valid mutant'
      : `${verdict.overall.toFixed(2)}% (floor ${OVERALL_FLOOR})`;
  const lines = [
    `### ${title}`,
    '',
    `Overall: ${overall}. Per-file floor ${FILE_FLOOR}${mode === 'full' ? ' (listed only)' : ''}.`,
    '',
    '| File | Group | Score | Killed / valid | Floor | Status |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ];
  for (const row of verdict.rows) {
    const score = row.score === undefined ? '-' : row.score.toFixed(2);
    lines.push(
      `| ${row.file} | ${row.group} | ${score} | ${row.detected} / ${row.valid} | ${row.floor} | ${statusText(row)} |`,
    );
  }
  if (verdict.failures.length > 0) {
    lines.push(
      '',
      '**Failures**',
      ...verdict.failures.map((failure) => `- ${failure}`),
    );
  }
  return `${lines.join('\n')}\n`;
}

// Prints the table, writes summary.json beside the reports, and adds the table to the CI job summary.
export function publish(verdict: Verdict, mode: Mode, root: string): void {
  const markdown = renderMarkdown(verdict, mode);
  console.log(`\n${markdown}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'summary.json'),
    `${JSON.stringify({ mode, ...verdict }, null, 2)}\n`,
  );
  const step = process.env.GITHUB_STEP_SUMMARY;
  if (step !== undefined && step !== '') appendFileSync(step, markdown);
}
