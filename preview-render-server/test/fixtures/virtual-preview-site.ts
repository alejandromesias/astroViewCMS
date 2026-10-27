// Test double for the `virtual:preview-site` module that the integration
// generates during a real build (aliased in vitest.config.ts). Tests fill in
// `regions` and `images`; Vitest gives each test file a fresh copy.
import os from 'node:os';
import path from 'node:path';
import type { ImageMetadata } from 'astro';
import type { CollectionInfo } from '../../src/schema/stubs-flavor2.ts';
import type { PreviewRegion } from 'virtual:preview-site';

export const regions: Record<string, PreviewRegion> = {};
export const images: Record<string, ImageMetadata> = {};
export const mediaDir = path.join(os.tmpdir(), `preview-media-test-${process.pid}`);
export const manifestDir = path.join(os.tmpdir(), `preview-manifest-test-${process.pid}`);
export const cmsCollections: Record<string, CollectionInfo> | undefined = undefined;
