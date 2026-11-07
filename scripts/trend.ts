// Prints the trend of whole-repo mutation runs (WORKPLAN 2.1p): one row per run, with its overall score,
// and the files under 80. Each argument is a folder that holds a summary.json written by
// `stryker-summary.ts --full` (the `mutation-baseline` artifact of mutation-full.yml). Rows keep the order given,
// so pass the folders oldest first. Usage: node scripts/trend.ts <folder>...
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface TrendRow {
  run: string;
  overall: number | undefined;
  files: number;
  under80: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// One row from a parsed summary.json. Throws when the shape is not the one stryker-summary writes.
export function rowOf(run: string, summary: unknown): TrendRow {
  if (!isRecord(summary) || !Array.isArray(summary.rows)) {
    throw new Error(`${run}: not a mutation summary (no rows)`);
  }
  const rows = summary.rows.filter(isRecord);
  return {
    run,
    overall: typeof summary.overall === 'number' ? summary.overall : undefined,
    files: rows.length,
    under80: rows.filter((row) => row.status === 'under-80').length,
  };
}

export function table(rows: readonly TrendRow[]): string {
  const lines = [
    '### Mutation trend (whole repo, newest last)',
    '',
    '| Run | Overall | Files | Under 80 |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const row of rows) {
    const overall = row.overall === undefined ? '-' : row.overall.toFixed(2);
    lines.push(`| ${row.run} | ${overall} | ${row.files} | ${row.under80} |`);
  }
  return `${lines.join('\n')}\n`;
}

export function main(folders: readonly string[]): number {
  const rows: TrendRow[] = [];
  for (const folder of folders) {
    const file = join(folder, 'summary.json');
    if (!existsSync(file)) {
      console.error(`trend: ${file} is missing; skipped`);
      continue;
    }
    const summary: unknown = JSON.parse(readFileSync(file, 'utf8'));
    rows.push(rowOf(basename(folder), summary));
  }
  process.stdout.write(table(rows));
  return rows.length > 0 ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
