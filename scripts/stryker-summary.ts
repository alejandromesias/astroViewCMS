// Judges a finished mutation run from its group reports (WORKPLAN 2.1l). Usage, from the repo root:
//   node scripts/stryker-summary.ts          the changed set, against reports/mutation-diff/plan.json
//   node scripts/stryker-summary.ts --full   every group of a full run; only the overall floor blocks
// Writes reports/mutation-diff/summary.json and, in CI, the table to the job summary. Exits 1 on a failure.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPORT_ROOT,
  WAIVERS_FILE,
  judgeRun,
  publish,
  readPlan,
  readWaivers,
} from './lib/stryker-reports.ts';

export function main(args: readonly string[]): number {
  const full = args.includes('--full');
  const unknown = args.filter((arg) => arg !== '--full');
  if (unknown.length > 0)
    throw new Error(`unknown option: ${unknown.join(' ')}`);
  const mode = full ? 'full' : 'diff';
  const plan = full ? undefined : readPlan(join(REPORT_ROOT, 'plan.json'));
  const verdict = judgeRun({
    mode,
    root: REPORT_ROOT,
    plan,
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
      `stryker-summary: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  }
}
