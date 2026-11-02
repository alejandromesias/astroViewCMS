// Which bundle is current (WORKPLAN 2.4a). A source names the bundle's folder and its bundle.json; the
// store reads the other files. 2.9c replaces the directory source with the real one.
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
