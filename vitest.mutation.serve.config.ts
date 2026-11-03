// Scoped Vitest config for Stryker triage runs on preview-render-server/src/serve, preview-config.ts and
// preview-contract/src/token.ts (same use as vitest.mutation.cms-server.config.ts). It skips the
// renderer's Astro setup, which these files do not need.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'serve',
          root: 'preview-render-server',
          include: ['src/serve/**/*.test.ts', 'src/preview-config.test.ts'],
        },
      },
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
