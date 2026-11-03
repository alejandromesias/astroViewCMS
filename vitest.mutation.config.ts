// The Vitest config that Stryker runs (stryker.config.json, vitest.configFile).
// Stryker takes one config per run, so it lists every package's unit tests as
// projects. The list is shared with the unified coverage run (vitest.config.ts).
import { defineConfig } from 'vitest/config';
import { UNIT_PROJECTS } from './vitest.projects.ts';

// Stryker copies the repo into .stryker-tmp/sandbox-*, inside the real checkout. A mutant that
// changes the cwd of a git call would then find the real repo and could run `checkout --force`
// in it (happened 2026-11-03). The ceiling stops git's search for a repo at the sandbox folder.
if (process.cwd().includes('.stryker-tmp')) {
  process.env.GIT_CEILING_DIRECTORIES = process.cwd();
}

export default defineConfig({
  test: {
    projects: UNIT_PROJECTS,
  },
});
