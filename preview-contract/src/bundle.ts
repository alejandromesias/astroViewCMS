// bundle.json (WORKPLAN 2.0b): the identity of one build, written into the
// manifest folder next to the other manifests. Parsed at the trust boundary.
import { z } from 'zod';

/** A bundle id: a letter or digit, then letters, digits, dots, dashes or
 *  underscores. It becomes a folder name (.cms/<site>/bundles/<bundleId>), so
 *  `.`, `..` and separators are refused. build.ts checks --bundle-id with it. */
export const bundleIdPattern = /^[A-Za-z0-9][\w.-]*$/;

/** The whole of bundle.json. `siteCommit` is null outside a git checkout. */
export const bundleJsonSchema = z.strictObject({
  bundleId: z.string().regex(bundleIdPattern),
  siteCommit: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/)
    .nullable(),
  protocolVersion: z.number().int().positive(),
  astroVersion: z.string().min(1),
  builtAt: z.iso.datetime(),
});

/** bundle.json, as the parsed value gives it. */
export type BundleJson = z.infer<typeof bundleJsonSchema>;
