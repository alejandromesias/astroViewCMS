// Test double for the `virtual:preview-site` module that the integration
// generates during a real build (aliased in vitest.config.ts). Tests fill in
// `images`; Vitest gives each test file a fresh copy.
import os from 'node:os';
import path from 'node:path';
import type { ImageMetadata } from 'astro';
import type { CollectionInfo } from '../../src/schema/stubs-flavor2.ts';

export const images: Record<string, ImageMetadata> = {};
export const siteRoot = path.join(os.tmpdir(), `preview-site-test-${process.pid}`);
export const mediaDir = path.join(os.tmpdir(), `preview-media-test-${process.pid}`);
export const manifestDir = path.join(os.tmpdir(), `preview-manifest-test-${process.pid}`);
export const cmsCollections: Record<string, CollectionInfo> | undefined = undefined;
export const markdownConfig = undefined;
export const pages: Record<string, () => Promise<any>> = {};
export const urlRules = { base: '/', trailingSlash: 'ignore' as const };
