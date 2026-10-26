// Runs a site's preview build: static pages plus the /__preview route, in one
// plain Node process (no Vite, no compiler).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSiteConfig } from './site-config.js';

const site = await loadSiteConfig(process.argv[2]);

process.env.HOST ??= 'localhost';
process.env.PORT ??= String(site.port);

await import(pathToFileURL(path.join(site.outDir, 'server/entry.mjs')).href);
