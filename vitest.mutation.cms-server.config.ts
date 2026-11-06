// Scoped Vitest config for Stryker triage runs on cms-server files:
//   npx stryker run --mutate "<files>" --vitest.configFile vitest.mutation.cms-server.config.ts \
//     --incrementalFile reports/stryker-triage.json
// The dry run executes every test of this config, so it lists only cms-server. Tests that need sample-site
// (which the Stryker sandbox ignores) are seeded from fixtures under cms-server/test/fixtures instead.
// `*.real.test.ts` (real builds, about a minute each) are left out: Stryker cannot use them per mutant, and the unit
// tests with fakes must kill the mutants. Run them alone with `npx vitest run <file>`.
// Use vitest.mutation.config.ts for the full run.
import { defineConfig } from 'vitest/config';

if (process.cwd().includes('.stryker-tmp')) {
  process.env.GIT_CEILING_DIRECTORIES = process.cwd();
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'cms-server',
          root: 'cms-server',
          include: ['src/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.real.test.ts'],
        },
      },
    ],
  },
});
