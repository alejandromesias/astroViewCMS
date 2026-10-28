import type { SiteConfig } from '../src/types.ts';

// The richer sample site (bigspring template plus additions). No regions yet:
// phase 1 replaces regions with page rendering and a content overlay.
export default {
  // Site folder, relative to this file.
  root: '../../sample-site',

  regions: {},

  // Fields that build code reads (D1). The import scan already finds both
  // files; the list narrows config.json to the fields astro.config.mjs uses,
  // because the rest of it (nav_button, params, ...) is read by components.
  buildTimeFields: {
    'data:src/config/config.json': [
      'site.base_url',
      'site.base_path',
      'site.trailing_slash',
    ],
    'data:src/config/theme.json': ['*'],
  },

  port: 4401,
} satisfies SiteConfig;
