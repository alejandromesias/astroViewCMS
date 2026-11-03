// Scoped Vitest config for Stryker triage runs on cms-server files:
//   npx stryker run --mutate "<files>" --vitest.configFile vitest.mutation.cms-server.config.ts \
//     --incrementalFile reports/stryker-triage.json
// The dry run executes every test of this config, so it lists only cms-server and leaves out the
// test that clones a repo seeded from sample-site (repo): it needs a folder the
// Stryker sandbox ignores. Use vitest.mutation.config.ts for the full run.
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
          exclude: ['**/node_modules/**', '**/git/repo.test.ts'],
        },
      },
    ],
  },
});
