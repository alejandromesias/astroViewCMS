import type { SiteConfig } from '../src/types.ts';

// The richer sample site (bigspring template plus additions). No regions yet:
// phase 1 replaces regions with page rendering and a content overlay.
export default {
  // Site folder, relative to this file.
  root: '../../sample-site',

  regions: {},

  port: 4401,
} satisfies SiteConfig;
