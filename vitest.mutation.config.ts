// The Vitest config that Stryker runs (stryker.config.json, vitest.configFile).
// Stryker takes one config per run, so it lists each package's tests as a
// project: the renderer keeps its own config (Astro's Vite setup), and the
// contract package, which has none, gets an inline one.
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
