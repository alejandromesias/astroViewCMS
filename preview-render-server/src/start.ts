// Runs a site's preview build: static pages plus the preview routes, in one
// plain Node process (no Vite, no compiler). The build's middleware handler runs
// behind the front server (PHASE-2-DESIGN 5.7).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { choosePort, parseCliOptions } from './cli-options.ts';
import {
  type AdapterHandler,
  createFrontServer,
} from './serve/front-server.ts';
import { createGate } from './serve/gate.ts';
import { readServeSettings } from './serve/settings.ts';
import { loadSiteConfig } from './site-config.ts';
import { exitWhenStdinCloses } from './stdin-exit.ts';

// --root and --out pick the site folder and the output folder (see
// resolveSiteConfig). --port sets the port ahead of PORT and the config's port.
const options = parseCliOptions(process.argv.slice(2));
const site = await loadSiteConfig(options.configPath, undefined, {
  root: options.root,
  out: options.out,
});

process.env.HOST ??= 'localhost';
process.env.PORT = choosePort(options.port, process.env.PORT, site.port);

// Refuses to start before the build is loaded when the environment is not safe.
const settings = readServeSettings(process.env);
const gate = createGate(settings.gate);

// A standalone build listens on import unless this is set; it must not listen here,
// so the front server is the only listener and the mode check below can run.
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const entry: { handler?: unknown; options?: { mode?: unknown } } = await import(
  pathToFileURL(path.join(site.outDir, 'server/entry.mjs')).href
);
if (
  typeof entry.handler !== 'function' ||
  entry.options?.mode !== 'middleware'
) {
  throw new Error(
    'The build is not in middleware mode: rebuild the preview, since start.ts needs the adapter in mode middleware',
  );
}

const server = createFrontServer({
  clientDir: path.join(site.outDir, 'client'),
  handler: entry.handler as AdapterHandler,
  csp: settings.csp,
  gate,
});
server.listen(Number(process.env.PORT), process.env.HOST);
// cms-server holds the other end of stdin, so this node ends with cms-server (stdin-exit.ts, 2.1i).
exitWhenStdinCloses(process.stdin, () => process.exit(0));
