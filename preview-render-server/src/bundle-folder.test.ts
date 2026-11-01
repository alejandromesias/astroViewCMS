import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bundleFolder, bundleFolderOf } from './bundle-folder.ts';

/** Writes an empty file, creating its folders. */
function touch(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

/** Makes a fake bundle at `dir`: the server entry and one chunk. Returns the
 *  chunk's module URL, the way a running module sees itself. */
function makeBundle(dir: string): string {
  touch(path.join(dir, 'server', 'entry.mjs'));
  const chunk = path.join(dir, 'server', 'chunks', 'render_abc.mjs');
  touch(chunk);
  return pathToFileURL(chunk).href;
}

describe('bundleFolderOf', () => {
  it('finds the bundle folder from a chunk two folders down', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-folder-'));
    try {
      const bundle = path.join(tmp, 'bundle');
      expect(bundleFolderOf(makeBundle(bundle))).toBe(bundle);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('finds the bundle folder from the server entry itself', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-folder-'));
    try {
      const bundle = path.join(tmp, 'bundle');
      makeBundle(bundle);
      const entry = pathToFileURL(
        path.join(bundle, 'server', 'entry.mjs'),
      ).href;
      expect(bundleFolderOf(entry)).toBe(bundle);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('finds the copy when the bundle folder is copied to another path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-folder-'));
    try {
      const original = path.join(tmp, 'original');
      const copy = path.join(tmp, 'elsewhere', 'copy');
      makeBundle(original);
      fs.cpSync(original, copy, { recursive: true });
      const copiedChunk = pathToFileURL(
        path.join(copy, 'server', 'chunks', 'render_abc.mjs'),
      ).href;
      expect(bundleFolderOf(copiedChunk)).toBe(copy);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('takes the nearest bundle when one bundle sits inside another', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-folder-'));
    try {
      const outer = path.join(tmp, 'outer');
      const inner = path.join(outer, 'inner');
      touch(path.join(outer, 'server', 'entry.mjs'));
      expect(bundleFolderOf(makeBundle(inner))).toBe(inner);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws with the module URL when no bundle is above it', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-folder-'));
    try {
      const loose = path.join(tmp, 'loose', 'module.mjs');
      touch(loose);
      const url = pathToFileURL(loose).href;
      expect(() => bundleFolderOf(url)).toThrow(
        new Error(`No preview bundle (server/entry.mjs) above ${url}`),
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('bundleFolder', () => {
  it('returns the named folder inside the bundle that holds the module', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-folder-'));
    try {
      const bundle = path.join(tmp, 'bundle');
      const url = makeBundle(bundle);
      expect(bundleFolder('manifest', url)).toBe(path.join(bundle, 'manifest'));
      expect(bundleFolder('media', url)).toBe(path.join(bundle, 'media'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
