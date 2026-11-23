import { defineConfig } from 'vitest/config';

// Browser (WORKPLAN 2.12b): Chromium on cms.localhost drives the real editor, whose iframe is the preview on
// preview.localhost. Each test starts the real CMS and preview node from the sample-site bundle that the shared
// end-to-end global setup builds. `npm run test:browser -w cms-server` runs these files, one at a time.
export default defineConfig({
  test: {
    name: 'cms-server-browser',
    include: ['test/browser/**/*.browser.test.ts'],
    globalSetup: ['test/browser/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
  },
});
