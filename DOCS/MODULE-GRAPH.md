# Module graph of `preview-render-server` and `preview-protocol`

Quality plan step 4. Snapshot first taken 2026-10-28 with Skott; re-run
2026-10-31 with dependency-cruiser, which is now the only graph tool (Skott was
removed in task 1.8b). The checks below are rules in `.dependency-cruiser.cjs`
(step 9), run by `npm run depcruise`. Type-only imports count as edges
(`tsPreCompilationDeps`), so a cycle made of types alone fails the rule.

## Result

Run 2026-10-31 over `preview-render-server/src` and `preview-protocol/src`.

| Run | Files | Edges | Cycles |
|---|---|---|---|
| Production, type-only imports followed | 47 | 75 | none |
| Production, type-only imports ignored | 47 | 54 | none |
| Production + tests in `src`, types followed | 83 | 128 | none |
| Production + tests in `src`, types ignored | 83 | 100 | none |

- **No cycles**, with or without `import type`. A deliberate two-file
  type-only cycle was reported as an error by `no-circular`, then removed.
- 21 of the 75 production edges are type-only (`import type`).
- The scope differs from 2026-10-28 (53 and 93 files, 76 and 132 edges), which
  Skott read from a wider tsconfig including `sites/`, `test/` and the test
  editor. The tests-included run now covers only the test files inside `src`.
- **`client/` is clean.** `client/bridge.ts` imports only `client/patch.ts` and
  the package `preview-protocol`; `client/patch.ts` imports nothing local.
  Rule `client-stays-browser-safe` gates this.
- **No production file imports a test file** (rule `no-test-in-production`).

## How to re-run

From `astroViewCMS/`:

```sh
npm run graph                                                # diagrams and edge list in reports/graph/
npm run -s deps -- --focus "render/handlers"                 # one file's imports and importers
npm run -s deps -- --reaches "preview-protocol/src/index.ts" # everything that depends on it
npm run depcruise                                            # the rules, including cycles
```

The listing below was generated on 2026-10-31 from `npm run deps`.

## Production graph (type-only imports followed)

`->` lists what a file imports. Paths are relative to
`preview-render-server/src/`; `preview-protocol` is `preview-protocol/src/index.ts`.
Generated 2026-10-31.

```
build.ts -> integration.ts, site-config.ts
integration.ts -> manifest/documents.ts, manifest/import-scan.ts,
                  manifest/languages.ts, manifest/routes.ts,
                  overlay/image-service.ts, overlay/plugins.ts,
                  schema/config-bundle.ts, schema/json-schema.ts, types.ts
languages.ts -> (nothing local)
media-route.ts -> request-guard.ts
render-route.ts -> render/handlers.ts, render/runtime.ts, request-guard.ts
request-guard.ts -> (nothing local)
site-config.ts -> types.ts
start.ts -> site-config.ts
types.ts -> (nothing local)
validate-route.ts -> render/handlers.ts, render/runtime.ts, request-guard.ts
warmup-route.ts -> overlay/markdown-instance.ts, request-guard.ts

dev/documents-route.ts -> dev/documents.ts, render/runtime.ts
dev/documents.ts -> manifest/types.ts, request-guard.ts
dev/memory-route.ts -> (nothing local)

render/discover.ts -> manifest/types.ts
render/envelope.ts -> overlay/context.ts
render/handlers.ts -> manifest/types.ts, overlay/content-api.ts,
                      overlay/context.ts, overlay/errors.ts, preview-protocol,
                      render/discover.ts, render/envelope.ts, render/head.ts,
                      render/render-page.ts, request-guard.ts
render/head.ts -> (nothing local)
render/islands.ts -> (nothing local)
render/match-route.ts -> manifest/types.ts
render/paginate.ts -> manifest/types.ts, render/match-route.ts
render/render-page.ts -> manifest/types.ts, render/match-route.ts,
                         render/paginate.ts
render/runtime.ts -> manifest/types.ts, overlay/content-shim.ts,
                     render/handlers.ts, render/islands.ts,
                     render/render-page.ts

overlay/content-api.ts -> overlay/context.ts, overlay/dates.ts,
                          overlay/errors.ts, overlay/keys.ts, overlay/media.ts,
                          schema/stubs-flavor2.ts
overlay/content-shim.ts -> overlay/content-api.ts, overlay/markdown-instance.ts,
                           schema/stubs-flavor2.ts
overlay/context.ts -> (nothing local)
overlay/data-proxy.ts -> overlay/context.ts
overlay/dates.ts -> (nothing local)
overlay/errors.ts -> (nothing local)
overlay/image-service.ts -> overlay/media.ts
overlay/keys.ts -> (nothing local)
overlay/markdown-instance.ts -> manifest/languages.ts, overlay/markdown.ts
overlay/markdown.ts -> languages.ts, overlay/context.ts
overlay/media.ts -> overlay/context.ts
overlay/plugins.ts -> overlay/keys.ts

manifest/documents.ts -> manifest/import-scan.ts, manifest/types.ts
manifest/import-scan.ts -> (nothing local)
manifest/languages.ts -> languages.ts, manifest/documents.ts
manifest/routes.ts -> manifest/types.ts
manifest/types.ts -> (nothing local)

schema/config-bundle.ts -> schema/stubs-flavor1.ts
schema/json-schema.ts -> schema/stubs-flavor1.ts
schema/stubs-flavor1.ts -> (nothing local)
schema/stubs-flavor2.ts -> (nothing local)

client/bridge.ts -> client/patch.ts, preview-protocol
client/patch.ts -> (nothing local)
```

