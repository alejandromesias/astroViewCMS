import fs from 'node:fs';
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

/** Refuses an output folder that a build would clear. clearBundle (integration.ts)
 *  deletes everything directly inside `outDir` except the media folder, so this
 *  runs before the build starts and throws, naming the folder and the reason, when
 *  `outDir` is the filesystem root, the site root, an ancestor of the site root,
 *  the current folder (`cwd`) or an ancestor of it, or when it exists, is not
 *  empty and has no bundle.json (manifestDir/bundle.json, written by the build).
 *  A missing or empty folder, and a rebuild over an old bundle, pass. It reads the
 *  file system, so it stays out of the pure resolveSiteConfig. build.ts calls it
 *  once, before build(). */
export function assertOutDirIsSafe(
  site: Pick<ResolvedSiteConfig, 'root' | 'outDir' | 'manifestDir'>,
  cwd: string = process.cwd(),
): void {
  const outDir = path.resolve(site.outDir);
  const refuse = (reason: string): never => {
    throw new Error(
      `Refusing to build into ${outDir}: ${reason}. A build clears this folder, so give it a folder of its own.`,
    );
  };
  const real = comparableFolder(outDir);
  if (path.parse(real).root === real) refuse('it is a filesystem root');
  const root = comparableFolder(site.root);
  if (real === root) refuse('it is the site root');
  if (isWithin(root, real)) refuse('it contains the site root');
  if (isWithin(comparableFolder(cwd), real)) {
    refuse('it is the current folder or contains it');
  }
  if (!fs.existsSync(outDir) || fs.readdirSync(outDir).length === 0) return;
  if (!fs.existsSync(path.join(site.manifestDir, 'bundle.json'))) {
    refuse('it is not empty and has no bundle.json from an earlier build');
  }
}

/** The real, absolute path of `target`: symlinks in the existing part are
 *  followed, so a folder that does not exist yet is placed where it would be. */
function realPath(target: string): string {
  const resolved = path.resolve(target);
  if (fs.existsSync(resolved)) return fs.realpathSync.native(resolved);
  const parent = path.dirname(resolved);
  return parent === resolved
    ? resolved
    : path.join(realPath(parent), path.basename(resolved));
}

/** A folder's real path, lowercased on Windows, whose file system ignores case. */
function comparableFolder(target: string): string {
  const real = realPath(target);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/** True when `inner` is `outer` or sits inside it. Both are comparableFolder keys. */
function isWithin(inner: string, outer: string): boolean {
  const rel = path.relative(outer, inner);
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
}

/** A folder next to `outDir` whose name is `outDir`'s name plus `-suffix`,
 *  e.g. `.build/my-site` gives `.build/my-site-regions`. */
function siblingFolder(outDir: string, suffix: string): string {
  return path.join(path.dirname(outDir), `${path.basename(outDir)}-${suffix}`);
}
