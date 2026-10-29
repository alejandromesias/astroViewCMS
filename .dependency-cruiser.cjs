// Module-graph rules. DOCS/QUALITY-TOOLING-PLAN.md step 9 has the reasoning;
// DOCS/MODULE-GRAPH.md lists the hand checks these rules replaced.
const SRC = '^preview-render-server/src/';
const TESTS = '(\\.test\\.ts$|/test/)';
// Files that serve preview requests. build-time code (manifest, schema, build.ts,
// integration.ts) and dev/** (PREVIEW_DEV only) write files and are out of scope.
const REQUEST_PATH = `${SRC}(render/|overlay/|client/|[^/]+-route\\.ts$|request-guard\\.ts$)`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'client-stays-browser-safe',
      comment:
        'client/** ships to the browser: no node builtins, no server modules outside client/. ' +
        'The bridge size budget depends on this.',
      severity: 'error',
      from: { path: `${SRC}client/`, pathNot: TESTS },
      to: {
        path: [`^node:`, `^(assert|buffer|child_process|crypto|fs|http|https|net|os|path|stream|url|util|zlib)$`, `${SRC}(?!client/)`],
      },
    },
    {
      name: 'protocol-is-a-leaf',
      comment: 'preview-protocol is the shared contract; the CMS app imports it too.',
      severity: 'error',
      from: { path: '^preview-protocol/src/' },
      to: { path: ['preview-render-server'] },
    },
    {
      name: 'request-path-no-process-or-git',
      comment: 'The preview node is read-only (decision 4): no child processes, no git, no store/write modules.',
      severity: 'error',
      from: { path: REQUEST_PATH, pathNot: TESTS },
      to: {
        path: ['^node:child_process$', '^child_process$', '^(simple-git|isomorphic-git|nodegit)$', 'node_modules/(simple-git|isomorphic-git|nodegit)/', `${SRC}(store|write)[^/]*(/|\\.ts$)`],
      },
    },
    {
      name: 'request-path-fs-allowlist',
      comment:
        'depcruise sees imports, not calls, so fs is allowlisted by file. These read only. ' +
        'A new fs import in the request path needs review: add it here with a reason.',
      severity: 'error',
      from: {
        path: REQUEST_PATH,
        pathNot: [
          TESTS,
          // reads runtime files and the Astro project to render pages
          `${SRC}render/runtime\\.ts$`,
          // reads plugin config files
          `${SRC}overlay/plugins\\.ts$`,
          // reads media files to serve them
          `${SRC}media-route\\.ts$`,
        ],
      },
      to: { path: ['^node:fs(/promises)?$', '^fs(/promises)?$'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Runtime import cycles. Type-only imports are ignored.',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-test-in-production',
      comment: 'Production code must not import tests, helpers or fixtures.',
      severity: 'error',
      from: { path: '^(preview-render-server|preview-protocol)/', pathNot: [TESTS, '^preview-render-server/(test|test-editor)/'] },
      to: { path: TESTS },
    },
    {
      name: 'no-orphans',
      comment: 'Reports only; Knip gates dead code. Entries loaded by URL or injectRoute look orphaned.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(c|m)?js$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          `${SRC}(render|validate|media|warmup)-route\\.ts$`,
          `${SRC}dev/(documents|memory)-route\\.ts$`,
          `${SRC}client/bridge\\.ts$`,
          `${SRC}overlay/(content-shim|image-service|data-proxy)\\.ts$`,
          `${SRC}start\\.ts$`,
          '^preview-render-server/sites/[^/]+\\.config\\.ts$',
          'vitest[^/]*\\.config\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      comment: 'virtual: and astro: specifiers are not packages.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true, pathNot: ['^virtual:', '^astro:'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: ['(^|/)node_modules/', '^sample-site/', '^sampleAstroProject/', '^reports/', 'test/fixtures'],
    },
    parser: 'swc',
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    moduleSystems: ['es6', 'cjs'],
  },
};
