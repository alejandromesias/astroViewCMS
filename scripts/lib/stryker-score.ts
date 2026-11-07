// Scores Stryker mutants and applies the blocking rules (WORKPLAN 2.1l). Pure: the report files are read
// by the caller. The score is Stryker's own: detected / (detected + survived + no coverage), where
// detected is killed plus timeout. Compile errors, runtime errors, ignored and pending mutants are left out.
import { groupOf } from './stryker-plan.ts';

export const OVERALL_FLOOR = 75;
export const FILE_FLOOR = 80;

export type Mode = 'diff' | 'full';

export interface MutantCounts {
  detected: number;
  valid: number;
}

export interface Waiver {
  file: string;
  // Lower floor for this file only. Under FILE_FLOOR, never above it.
  floor: number;
  reason: string;
  task: string;
}

interface Row {
  file: string;
  group: string;
  detected: number;
  valid: number;
  // Undefined when the file has no valid mutant.
  score: number | undefined;
  floor: number;
  status: 'pass' | 'fail' | 'under-80' | 'no-mutants';
  waived: boolean;
}

export interface Verdict {
  rows: Row[];
  // Overall score of every judged file together; undefined when no file has a valid mutant.
  overall: number | undefined;
  failures: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Reads the JSON reporter's output (`files[path].mutants[].status`). Throws on any other shape.
export function countsByFile(report: unknown): Map<string, MutantCounts> {
  if (!isRecord(report) || !isRecord(report.files)) {
    throw new Error('not a Stryker JSON report: no `files` object');
  }
  const counts = new Map<string, MutantCounts>();
  for (const [file, entry] of Object.entries(report.files)) {
    if (!isRecord(entry) || !Array.isArray(entry.mutants)) {
      throw new Error(
        `Stryker report entry for ${file} has no \`mutants\` array`,
      );
    }
    const tally: MutantCounts = { detected: 0, valid: 0 };
    for (const mutant of entry.mutants) {
      if (!isRecord(mutant) || typeof mutant.status !== 'string') {
        throw new Error(
          `Stryker report entry for ${file} has a mutant without a status`,
        );
      }
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
        tally.detected += 1;
        tally.valid += 1;
      } else if (
        mutant.status === 'Survived' ||
        mutant.status === 'NoCoverage'
      ) {
        tally.valid += 1;
      }
    }
    counts.set(file.replaceAll('\\', '/'), tally);
  }
  return counts;
}

// Parses .mutation-waivers.json: an array of { file, floor, reason, task }. Throws on any other shape.
export function parseWaivers(value: unknown): Waiver[] {
  if (!Array.isArray(value))
    throw new Error('.mutation-waivers.json must be an array');
  return value.map((item, index) => {
    if (
      !isRecord(item) ||
      typeof item.file !== 'string' ||
      typeof item.floor !== 'number' ||
      typeof item.reason !== 'string' ||
      typeof item.task !== 'string'
    ) {
      throw new Error(
        `waiver ${index} needs file (string), floor (number), reason and task (strings)`,
      );
    }
    if (!(item.floor >= 0 && item.floor < FILE_FLOOR)) {
      throw new Error(
        `waiver ${index} (${item.file}): floor must be 0 or more and under ${FILE_FLOOR}`,
      );
    }
    if (item.reason.trim() === '' || item.task.trim() === '') {
      throw new Error(
        `waiver ${index} (${item.file}): reason and task must not be empty`,
      );
    }
    return {
      file: item.file,
      floor: item.floor,
      reason: item.reason,
      task: item.task,
    };
  });
}

function scoreOf(counts: MutantCounts): number | undefined {
  // Multiplies before dividing, so whole-number scores are exact (11 of 20 is 55, not 55.00000000000001).
  return counts.valid === 0
    ? undefined
    : (counts.detected * 100) / counts.valid;
}

// Judges the files. `expected` maps each group to the files the run should have mutated; `reported`
// names the groups whose report exists. `diff` blocks: the overall score must reach OVERALL_FLOOR and
// each file its floor (FILE_FLOOR, or a waiver's lower floor). `full` blocks only on the overall score;
// files under FILE_FLOOR are listed as `under-80`.
export function judge(input: {
  mode: Mode;
  expected: ReadonlyMap<string, readonly string[]>;
  reported: ReadonlySet<string>;
  counts: ReadonlyMap<string, MutantCounts>;
  waivers: readonly Waiver[];
}): Verdict {
  const { mode, expected, reported, counts, waivers } = input;
  const failures: string[] = [];
  const waiverOf = new Map(waivers.map((waiver) => [waiver.file, waiver]));
  const files =
    mode === 'full'
      ? [...counts.keys()].sort()
      : [...expected.values()].flat().sort();

  for (const [group, groupFiles] of expected) {
    if (!reported.has(group)) {
      failures.push(
        `no Stryker report for group ${group}: the run did not finish`,
      );
      continue;
    }
    const mutated = groupFiles.some(
      (file) => (counts.get(file)?.valid ?? 0) > 0,
    );
    if (!mutated)
      failures.push(
        `Stryker mutated nothing for group ${group}: check its run`,
      );
  }

  const rows: Row[] = files.map((file) => {
    const tally = counts.get(file) ?? { detected: 0, valid: 0 };
    const waiver = waiverOf.get(file);
    const floor = waiver?.floor ?? FILE_FLOOR;
    const score = scoreOf(tally);
    let status: Row['status'] = 'pass';
    if (score === undefined) status = 'no-mutants';
    else if (mode === 'diff' && score < floor) status = 'fail';
    else if (mode === 'full' && score < FILE_FLOOR) status = 'under-80';
    if (status === 'fail') {
      failures.push(
        `${file} scores ${score?.toFixed(2)}, under its floor of ${floor}`,
      );
    }
    return {
      file,
      group: groupOf(file) ?? 'unknown',
      detected: tally.detected,
      valid: tally.valid,
      score,
      floor,
      status,
      waived: waiver !== undefined,
    };
  });

  const total = rows.reduce(
    (sum, row) => ({
      detected: sum.detected + row.detected,
      valid: sum.valid + row.valid,
    }),
    { detected: 0, valid: 0 },
  );
  const overall = scoreOf(total);
  if (overall !== undefined && overall < OVERALL_FLOOR) {
    failures.push(
      `the ${mode === 'diff' ? 'changed set' : 'whole run'} scores ${overall.toFixed(2)} overall, under ${OVERALL_FLOOR}`,
    );
  }
  return { rows, overall, failures };
}
