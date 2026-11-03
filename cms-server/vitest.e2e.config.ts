import { defineConfig } from 'vitest/config';

// End-to-end (WORKPLAN 2.9b): the supervisor starts the real preview node (start.ts)
// and swaps between two real bundles. global-setup builds sample-site once. The unit
// project (vitest.projects.ts) skips these files; `npm run test:e2e -w cms-server` runs them.
export default defineConfig({
  test: {
    name: 'cms-server-e2e',
    include: ['test/e2e/**/*.e2e.test.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
});
