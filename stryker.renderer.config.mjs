// Triage config: the base config with the renderer's own Vitest project (vitest.mutation.renderer.config.ts) and
// its own incremental file. Group `renderer` of scripts/lib/stryker-plan.ts: preview-render-server/src except serve/ and manifest/.
// Use: node scripts/stryker-run.mjs stryker.renderer.config.mjs --mutate "<files>"
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));

export default {
  ...base,
  vitest: { ...base.vitest, configFile: 'vitest.mutation.renderer.config.ts' },
  incrementalFile: 'reports/stryker-triage-renderer.json',
  reporters: ['clear-text', 'progress', 'json'],
  // The JSON report is judged by scripts/lib/stryker-reports.ts (WORKPLAN 2.1l), so Stryker never fails on the score.
  jsonReporter: { fileName: 'reports/mutation/triage-renderer.json' },
  thresholds: { ...base.thresholds, break: null },
};
