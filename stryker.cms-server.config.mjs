// Triage config: the base config with a scoped Vitest config and its own incremental file, so a
// focused run does not execute every package's tests or overwrite the baseline report.
// Use: npx stryker run stryker.cms-server.config.mjs --mutate "<files>"
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));

export default {
  ...base,
  vitest: { ...base.vitest, configFile: 'vitest.mutation.cms-server.config.ts' },
  incrementalFile: 'reports/stryker-triage-cms-server.json',
  reporters: ['clear-text', 'progress'],
};
