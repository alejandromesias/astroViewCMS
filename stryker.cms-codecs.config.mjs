// Group `cms-codecs` of scripts/lib/stryker-plan.ts (a folder split of cms-server, WORKPLAN 2.1r). It shares the Vitest config of group `cms-server`.
// Triage config: the base config with a scoped Vitest config and its own incremental file, so a
// focused run does not execute every package's tests or overwrite the baseline report.
// Use: node scripts/stryker-run.mjs stryker.cms-codecs.config.mjs --mutate "<files>"
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));

export default {
  ...base,
  vitest: { ...base.vitest, configFile: 'vitest.mutation.cms-server.config.ts' },
  incrementalFile: 'reports/stryker-triage-cms-codecs.json',
  reporters: ['clear-text', 'progress', 'json'],
  // The JSON report is judged by scripts/lib/stryker-reports.ts (WORKPLAN 2.1l), so Stryker never fails on the score.
  jsonReporter: { fileName: 'reports/mutation/triage-cms-codecs.json' },
  thresholds: { ...base.thresholds, break: null },
};
