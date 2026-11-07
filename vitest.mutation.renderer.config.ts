// Scoped Vitest config for Stryker triage runs on preview-render-server/src (the `renderer` group, except serve/ and
// manifest/, which have their own configs). Stryker reads it through stryker.renderer.config.mjs:
//   node scripts/stryker-run.mjs stryker.renderer.config.mjs --mutate "<files>"
// It runs the renderer package's own Vitest project, which carries Astro's Vite setup.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['preview-render-server/vitest.config.ts'],
  },
});
