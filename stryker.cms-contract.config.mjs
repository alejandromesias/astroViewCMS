// Triage config: the base config with the cms-contract Vitest project (vitest.mutation.cms-contract.config.ts) and
// its own incremental file. Group `cms-contract` of scripts/lib/stryker-plan.ts: cms-contract/src.
// Use: node scripts/stryker-run.mjs stryker.cms-contract.config.mjs --mutate "<files>"
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));

export default {
  ...base,
  vitest: { ...base.vitest, configFile: 'vitest.mutation.cms-contract.config.ts' },
  incrementalFile: 'reports/stryker-triage-cms-contract.json',
  reporters: ['clear-text', 'progress', 'json'],
  // The JSON report is judged by scripts/lib/stryker-reports.ts (WORKPLAN 2.1l), so Stryker never fails on the score.
  jsonReporter: { fileName: 'reports/mutation/triage-cms-contract.json' },
  thresholds: { ...base.thresholds, break: null },
  // Static mutants are tested, not ignored. cms-contract's answers.ts is module-level zod schemas, so with the base
  // `ignoreStatic: true` Stryker marked its 51 mutants `Ignored` and the file scored nothing (CI run 44446210093, WORKPLAN 2.1l).
  ignoreStatic: false,
};
