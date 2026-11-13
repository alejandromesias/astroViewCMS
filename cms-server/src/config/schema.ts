// The cms.config.ts schema (PHASE-2-DESIGN 5.10). Strict everywhere: an unknown
// key is an error, so a typo such as `brnach` fails at start instead of being ignored.
import { z } from 'zod';

// A site name is a folder name under `.cms/`, so it must be a single safe segment.
const SITE_NAME = /^[a-z0-9][a-z0-9-]*$/;

// Both separators count, so a Windows path is refused the same way on any OS:
// absolute (`/x`, `\x`, `C:x`) or with a `..` segment.
function isInsideFolder(path: string): boolean {
  if (
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:/.test(path)
  ) {
    return false;
  }
  return path !== '' && !path.split(/[\\/]/).includes('..');
}

function insideFolder(message: string) {
  return z.string().refine(isInsideFolder, { error: message });
}

// An origin is scheme, host and port only: http or https, no path, query, hash or
// credentials. The result is the normalised origin (`https://x.test/` becomes `https://x.test`).
function originOf(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const isWeb = url.protocol === 'http:' || url.protocol === 'https:';
  const isBare =
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '';
  return isWeb && isBare ? url.origin : undefined;
}

const ORIGIN_MESSAGE =
  'must be an http or https origin: scheme, host and port only';

const origin = z.string().transform((value, ctx) => {
  const normalised = originOf(value);
  if (normalised === undefined) {
    ctx.addIssue({ code: 'custom', message: ORIGIN_MESSAGE });
    return z.NEVER;
  }
  return normalised;
});

// Formats a collection can create (design 5.4: JSON, YAML, Markdown, MDX). Hand-kept:
// it is the create-able part of the format union in preview-contract/src/manifest.ts,
// without the read-only `toml` and `other`.
const newEntryFormat = z.enum(['json', 'md', 'mdx', 'yaml']);
const CollectionEntry = z.strictObject({
  newEntryFormat: newEntryFormat.optional(),
});

// Collection names come from the user. `z.record` writes each key with `obj[key] = value`,
// which drops a `__proto__` name, so the entries are checked one by one and the map is
// built with `Object.fromEntries` (IMPLEMENTATION-RECOMMENDATIONS 1).
const collections = z
  .custom<Record<string, unknown>>(
    (value) =>
      typeof value === 'object' && value !== null && !Array.isArray(value),
    { error: 'collections must be an object' },
  )
  .transform((input, ctx) => {
    const entries: Array<[string, z.output<typeof CollectionEntry>]> = [];
    for (const [name, value] of Object.entries(input)) {
      const result = CollectionEntry.safeParse(value);
      if (result.success) {
        entries.push([name, result.data]);
      } else {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: [name, ...issue.path],
            message: issue.message,
          });
        }
      }
    }
    return Object.fromEntries(entries);
  });

const CmsConfigSchema = z
  .strictObject({
    site: z.string().regex(SITE_NAME, {
      error:
        'site must be lower-case letters, digits and hyphens, starting with a letter or digit',
    }),
    remote: z.string().min(1),
    branch: z.string().min(1).default('main'),
    siteDir: insideFolder(
      'siteDir must be a relative path inside the repo',
    ).default('.'),
    previewSiteConfig: insideFolder(
      'previewSiteConfig must be a relative path inside the workspace',
    ),
    origins: z.strictObject({ cms: origin, preview: origin }),
    publish: z
      .strictObject({
        buildCheck: z.enum(['always', 'auto', 'never']).default('auto'),
      })
      .prefault({}),
    media: z
      .strictObject({
        folder: insideFolder(
          'media.folder must be a relative path inside the site',
        ).default('src/assets/uploads'),
      })
      .prefault({}),
    // At most 299: the poll loop (sync/poll.ts) syncs only while a session, five minutes long, is open (2.10g).
    syncIntervalSeconds: z
      .number()
      .int()
      .positive()
      .max(
        299,
        'syncIntervalSeconds must be 299 or less: the sync runs only while a session is open, and a session lasts five minutes',
      )
      .default(60),
    collections: collections.default({}),
    git: z
      .strictObject({
        author: z.string().min(1).default('astroViewCMS <cms@localhost>'),
      })
      .prefault({}),
  })
  .superRefine((config, ctx) => {
    if (config.origins.cms === config.origins.preview) {
      ctx.addIssue({
        code: 'custom',
        path: ['origins', 'preview'],
        message: 'origins.cms and origins.preview must differ',
      });
    }
  });

export type CmsConfig = z.output<typeof CmsConfigSchema>;

/** Parses a raw config value. Throws a `ZodError` that lists every problem. */
export function parseConfig(raw: unknown): CmsConfig {
  return CmsConfigSchema.parse(raw);
}
