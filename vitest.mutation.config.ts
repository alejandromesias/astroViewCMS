// The Vitest config that Stryker runs (stryker.config.json, vitest.configFile).
// Stryker takes one config per run, so it lists every package's unit tests as
// projects. The list is shared with the unified coverage run (vitest.config.ts).
import { defineConfig } from 'vitest/config';
import { UNIT_PROJECTS } from './vitest.projects.ts';

export default defineConfig({
  test: {
    projects: UNIT_PROJECTS,
  },
});
