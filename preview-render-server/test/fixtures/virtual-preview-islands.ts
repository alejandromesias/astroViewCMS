// Test double for the `virtual:preview-islands` module that the integration
// generates during a real build (aliased in vitest.config.ts). Tests fill in
// `islands` and `images`; Vitest gives each test file a fresh copy.
import os from 'node:os';
import path from 'node:path';
import type { ImageMetadata } from 'astro';
import type { PreviewIsland } from 'virtual:preview-islands';

export const islands: Record<string, PreviewIsland> = {};
export const images: Record<string, ImageMetadata> = {};
export const mediaDir = path.join(os.tmpdir(), `preview-media-test-${process.pid}`);
