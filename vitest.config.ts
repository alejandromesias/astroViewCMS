// The unified unit-test run: every package's unit tests in one Vitest run, with
// one coverage report and a floor per package (`npm run coverage`, a step of
// `npm run check`). The projects are shared with vitest.mutation.config.ts. The
// e2e and browser configs stay separate and are not listed here.
// Vitest reads coverage options only from the root config, so the renderer's
// include, exclusions and floors (formerly in its own vitest.config.ts) live here.
import { defineConfig } from 'vitest/config';
import { UNIT_PROJECTS } from './vitest.projects.ts';

export default defineConfig({
  test: {
    projects: UNIT_PROJECTS,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // reports/ is gitignored (generated reports).
      reportsDirectory: 'reports/coverage',
      // One floor per package (one glob each), so a weak package cannot hide behind strong ones.
      // The renderer's floors are a ratchet: just under the 2026-10-31 baseline (99.2 lines /
      // 99.3 functions / 97.4 branches / 99.0 statements). Raise when the score rises; lower only
      // with a reason in the commit. The other packages were measured 2026-11-01 and sit 1 to 2
      // points under their numbers.
      thresholds: {
        'preview-render-server/**': { lines: 97, functions: 97, branches: 97, statements: 97 },
        'preview-protocol/**': { lines: 98, functions: 98, branches: 98, statements: 98 },
        'preview-contract/**': { lines: 98, functions: 98, branches: 86, statements: 96 },
        'cms-server/**': { lines: 85, functions: 98, branches: 64, statements: 83 },
      },
      include: [
        'preview-render-server/src/**',
        'preview-render-server/test-editor/**',
        'preview-protocol/src/**',
        'preview-contract/src/**',
        'cms-server/src/**',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        'preview-render-server/src/types.ts',
        // Glue scripts with top-level side effects: covered by the
        // end-to-end suite, not unit tests.
        'preview-render-server/src/build.ts',
        'preview-render-server/src/start.ts',
        'preview-render-server/test-editor/editor.astro',
        // Import virtual modules only a real build can load (or are bound
        // to them in a line or two): covered by the end-to-end suite.
        'preview-render-server/src/render-route.ts',
        'preview-render-server/src/validate-route.ts',
        'preview-render-server/src/warmup-route.ts',
        'preview-render-server/src/dev/documents-route.ts',
        'preview-render-server/src/render/runtime.ts',
        'preview-render-server/src/overlay/content-shim.ts',
        'preview-render-server/src/overlay/markdown-instance.ts',
        // Run as a bundled copy by loadCmsCollections (tested in
        // config-bundle.test.ts), so v8 can't attribute it to this file.
        'preview-render-server/src/schema/stubs-flavor1.ts',
      ],
    },
  },
});