`sites/*.config.ts` (in `preview-render-server/sites/`) import `types.ts` but sit
outside the crawled folders. `preview-protocol/src/index.ts` has no local imports.

## Shape worth knowing

- Entry layers: `build.ts`/`start.ts` (CLI), `integration.ts` (Astro
  integration), and the five route files. Everything else is reached from them.
- `render/` depends on `overlay/` and `manifest/types.ts`; `overlay/` never
  imports `render/`. `manifest/` never imports `overlay/` or `render/`. These
  one-way directions were not made step 9 rules; only the rules in `.dependency-cruiser.cjs` are gated.
- `overlay/markdown-instance.ts -> manifest/languages.ts` is the only
  `overlay -> manifest` edge, so the "overlay never imports manifest" direction
  has one exception, and no step 9 rule covers this direction.
- `render/handlers.ts` (10 imports, one of them `preview-protocol`) and
  `integration.ts` (9) are the busiest files, then `overlay/content-api.ts` (6).
- `dev/documents-route.ts -> render/runtime.ts` and `overlay/* -> schema/stubs-flavor2.ts`
  are the other edges that cross folders without going through `manifest/types.ts`.

## Known blind spots (written down, not fixed)

- **Files with no importer** in the production graph: `build.ts`, `start.ts`,
  `sites/*.config.ts`, `client/bridge.ts`, `render-route.ts`,
  `validate-route.ts`, `media-route.ts`, `warmup-route.ts`,
  `dev/documents-route.ts`, `overlay/data-proxy.ts`, plus tooling
  (`test-editor/editor.ts`, `test/helpers.ts`, `test/e2e/global-setup.ts`,
  `vitest*.config.ts`). None is dead:
  - the route files are wired by URL strings in `injectRoute`
    (`src/integration.ts`), not imports;
  - `overlay/data-proxy.ts` is loaded through
    `new URL('./overlay/data-proxy.ts', import.meta.url)` (`integration.ts:153`)
    and injected into a rewritten import by `overlay/plugins.ts`;
  - `client/bridge.ts` is served to the browser, not imported by server code;
  - `test-editor/editor.ts` is imported by `test-editor/editor.astro`, which
    the graph leaves out (see below);
  - the rest are CLI or config entry points.
  Knip (step 6) needs these as entry points.
- `virtual:preview-site` and `virtual:astro:*` are not resolved, so they add no
  edges.
- **`.astro` files are not in the graph** (only `.ts` is read). Two are
  `injectRoute` entry points: `render/renderers-anchor.astro` and
  `test-editor/editor.astro` (which imports `test-editor/editor.ts`).
- **The edge between the two packages appears.** `preview-protocol` is imported
  by package name from `client/bridge.ts` and, for types only (`Limit`,
  `RenderResponse`, `ValidationResponse`), from `render/handlers.ts`. The
  dependency-cruiser graph resolves both to `preview-protocol/src/index.ts`. The
  step 9 rule on that boundary (`protocol-is-a-leaf`) matches the package name.
