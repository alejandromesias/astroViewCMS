// Builds sample-site once into a folder inside the workspace (the built server resolves
// its packages from node_modules), for the supervisor's end-to-end tests. The build runs
// as a child process of preview-render-server, as its own end-to-end setup does.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The built bundle folder of sample-site; its manifest/bundle.json names the bundleId. */
    bundleDir: string;
  }
}

const CMS_DIR = path.resolve(import.meta.dirname, '../..');
const RENDERER_DIR = path.resolve(CMS_DIR, '../preview-render-server');
// Astro goes to its background mode when it sees an AI agent; children get the markers cleared.
const AGENT_VARS = [
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_AGENT_SDK_VERSION',
];

let workDir: string | undefined;

export async function setup(project: TestProject) {
  fs.mkdirSync(path.join(CMS_DIR, '.build'), { recursive: true });
  workDir = fs.mkdtempSync(path.join(CMS_DIR, '.build', 'supervisor-e2e-'));
  const bundleDir = path.join(workDir, 'bundle');
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of AGENT_VARS) delete env[name];
  const build = spawnSync(
    process.execPath,
    [
      'src/build.ts',
      'sites/sample-site.config.ts',
      '--out',
      bundleDir,
      '--bundle-id',
      'e2e-first',
    ],
    { cwd: RENDERER_DIR, env, encoding: 'utf8', timeout: 240_000 },
  );
  if (build.status !== 0) {
    throw new Error(
      `The sample-site build failed (${build.status}):\n${build.stdout}\n${build.stderr}`,
    );
  }
  project.provide('bundleDir', bundleDir);
}

export async function teardown() {
  if (workDir !== undefined)
    fs.rmSync(workDir, { recursive: true, force: true });
}
