// Triage config: the base config with the preview-contract Vitest project (vitest.mutation.contract.config.ts) and
// its own incremental file. Group `contract` of scripts/lib/stryker-plan.ts: preview-contract/src.
// Use: node scripts/stryker-run.mjs stryker.contract.config.mjs --mutate "<files>"
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));

export default {
  ...base,
  vitest: { ...base.vitest, configFile: 'vitest.mutation.contract.config.ts' },
  incrementalFile: 'reports/stryker-triage-contract.json',
  reporters: ['clear-text', 'progress', 'json'],
  // The JSON report is judged by scripts/lib/stryker-reports.ts (WORKPLAN 2.1l), so Stryker never fails on the score.
  jsonReporter: { fileName: 'reports/mutation/triage-contract.json' },
  thresholds: { ...base.thresholds, break: null },
};
