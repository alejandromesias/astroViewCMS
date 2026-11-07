// Scoped Vitest config for Stryker triage runs on preview-protocol/src (the `protocol` group). Stryker reads it through
// stryker.protocol.config.mjs:  node scripts/stryker-run.mjs stryker.protocol.config.mjs --mutate "<files>"
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'preview-protocol',
          root: 'preview-protocol',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
});
