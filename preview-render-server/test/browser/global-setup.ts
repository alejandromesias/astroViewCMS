// Builds the browser suite's site (site.config.ts) and starts its server; the
// harness page and the iframe's preview both come from these.
import type { TestProject } from 'vitest/node';
import {
  type PreviewServer,
  startPreviewServer,
} from '../support/preview-server.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

let preview: PreviewServer | undefined;

export async function setup(project: TestProject) {
  preview = await startPreviewServer('test/browser/site.config.ts');
  project.provide('baseUrl', preview.baseUrl);
}

export async function teardown() {
  await preview?.stop();
}
