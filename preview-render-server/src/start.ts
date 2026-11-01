// Runs a site's preview build: static pages plus the preview routes, in one
// plain Node process (no Vite, no compiler).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { choosePort, parseCliOptions } from './cli-options.ts';
import { loadSiteConfig } from './site-config.ts';

// --root and --out pick the site folder and the output folder (see
// resolveSiteConfig). --port sets the port ahead of PORT and the config's port.
const options = parseCliOptions(process.argv.slice(2));
const site = await loadSiteConfig(options.configPath, undefined, {
  root: options.root,
  out: options.out,
});

process.env.HOST ??= 'localhost';
process.env.PORT = choosePort(options.port, process.env.PORT, site.port);

await import(pathToFileURL(path.join(site.outDir, 'server/entry.mjs')).href);
