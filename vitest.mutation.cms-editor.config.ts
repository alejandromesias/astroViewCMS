// Scoped Vitest config for Stryker runs of group cms-editor (cms-server/editor/, WORKPLAN 2.11e). The editor's
// tests run in happy-dom, set per file by their `@vitest-environment` comment. Use: see stryker.cms-editor.config.mjs.
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
          name: 'cms-editor',
          root: 'cms-server',
          include: ['editor/**/*.test.ts'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
});
