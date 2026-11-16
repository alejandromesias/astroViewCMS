// Scoped Vitest config for Stryker triage runs on cms-contract/src (the `cms-contract` group). Stryker reads it through
// stryker.cms-contract.config.mjs:  node scripts/stryker-run.mjs stryker.cms-contract.config.mjs --mutate "<files>"
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'cms-contract',
          root: 'cms-contract',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
});
