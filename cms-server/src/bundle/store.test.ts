import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BundleJson } from 'preview-contract';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundleFolder,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import type { BundleRef, BundleSource } from './source.ts';
import { createBundleStore } from './store.ts';

/** A bundle.json identity with the given id, built per test. */
const identityOf = (bundleId: string): BundleJson => ({
  bundleId,
  siteCommit: null,
  protocolVersion: 2,
  astroVersion: '7.4.2',
  builtAt: '2026-11-01T10:00:00.000Z',
});

/** A source whose answer the test changes between calls. */
function switchableSource(initial: BundleRef | null) {
  let ref = initial;
  const source: BundleSource = { current: async () => ref };
  return {
    source,
    set(next: BundleRef | null) {
      ref = next;
    },
  };
}

afterEach(() => removeBundleFolders());

describe('createBundleStore', () => {
  it('answers null when the source has no bundle', async () => {
    const store = createBundleStore(switchableSource(null).source);
    expect(await store.current()).toBeNull();
  });

  it('reuses the parsed bundle while its bundleId stays the same', async () => {
    const dir = await bundleFolder();
    const store = createBundleStore(
      switchableSource({ dir, identity: identityOf('a') }).source,
    );
    const first = await store.current();
    // The file is gone now: a cache hit must not read it again.
    await rm(join(dir, 'documents.json'));
    expect(await store.current()).toBe(first);
  });

  it('reads the new bundle when the bundleId changes', async () => {
    const dir = await bundleFolder();
    const second = await bundleFolder({ 'documents.json': '[]' });
    const switching = switchableSource({ dir, identity: identityOf('a') });
    const store = createBundleStore(switching.source);
    const first = await store.current();
    switching.set({ dir: second, identity: identityOf('b') });
    const next = await store.current();
    expect(first?.identity.bundleId).toBe('a');
    expect(next?.identity.bundleId).toBe('b');
    expect(next?.documents.size).toBe(0);
  });

  it('keeps the cached bundle when the new one fails to parse', async () => {
    const good = await bundleFolder();
    const broken = await bundleFolder({ 'documents.json': '[' });
    const switching = switchableSource({
      dir: good,
      identity: identityOf('a'),
    });
    const store = createBundleStore(switching.source);
    const cached = await store.current();

    switching.set({ dir: broken, identity: identityOf('b') });
    await expect(store.current()).rejects.toMatchObject({
      name: 'BundleError',
      message: 'documents.json: is not valid JSON',
    });

    // Back on the old bundle: it is still the cached one, so nothing is re-read.
    await rm(join(good, 'documents.json'));
    switching.set({ dir: good, identity: identityOf('a') });
    expect(await store.current()).toBe(cached);
  });
});
