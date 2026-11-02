// Builds a site for preview: the site's own astro.config plus the Node adapter
// and the preview integration, written to .build/<site>. The site's files and
// its normal build stay untouched.
import node from '@astrojs/node';
import { build } from 'astro';
import { newBundleId } from './bundle.ts';
import { parseCliOptions } from './cli-options.ts';
import previewRenderServer from './integration.ts';
import { assertOutDirIsSafe, loadSiteConfig } from './site-config.ts';

// --dev (or PREVIEW_DEV=1) adds the editor's stopgap route /__dev/documents.
// --root and --out override the site config's root and output folder (see
// resolveSiteConfig). --port belongs to start.ts and is ignored here.
// --bundle-id sets the id in bundle.json (tests); otherwise each build gets a
// fresh one.
const options = parseCliOptions(process.argv.slice(2));
if (options.dev) process.env.PREVIEW_DEV = '1';

const site = await loadSiteConfig(options.configPath, undefined, {
  root: options.root,
  out: options.out,
});
// Refuses an output folder the build would clear, before anything is deleted.
assertOutDirIsSafe(site);

await build({
  root: site.root,
  outDir: site.outDir,
  adapter: node({ mode: 'middleware' }),
  integrations: [previewRenderServer(site, options.bundleId ?? newBundleId())],
});

console.log(`\nPreview build written to ${site.outDir}`);
