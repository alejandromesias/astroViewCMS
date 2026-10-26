import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Loads a site config file and resolves its paths. The build output goes to
// .build/<site folder name>, so the site's own dist/ is never touched.
export async function loadSiteConfig(configPath) {
  if (!configPath) {
    throw new Error('Usage: node src/<script>.js <site config file>');
  }
  const configFile = path.resolve(configPath);
  const { default: config } = await import(pathToFileURL(configFile).href);
  const root = path.resolve(path.dirname(configFile), config.root);
  const outDir = path.resolve(import.meta.dirname, '../.build', path.basename(root));
  return { ...config, root, outDir };
}
