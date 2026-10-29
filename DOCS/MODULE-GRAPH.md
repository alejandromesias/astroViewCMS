# Module graph of `preview-render-server` and `preview-protocol`

Quality plan step 4. Generated 2026-10-28 with Skott 0.35.12 from the
`astroViewCMS` root. The hand checks below are now rules in
`.dependency-cruiser.cjs` (step 9), run by `npm run depcruise`.

## Result

| Run | Files | Edges | Cycles |
|---|---|---|---|
| Production, type-only imports followed | 53 | 76 | none |
| Production, type-only imports ignored | 53 | 53 | none |
| Production + tests + fixtures, types followed | 93 | 132 | none |
| Production + tests + fixtures, types ignored | 93 | 101 | none |

- **No cycles**, with or without `import type`. Both lists are empty.
- 23 of the 76 production edges are type-only (`import type`).
- **No production file imports a fixture.** The tests-included run has 4 fixture
  files and none is reached from a non-test file (the `no-test-in-production` rule in step 9 now gates this).
- **`client/` is clean.** With builtin and third-party tracking on,
  `client/bridge.ts` imports only `client/patch.ts` (plus the package
  `preview-protocol`), and `client/patch.ts` imports nothing local (plus the
  package `idiomorph`). Neither reaches a `node:*` builtin or a server module.

## How to re-run

The CLI's `raw` and `file-tree` modes print only the file list and the cycle
verdict, not the edges. The cycle check works from the CLI:

```sh
# from astroViewCMS/; add --no-trackTypeOnlyDependencies for the second list
npx skott@0.35.12 --fileExtensions=.ts --displayMode=file-tree \
  --showCircularDependencies --exitCodeOnCircularDependencies=0 \
  -ts preview-render-server/tsconfig.json \
  -ig 'sample-site/**' -ig 'sampleAstroProject/**' -ig 'reports/**' \
  -ig '**/node_modules/**' -ig 'DOCS/**' -ig '**/*.test.ts' -ig '**/test/fixtures/**'
```

The edges below came from Skott's API (`skott@0.35.12`, installed in a scratch
folder outside the repo) with the same ignore list, `fileExtensions: ['.ts']`,
`dependencyTracking: { typeOnly, builtin, thirdParty }`, and
`useGraph().findCircularDependencies()`. Incremental mode is off by default in
this version, so there is no `.skott/` cache and nothing to ignore in git.

## Production graph (type-only imports followed)

`->` lists what a file imports. Paths are relative to
`preview-render-server/src/` unless marked.

```
build.ts           -> integration.ts, site-config.ts
start.ts           -> site-config.ts
site-config.ts     -> types.ts
integration.ts     -> manifest/{documents,import-scan,languages,routes}.ts,
                      overlay/{image-service,plugins}.ts,
                      schema/{config-bundle,json-schema}.ts, types.ts

render-route.ts    -> render/{handlers,runtime}.ts, request-guard.ts
validate-route.ts  -> render/{handlers,runtime}.ts, request-guard.ts
media-route.ts     -> request-guard.ts
warmup-route.ts    -> overlay/markdown-instance.ts, request-guard.ts
dev/documents-route.ts -> render/runtime.ts, dev/documents.ts
dev/documents.ts   -> manifest/types.ts, request-guard.ts

render/runtime.ts  -> manifest/types.ts, overlay/content-shim.ts,
                      render/{handlers,islands,render-page}.ts
render/handlers.ts -> manifest/types.ts, overlay/{content-api,context,errors}.ts,
                      render/{discover,envelope,head,render-page}.ts, request-guard.ts
render/render-page.ts -> manifest/types.ts, render/{match-route,paginate}.ts
render/paginate.ts -> manifest/types.ts, render/match-route.ts
render/envelope.ts -> overlay/context.ts
render/{discover,match-route}.ts -> manifest/types.ts
render/{head,islands}.ts -> (nothing)

overlay/content-shim.ts -> schema/stubs-flavor2.ts, overlay/{content-api,markdown-instance}.ts
overlay/content-api.ts  -> schema/stubs-flavor2.ts,
                           overlay/{context,dates,errors,keys,media}.ts
overlay/markdown-instance.ts -> manifest/languages.ts, overlay/markdown.ts
overlay/markdown.ts     -> languages.ts, overlay/context.ts
overlay/{data-proxy,media}.ts -> overlay/context.ts
overlay/image-service.ts -> overlay/media.ts
overlay/plugins.ts      -> overlay/keys.ts
overlay/{context,dates,errors,keys}.ts -> (nothing)

manifest/documents.ts -> manifest/{import-scan,types}.ts
manifest/languages.ts -> languages.ts, manifest/documents.ts
manifest/routes.ts    -> manifest/types.ts
manifest/{import-scan,types}.ts, languages.ts -> (nothing)

schema/config-bundle.ts, schema/json-schema.ts -> schema/stubs-flavor1.ts
schema/stubs-flavor{1,2}.ts -> (nothing)

client/bridge.ts -> client/patch.ts
client/patch.ts  -> (nothing local)

sites/*.config.ts (both) -> types.ts   (preview-render-server/sites/)
```

`preview-protocol/src/index.ts` is a single file with no local imports.

## Shape worth knowing

- Entry layers: `build.ts`/`start.ts` (CLI), `integration.ts` (Astro
  integration), and the five route files. Everything else is reached from them.
- `render/` depends on `overlay/` and `manifest/types.ts`; `overlay/` never
  imports `render/`. `manifest/` never imports `overlay/` or `render/`. These
  one-way directions were not made step 9 rules; only the rules in `.dependency-cruiser.cjs` are gated.
- `overlay/markdown-instance.ts -> manifest/languages.ts` is the only
  `overlay -> manifest` edge, so the "overlay never imports manifest" direction
  has one exception, and no step 9 rule covers this direction.
- `render/handlers.ts` and `integration.ts` are the busiest files (9 local
  imports each).

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
- **`.astro` files are not in the graph** (`--fileExtensions=.ts`). Two are
  `injectRoute` entry points: `render/renderers-anchor.astro` and
  `test-editor/editor.astro` (which imports `test-editor/editor.ts`).
- **The edge between the two packages does not appear as a graph edge.**
  `preview-protocol` is imported by package name from `client/bridge.ts` and
  `render/handlers.ts` (types only: `Limit`, `RenderResponse`,
  `ValidationResponse`). Skott records it only as a third-party dependency of
  `client/bridge.ts` (visible with third-party tracking on); the type-only import
  in `handlers.ts` does not appear, so check this boundary by hand.
  `preview-protocol/src/index.ts` shows no importers in any run. The step 9 rule
  on that boundary has to match the package name.
