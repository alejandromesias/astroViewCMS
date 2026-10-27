# Preview render server

Builds an Astro site once, then re-renders its components in memory with
draft content: no Vite, no compiler, no `astro dev`. A bridge script in the
previewed page swaps the new HTML in as the editor types. The pattern is
Tina's island route and bridge, without Tina. Full write-up, with diagrams
and measurements:
[DOCS/PREVIEW-RENDER-SERVER.md](../DOCS/PREVIEW-RENDER-SERVER.md).

```text
editor ──postMessage draft──▶ bridge (in the iframe) ──POST /__preview/blocks──▶ node process
       ◀──── rendered ───────  swaps the HTML       ◀──── HTML fragment ──────  Container API render
```

## How it works

- `sites/<site>.config.ts`: where the site lives, its regions (component),
  and `buildTimeFields` (fields that build code reads).
- `src/build.ts`: runs Astro's `build()` on the site, adding the Node adapter
  and `src/integration.ts`. Output goes to `.build/<site>/`, so the site's
  files and its normal static build are untouched.
- `src/integration.ts`, which adds:
  - the routes;
  - the `<div data-preview-region>` wrappers, by redirecting imports (no site
    change);
  - the bridge script;
  - a virtual module with the region components, every image under `src/`,
    the manifest folder and the site's CMS schemas;
  - the build manifests in `.build/<site>-manifest/`: `schema.json`,
    `routes.json`, `documents.json`.
- `src/manifest/`: the pure parts of the manifests: the static import scan
  (which JSON files build code reads), `documents.json` and `routes.json`
  shaping.
- `src/schema/`: the CMS schema pass. The site's `content.config.ts` is
  compiled with stubs for `astro:content`, `astro/loaders`, `image()` and
  `reference()`: flavor 1 makes `schema.json`, flavor 2 goes into the bundle.
- `src/render-route.ts` and `src/validate-route.ts`: `POST /__preview/render?path=`
  renders a page with a content overlay, `POST /__preview/validate` checks the
  overlay against the schemas. The logic is in `src/render/` (route matching,
  getStaticPaths and `paginate`, document discovery, handlers).
- `src/media-route.ts`: draft image upload (`POST /__preview-media/new`) and
  serving.
- `src/warmup-route.ts`: `POST /__preview/warm` loads the Markdown renderer and
  the code languages ahead of the first draft render.
- `src/client/bridge.ts`: `startBridge()`, which runs in the previewed page
  and speaks `postMessage` with any editor. `patch.ts` applies a render to the live page
  (idiomorph). The integration adds the bridge to every page with an inline
  script that passes the site's `editorOrigins`.
- `src/protocol.ts`: the `postMessage` message types and runtime checks,
  shared by the bridge and the editor. Task 1.6a moves it to the
  `preview-protocol/` workspace package and adds a protocol version (D14).
- `src/types.ts` and `src/virtual.d.ts`: site config types and the generated
  virtual module's types.
- `test-editor/`: a test editor at `/__editor`, with a JSON textbox per region
  next to the site in an iframe (`editor.astro` markup, `editor.ts` logic).
- `src/start.ts`: runs `.build/<site>/server/entry.mjs`.
- `test/`: test fixtures and helpers for the unit tests, and the end-to-end
  suite (`test/e2e/`). Unit tests sit next to each source file.

The full annotated tree, with where each file runs, is in
[the docs](../DOCS/PREVIEW-RENDER-SERVER.md#the-pieces).

Rebuild when code changes (markup, CSS, schemas, new block types). Content
changes never need a rebuild. Drafts live only in the editor tab; nothing is
written to the site yet.

## Run

`astroViewCMS/` is an npm workspace: the site and this server share one copy
of `astro`. Run `npm install` there first.

```sh
npm run build      # preview build of sampleAstroProject
npm start          # http://localhost:4400, editor at /__editor
npm run typecheck  # tsc, no emit
npm test           # unit tests (Vitest); npm run test:watch while developing
npm run coverage   # unit tests + coverage report in coverage/
npm run test:e2e   # builds into .build/e2e-*, starts the server on a free port, checks it over HTTP
```

Each source file has a `*.test.ts` next to it. The tests render real `.astro`
fixtures (`test/fixtures/`) through Astro's own Vite config. Browser code
(bridge, editor) runs in happy-dom.

TypeScript runs without a build step: Node 26 runs the `.ts` scripts directly
(type stripping, so no `enum`s or `namespace`s), and Vite compiles the files
that end up in the build.

From an AI agent, run the build with the Astro agent-detection variables
unset (see the environment notes in ../DOCS/WORKPLAN.md).

## Known limits

- Drafts aren't saved or persisted; uploads pile up in `.build/<site>-media/`.
- Component `<script>`s aren't re-sent with fragments. The page ran them once
  on load, so they don't run on swapped-in HTML.
- `experimental_AstroContainer` can change in any Astro release.
