import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ResolvedSiteConfig, SiteConfig } from './types.ts';

const BUILD_DIR = path.resolve(import.meta.dirname, '../.build');

// Loads a site config file and resolves its paths. The build output goes to
// .build/<site folder name>, so the site's own dist/ is never touched. Files
// that must survive a rebuild (island wrappers, uploaded draft images) live
// next to it, outside outDir. PREVIEW_BUILD_DIR moves all of it elsewhere
// (the end-to-end tests build into a temporary folder).
export async function loadSiteConfig(
  configPath: string | undefined,
  buildDir = process.env.PREVIEW_BUILD_DIR || BUILD_DIR,
): Promise<ResolvedSiteConfig> {
  if (!configPath) {
    throw new Error('Usage: node src/<script>.ts <site config file>');
  }
  const configFile = path.resolve(configPath);
  const { default: config } = (await import(pathToFileURL(configFile).href)) as { default: SiteConfig };
  return resolveSiteConfig(config, path.dirname(configFile), path.resolve(buildDir));
}

/** Makes a config's paths absolute: the site root against the config's folder,
 *  and the output, wrapper and upload folders under `buildDir`, named after the
 *  site folder. Pure (no file access), so it's the part tests cover. */
export function resolveSiteConfig(config: SiteConfig, configDir: string, buildDir = BUILD_DIR): ResolvedSiteConfig {
  const root = path.resolve(configDir, config.root);
  const name = path.basename(root);
  return {
    ...config,
    root,
    outDir: path.join(buildDir, name),
    islandsDir: path.join(buildDir, `${name}-islands`),
    mediaDir: path.join(buildDir, `${name}-media`),
  };
}
