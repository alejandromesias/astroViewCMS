// Which bundle is current (WORKPLAN 2.4a). A source names the bundle's folder and its bundle.json; the
// store reads the other files. 2.9c replaces the directory source with the real one.
import path from 'node:path';
import { type BundleJson, bundleJsonSchema } from 'preview-contract';
import { readOptionalFile } from './read.ts';

/** The current bundle: its folder, and its bundle.json as parsed. */
export interface BundleRef {
  readonly dir: string;
  readonly identity: BundleJson;
}

/** Answers which bundle is current, or null when there is none. Rejects with a BundleError when bundle.json is invalid. */
export interface BundleSource {
  current(): Promise<BundleRef | null>;
}

/** Reads bundle.json from `dir` on every call, so a rebuilt bundle is seen at once. A folder without bundle.json has no bundle. */
export function directoryBundleSource(dir: string): BundleSource {
  return {
    async current() {
      const identity = await readOptionalFile(
        dir,
        'bundle.json',
        bundleJsonSchema,
      );
      return identity === null ? null : { dir, identity };
    },
  };
}

/** The folder of a bundle's manifest files, bundle.json among them: `<bundlesDir>/<bundleId>/manifest`. */
export function bundleManifestDir(
  bundlesDir: string,
  bundleId: string,
): string {
  return path.join(bundlesDir, bundleId, 'manifest');
}

/**
 * The real source (2.9c): the bundle the state names, `servedId` (the state's current bundle id, or null when there is
 * none). Read on every call, so a swap is seen at once. A bundle folder without bundle.json has no bundle.
 */
export function stateBundleSource(
  bundlesDir: string,
  servedId: () => string | null,
): BundleSource {
  return {
    async current() {
      const bundleId = servedId();
      return bundleId === null
        ? null
        : directoryBundleSource(
            bundleManifestDir(bundlesDir, bundleId),
          ).current();
    },
  };
}
