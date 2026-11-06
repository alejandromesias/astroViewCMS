// Scoped Vitest config for Stryker triage runs on preview-render-server/src/manifest and preview-contract/src/revision.ts
// (same use as vitest.mutation.cms-server.config.ts). Stryker reads it through stryker.preview.config.mjs:
//   npx stryker run stryker.preview.config.mjs --mutate "<files>"
// It leaves out cms-server, whose bundle-routes test needs sample-site, which the Stryker sandbox ignores.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'preview-render-server/vitest.config.ts',
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
