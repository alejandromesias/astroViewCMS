import type { SiteConfig } from '../src/types.ts';

// The richer sample site (bigspring template plus additions). No islands yet:
// phase 1 replaces islands with page rendering and a content overlay.
export default {
  // Site folder, relative to this file.
  root: '../../sample-site',

  islands: {},

  port: 4401,
} satisfies SiteConfig;
