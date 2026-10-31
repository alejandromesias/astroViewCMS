// Module-graph views (`npm run graph`, `npm run deps`), not rules: those live in
// .dependency-cruiser.cjs, whose resolve options this reuses so both see the same
// edges. Production code only, the same scope as the depcruise rules: tests, test
// helpers, Vitest configs and ambient .d.ts files are left out.
const base = require('./.dependency-cruiser.cjs');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    ...base.options,
    exclude: {
      path: [
        // Keep packages as edge targets (doNotFollow still stops at them); deps.txt
        // collapses them to package names, modules.html drops them with -I.
        ...base.options.exclude.path.filter((p) => !p.includes('node_modules')),
        '\\.test\\.ts$',
        '/test/',
        '^preview-render-server/test-editor/',
        'vitest[^/]*\\.config\\.ts$',
        '\\.d\\.ts$',
      ],
    },
  },
};
