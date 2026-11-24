// bundle.json (WORKPLAN 2.0b): the identity of one build, written into the
// manifest folder next to the other manifests. Parsed at the trust boundary.
import { z } from 'zod';

/** A bundle id: a letter or digit, then letters, digits, dots, dashes or
 *  underscores. It becomes a folder name (.cms/<site>/bundles/<bundleId>), so
 *  `.`, `..` and separators are refused. build.ts checks --bundle-id with it. */
export const bundleIdPattern = /^[A-Za-z0-9][\w.-]*$/;

/** The whole of bundle.json. `siteCommit` is null outside a git checkout.
 *  `site` is the Astro config's `site`, written only when the site sets one
 *  (WORKPLAN 2.14a-1); the render node gives it to Astro.site. */
export const bundleJsonSchema = z.strictObject({
  bundleId: z.string().regex(bundleIdPattern),
  siteCommit: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/)
    .nullable(),
  protocolVersion: z.number().int().positive(),
  /** The schema.json version the build wrote (SCHEMA_VERSION). Optional here so the parser reads an older bundle;
   *  cms-server checks it against SCHEMA_VERSION. */
  schemaVersion: z.number().int().positive().optional(),
  astroVersion: z.string().min(1),
  builtAt: z.iso.datetime(),
  site: z.string().optional(),
});

/** bundle.json, as the parsed value gives it. */
export type BundleJson = z.infer<typeof bundleJsonSchema>;
