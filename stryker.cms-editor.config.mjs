// Group `cms-editor` of scripts/lib/stryker-plan.ts (cms-server/editor/, WORKPLAN 2.11e). It has its own Vitest config, which runs the editor's happy-dom tests.
// Triage config: the base config with a scoped Vitest config and its own incremental file, so a
// focused run does not execute every package's tests or overwrite the baseline report.
// Use: node scripts/stryker-run.mjs stryker.cms-editor.config.mjs --mutate "<files>"
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));

export default {
  ...base,
  vitest: { ...base.vitest, configFile: 'vitest.mutation.cms-editor.config.ts' },
  incrementalFile: 'reports/stryker-triage-cms-editor.json',
  reporters: ['clear-text', 'progress', 'json'],
  // The JSON report is judged by scripts/lib/stryker-reports.ts (WORKPLAN 2.1l), so Stryker never fails on the score.
  jsonReporter: { fileName: 'reports/mutation/triage-cms-editor.json' },
  thresholds: { ...base.thresholds, break: null },
};
