// How long each Stryker group took (WORKPLAN 2.1s). stryker-changed.ts measures a run per group; this renders the
// numbers as the job-summary table, so a slow group shows up and the groups can be rebalanced.

export interface GroupTiming {
  group: string;
  files: number;
  seconds: number;
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return minutes === 0
    ? `${rest} s`
    : `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

// Markdown for the job summary. Groups are listed slowest first; the total is the sum of the runs, which the
// groups run one after another inside a single job.
export function renderTimings(timings: readonly GroupTiming[]): string {
  if (timings.length === 0) return '';
  const rows = [...timings].sort((a, b) => b.seconds - a.seconds);
  const total = rows.reduce((sum, row) => sum + row.seconds, 0);
  const lines = [
    '### Stryker time per group',
    '',
    '| Group | Files | Time |',
    '| --- | ---: | ---: |',
    ...rows.map(
      (row) =>
        `| ${row.group} | ${row.files} | ${formatDuration(row.seconds)} |`,
    ),
    '',
    `Total: ${formatDuration(total)}.`,
  ];
  return `${lines.join('\n')}\n`;
}
