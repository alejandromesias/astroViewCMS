// Builds a site for preview: the site's own astro.config plus the Node adapter
// and the preview integration, written to .build/<site>. The site's files and
// its normal build stay untouched.
import node from '@astrojs/node';
import { build } from 'astro';
import previewRenderServer from './integration.ts';
import { loadSiteConfig } from './site-config.ts';

// --dev (or PREVIEW_DEV=1) adds the editor's stopgap route /__dev/documents.
if (process.argv.includes('--dev')) process.env.PREVIEW_DEV = '1';

const site = await loadSiteConfig(process.argv[2]);

await build({
  root: site.root,
  outDir: site.outDir,
  adapter: node({ mode: 'standalone' }),
  integrations: [previewRenderServer(site)],
});

console.log(`\nPreview build written to ${site.outDir}`);
