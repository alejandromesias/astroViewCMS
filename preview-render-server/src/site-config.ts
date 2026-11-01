import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ResolvedSiteConfig, SiteConfig } from './types.ts';

const BUILD_DIR = path.resolve(import.meta.dirname, '../.build');

/** Command-line overrides for one load (see cli-options.ts). Each one replaces
 *  the matching value that the config file or the defaults would give. */
export interface SiteOverrides {
  /** Replaces the config's `root`. Resolved against the current folder, unlike
   *  the config's own `root`, which is resolved against the config's folder. */
  root?: string | undefined;
  /** Replaces the output folder. Resolved against the current folder. */
  out?: string | undefined;
}

// Loads a site config file and resolves its paths. The build output goes to
// .build/<site folder name>, so the site's own dist/ is never touched. The
// manifests and the upload folder live inside that output (the bundle is
// self-contained, and the server finds them relative to itself); the region
// wrappers are build-time files and live next to it. PREVIEW_BUILD_DIR moves
// all of it elsewhere (the end-to-end tests build into a temporary folder).
// `overrides` come from the command line and win over the config file.
export async function loadSiteConfig(
  configPath: string | undefined,
  buildDir = process.env.PREVIEW_BUILD_DIR || BUILD_DIR,
  overrides: SiteOverrides = {},
): Promise<ResolvedSiteConfig> {
  if (!configPath) {
    throw new Error('Usage: node src/<script>.ts <site config file>');
  }
  const configFile = path.resolve(configPath);
  const { default: config } = (await import(
    pathToFileURL(configFile).href
  )) as { default: SiteConfig };
  return resolveSiteConfig(
    config,
    path.dirname(configFile),
    path.resolve(buildDir),
    overrides,
  );
}

/** Makes a config's paths absolute: the site root against the config's folder,
 *  and the output folder under `buildDir`, named after the site folder. The
 *  manifests and the upload folder are inside the output folder (2.0d). The
 *  region wrapper folder sits next to it, named after it, so two outputs never
 *  share one. An override replaces `root` or `outDir` (its path is resolved
 *  against the current folder). Pure (no file access), so it's the part tests
 *  cover. */
export function resolveSiteConfig(
  config: SiteConfig,
  configDir: string,
  buildDir = BUILD_DIR,
  overrides: SiteOverrides = {},
): ResolvedSiteConfig {
  const root =
    overrides.root === undefined
      ? path.resolve(configDir, config.root)
      : path.resolve(overrides.root);
  const outDir =
    overrides.out === undefined
      ? path.join(buildDir, path.basename(root))
      : path.resolve(overrides.out);
  return {
    ...config,
    root,
    outDir,
    regionsDir: siblingFolder(outDir, 'regions'),
    mediaDir: path.join(outDir, 'media'),
    manifestDir: path.join(outDir, 'manifest'),
  };
}

/** A folder next to `outDir` whose name is `outDir`'s name plus `-suffix`,
 *  e.g. `.build/my-site` gives `.build/my-site-regions`. */
function siblingFolder(outDir: string, suffix: string): string {
  return path.join(path.dirname(outDir), `${path.basename(outDir)}-${suffix}`);
}
