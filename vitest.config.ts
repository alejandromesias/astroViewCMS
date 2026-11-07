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
      // Decision 2026-11-02 (user): every package has the same floors, 80 / 90 / 80 / 80, until
      // a further assessment (DOCS/Guidelines/QUALITY-TOOLING.md, unit tests and coverage floors). One glob per
      // package, so a weak package cannot hide behind strong ones. A file that cannot reasonably
      // meet them may be excluded below, only after the user approves it.
      thresholds: {
        'preview-render-server/**': {
          lines: 80,
          functions: 90,
          branches: 80,
          statements: 80,
        },
        'preview-protocol/**': {
          lines: 80,
          functions: 90,
          branches: 80,
          statements: 80,
        },
        'preview-contract/**': {
          lines: 80,
          functions: 90,
          branches: 80,
          statements: 80,
        },
        'cms-server/**': {
          lines: 80,
          functions: 90,
          branches: 80,
          statements: 80,
        },
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
        'preview-render-server/src/preview-config-route.ts',
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
