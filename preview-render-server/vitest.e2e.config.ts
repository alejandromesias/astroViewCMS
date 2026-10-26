import { defineConfig } from 'vitest/config';

// End-to-end: global-setup builds the sample site into a temporary folder,
// starts the real server on a free port, and the tests talk to it over HTTP.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 240_000,
  },
});
