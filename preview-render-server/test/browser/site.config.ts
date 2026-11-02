// The sample site for the browser suite. The harness origin is not in this
// config: global-setup passes it as PREVIEW_EDITOR_ORIGINS to the node, and the
// bridge reads it from GET /__preview/config at run time (WORKPLAN 2.8d).
import sampleSite from '../../sites/sample-site.config.ts';
import type { SiteConfig } from '../../src/types.ts';

export default {
  ...sampleSite,
  root: '../../../sample-site',
} satisfies SiteConfig;
