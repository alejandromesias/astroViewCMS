// The parsed bundle, cached by bundleId (WORKPLAN 2.4a). A new bundle replaces the cached one only after
// all five of its files parse, so a half-read bundle is never served.
import { type Bundle, readBundle } from './read.ts';
import type { BundleSource } from './source.ts';

/** Gives the current bundle, parsed. */
export interface BundleStore {
  /** Null when there is no bundle. Rejects with a BundleError when a file of the current bundle is invalid. */
  current(): Promise<Bundle | null>;
}

/** A store over `source`. The parsed bundle is reused while its bundleId stays the same. */
export function createBundleStore(source: BundleSource): BundleStore {
  let cached: Bundle | null = null;
  return {
    async current() {
      const ref = await source.current();
      if (ref === null) return null;
      if (cached?.identity.bundleId === ref.identity.bundleId) return cached;
      const bundle = await readBundle(ref.dir, ref.identity);
      cached = bundle;
      return bundle;
    },
  };
}
