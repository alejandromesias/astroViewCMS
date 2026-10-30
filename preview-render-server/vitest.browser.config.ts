import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { previewCommands } from './test/browser/commands.ts';
import { HARNESS_PORT } from './test/browser/origin.ts';

// Browser: the test pages play the editor. They load the preview in an iframe
// from the preview server (global-setup builds it with test/browser/site.config.ts)
// and send it the real protocol messages. One file at a time: memory is low.
export default defineConfig({
  test: {
    include: ['test/browser/**/*.browser.test.ts'],
    globalSetup: ['test/browser/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 240_000,
    // The harness origin must be the one site.config.ts lists (origin.ts).
    api: { host: 'localhost', port: HARNESS_PORT, strictPort: true },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      commands: previewCommands,
    },
  },
});
