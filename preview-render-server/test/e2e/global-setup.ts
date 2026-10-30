// Builds sample-site into a temporary folder, starts the real server on a free
// port and hands its URL to the tests. The build and server come from
// test/support/preview-server.ts, shared with the browser suite.
import type { TestProject } from 'vitest/node';
import {
  type PreviewServer,
  startPreviewServer,
} from '../support/preview-server.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
    buildDir: string;
  }
}

let preview: PreviewServer | undefined;

export async function setup(project: TestProject) {
  preview = await startPreviewServer('sites/sample-site.config.ts');
  project.provide('baseUrl', preview.baseUrl);
  project.provide('buildDir', preview.buildDir);
}

export async function teardown() {
  await preview?.stop();
}
