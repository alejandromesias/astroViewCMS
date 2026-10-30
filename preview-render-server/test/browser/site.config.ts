// The sample site for the browser suite: sample-site with the harness origin
// listed in editorOrigins, which the build bakes into the bridge (WORKPLAN 1.6).
import sampleSite from '../../sites/sample-site.config.ts';
import type { SiteConfig } from '../../src/types.ts';
import { HARNESS_ORIGIN } from './origin.ts';

export default {
  ...sampleSite,
  root: '../../../sample-site',
  editorOrigins: [HARNESS_ORIGIN],
} satisfies SiteConfig;
