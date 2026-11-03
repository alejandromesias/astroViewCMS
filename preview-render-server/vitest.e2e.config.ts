import { configDefaults, defineConfig } from 'vitest/config';

// End-to-end: global-setup builds the sample site into a temporary folder,
// starts the real server on a free port, and the tests talk to it over HTTP.
// Two projects, one after the other (groupOrder): the functional files, then the
// budget file alone. Its medians missed their budgets when other files loaded the
// CPU in a full run (2026-11-01). Each project builds and starts its own server.
const shared = {
  globalSetup: ['test/e2e/global-setup.ts'],
  testTimeout: 30_000,
  hookTimeout: 240_000,
};
const BUDGETS = 'test/e2e/budgets.e2e.test.ts';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.test.ts'],
          exclude: [...configDefaults.exclude, BUDGETS],
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          ...shared,
          name: 'e2e-budgets',
          include: [BUDGETS],
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
