// Triage config: the base config with the scoped Vitest config in vitest.mutation.preview.config.ts and
// its own incremental file, so a focused run does not run cms-server's tests or overwrite the baseline report.
// Use: npx stryker run stryker.preview.config.mjs --mutate "<files>"
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./stryker.config.json', import.meta.url), 'utf8'));

export default {
  ...base,
  vitest: { ...base.vitest, configFile: 'vitest.mutation.preview.config.ts' },
  incrementalFile: 'reports/stryker-triage-preview.json',
  reporters: ['clear-text', 'progress'],
};
