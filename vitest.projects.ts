// The unit-test projects, one per workspace package. Shared by vitest.config.ts
// (the unified coverage run) and vitest.mutation.config.ts (Stryker takes one
// config per run), so a package is listed in one place. The renderer keeps its
// own config (Astro's Vite setup); the other packages get an inline one.
import { configDefaults, type TestProjectConfiguration } from 'vitest/config';

export const UNIT_PROJECTS: TestProjectConfiguration[] = [
  'preview-render-server/vitest.config.ts',
  {
    test: {
      name: 'preview-contract',
      root: 'preview-contract',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'preview-protocol',
      root: 'preview-protocol',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'cms-server',
      root: 'cms-server',
      include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'editor/**/*.test.ts'],
      // The end-to-end files run from cms-server's vitest.e2e.config.ts (test:e2e).
      exclude: [...configDefaults.exclude, 'test/e2e/**'],
    },
  },
];
