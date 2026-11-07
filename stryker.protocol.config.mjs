// Triage config: the base config with the preview-protocol Vitest project (vitest.mutation.protocol.config.ts) and
// its own incremental file. Group `protocol` of scripts/lib/stryker-plan.ts: preview-protocol/src.
// Use: node scripts/stryker-run.mjs stryker.protocol.config.mjs --mutate "<files>"
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));

export default {
  ...base,
  vitest: { ...base.vitest, configFile: 'vitest.mutation.protocol.config.ts' },
  incrementalFile: 'reports/stryker-triage-protocol.json',
  reporters: ['clear-text', 'progress', 'json'],
  // The JSON report is judged by scripts/lib/stryker-reports.ts (WORKPLAN 2.1l), so Stryker never fails on the score.
  jsonReporter: { fileName: 'reports/mutation/triage-protocol.json' },
  thresholds: { ...base.thresholds, break: null },
};
