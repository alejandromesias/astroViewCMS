// Scoped Vitest config for Stryker triage runs on preview-contract/src (the `contract` group). Stryker reads it through
// stryker.contract.config.mjs:  node scripts/stryker-run.mjs stryker.contract.config.mjs --mutate "<files>"
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'preview-contract',
          root: 'preview-contract',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
});
