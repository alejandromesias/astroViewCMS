# How the preview render server works (system view)

Covers `preview-render-server/` and `preview-protocol/` as of the end of phase 1
(2026-10-31). It describes the page-render model: the whole page is rendered
in memory with a content overlay, and the bridge patches the result into the
live page. The decisions behind it are in [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md)
(sections 3 and 11, D1 to D16); the tasks that built it are in
[WORKPLAN-PHASE-0-1.md](WORKPLAN-PHASE-0-1.md). The first version, which rendered one component per
island, is gone; its build, bundling, image and performance findings are kept
below and marked where they were measured on the old sample.

Numbers come from the development machine (Windows 11, Node 26, Astro 7,
16 GB RAM), on `sample-site` (the bigspring template plus additions) unless a
row says otherwise. The measurement table is in WORKPLAN-PHASE-0-1.md section 10.

## In one sentence

Build the site once, keeping its pages and components as compiled code, then
run a plain Node process that re-renders a whole page in memory with draft
documents laid over the saved content. A small script inside the previewed page
sends the editor's drafts to it and patches the new HTML into the page: no
Vite, no compiler, no file watcher and no reload.

## Why not `astro dev`

`astro dev` already renders drafts, because it re-renders on every file change.
But it carries the whole toolchain for every editor: Vite, the Astro compiler,
Tailwind, the file watcher, HMR and the dependency optimizer. Most of that only
matters when **code** changes. For content edits, the compiled pages are enough.

So we split the two jobs:

- **Build** (rarely: when code changes): full toolchain, ~10 s warm on
  `sample-site`.
- **Render** (on every edit): compiled code only, a few milliseconds for a
  typical page (table in "Performance").

The pattern is Tina's live preview (a server-rendered route that calls Astro's
Container API, plus a bridge script that swaps the result into the page),
without Tina Cloud: the editor sends the draft, nothing is fetched. AstroAdmin,
the other local editor we studied, saves the file, waits for `astro dev` to
notice, polls until the page's HTML changes (up to 2.5 s) and reloads the
iframe. We skip all of that.

## Vocabulary

- **Document:** one content entry (`pages/home`, `blog/blog-1`) or a JSON data
  file that components import (`data:src/config/menu.json`). The unit of
  editing, drafting and validation (D1).
- **Overlay:** the drafts of some documents, sent with each render request. The
  page reads them instead of the saved ones.
- **Region:** an optional `data-preview-region` wrapper around a component. A
  patch hint only: it says where HTML can be swapped, and carries no data (D1).
- **Bundle:** the preview build, in `.build/<site>/`.
- **Manifests:** `schema.json`, `routes.json` and `documents.json`, written next
  to the bundle at build time.

## The two phases

```text
 BUILD (npm run build:sample): once per code change, ~10 s warm
 ─────────────────────────────────────────────────────────────────────────
  sample-site/                          preview-render-server/
  ├─ astro.config.mjs ─────┐            ├─ sites/sample-site.config.ts
  ├─ src/content.config.ts │            │    (where the site is, regions,
  ├─ src/pages, layouts,   │            │     buildTimeFields, port,
  │  components            │            │     editorOrigins)
  ├─ src/content/**        │            └─ src/build.ts
  └─ src/**/*.png          │                      │
                           ▼                      │
              ┌────────────────────────────────────────────────────┐
              │ astro build()                                      │
              │   site's own config                                │
              │ + @astrojs/node adapter (standalone)               │
              │ + preview integration (src/integration.ts):        │
              │     · routes /__preview/render, /__preview/validate│
              │       /__preview/warm, /__preview-media/[file],    │
              │       /__editor                                    │
              │     · rewrites `astro:content` imports to the      │
              │       overlay shim (site source untouched)         │
              │     · wraps region components in                   │
              │       <div data-preview-region>                    │
              │     · adds the bridge script to every page         │
              │     · virtual module: pages, every image under     │
              │       src/, the CMS schemas, the site's config     │
              │     · scans the site for data files that build     │
              │       code reads (D1)                              │
              │     · writes the manifests                         │
              └────────────────────────────────────────────────────┘
                                   │ writes (site's dist/ untouched)
                                   ▼
              preview-render-server/.build/
              ├─ sample-site/            client/ + server/entry.mjs
              │    ├─ manifest/          schema.json, routes.json, documents.json
              │    └─ media/             uploaded draft images (stopgap)
              ├─ sample-site-regions/    generated wrappers
              └─ e2e-*, browser-*/       temporary, during the test suites


 RUN (npm run start:sample): long-lived
 ─────────────────────────────────────────────────────────────────────────
              ┌─────────────────────────────────────────────────────┐
  browser ──▶ │ node .build/<site>/server/entry.mjs         :4401   │
              │   GET  /                    prerendered pages       │
              │   GET  /_astro/*            CSS, JS, images         │
              │   GET  /_image?…            resize on demand        │
              │   POST /__preview/render?path=   render with overlay│
              │   POST /__preview/validate       check the overlay  │
              │   POST /__preview/warm           load Markdown + Shiki
              │   POST /__preview-media/new      upload draft image │
              │   GET  /__preview-media/<f>      serve draft image  │
              │   GET  /__editor                 test editor        │
              │   GET  /__dev/documents?key=     (--dev builds only)│
              └─────────────────────────────────────────────────────┘
              no Vite · no compiler · no watcher
```

The preview node never writes to the site and keeps no drafts (D4). Only the
media upload route writes (to `.build/<site>/media/`), a stopgap until the CMS
app stages media in phase 2.

## The live preview loop

```text
 EDITOR (/__editor, or any editor)   PAGE IN IFRAME             PREVIEW NODE
 parent window                       site HTML + bridge
 ────────────────────────────        ───────────────────        ──────────────────
 sets iframe.src = path ───────────▶ page loads, bridge starts
                                     (only inside an iframe)
            ◀── preview:ready { path, protocol }
 sends preview:draft ──────────────▶ POST /__preview/render?path= ──▶ match route,
 { documents, media }                 body = { documents, media }      run the page
 (even an empty one: primes the       ◀───────── { html, head,         with the overlay
  page, which may be older than        documents, limits, renderMs }
  the saved content)                  patch regions, head, body
            ◀── preview:rendered { path, documents, limits, renderMs }
 the editor learns which documents
 this page reads, and shows their forms

 (on error: preview:error { path, status, message, errors? })
```

- **Message checks in both directions.** The bridge accepts messages only from
  `window.parent` and only from the page's own origin or the configured
  `editorOrigins` (never `'*'`). The editor accepts them only from the iframe.
  Both send with an explicit target origin. Each side ignores any message that
  fails its runtime check.
- **The bridge does the fetch, not the editor.** It runs on the preview's
  origin, so no CORS is needed. Any editor can drive it with `postMessage`
  alone.
- **Newest edit wins.** Each draft gets a request id. A slow answer to an older
  draft is dropped, so the page never steps back.
- **A reload or navigation announces itself.** After the iframe reloads, or a
  `ClientRouter` navigation, the bridge sends `preview:ready` with the new path
  and the editor answers with the drafts it holds.
- **Protocol version.** `preview:ready` and `preview:draft` carry
  `PROTOCOL_VERSION` (2). On a mismatch the bridge reports an error instead of
  guessing (D14).
- **Editor origins are runtime config.** The integration passes the site's
  `editorOrigins` to an inline script that starts the bridge. In the product
  they are node config, not part of the site build.

### The patch step (`src/client/patch.ts`)

```text
 response html ──▶ parse (DOMParser)
   for each [data-preview-region] in the new page:
     same innerHTML as the live one?   yes → leave it
                                       no  → morph it into the live region
   head: set document.title, update changed <meta>
   outside regions: hash <body> with regions blanked out;
     changed → morph the whole <body>
   finish entrance animations
```

- **Morph, not `innerHTML`.** idiomorph keeps unchanged nodes, which gives
  block-level stability without block regions: focus, scroll and hydrated
  widgets survive where the markup is unchanged.
- **Hydrated components and inline scripts** follow the rules in D6. Component
  scripts do not run again on swapped HTML (see "Known limits").

### Message protocol

Defined once in the `preview-protocol/` workspace package (D14), as TypeScript
types plus runtime checks (`isDraftMessage`, `isPageMessage`). The bridge, the
editor and the render route's answers all use it.

| Direction | Message |
|---|---|
| page → editor | `{ type: 'preview:ready', path, protocol }` |
| editor → page | `{ type: 'preview:draft', protocol, documents, media }` |
| page → editor | `{ type: 'preview:rendered', path, documents, limits, renderMs }` |
| page → editor | `{ type: 'preview:error', path, status, message, errors? }` |

`documents` maps a document key to its raw value (`null` means deleted in the
draft). `media` holds the metadata of images that aren't in the bundle (D12).
`limits` lists what a render could not show: `mdx-body`, `schema-refinement`,
`markdown-plugins`, `code-language:<name>`.

## Where the draft lives

```text
  EDITOR TAB (browser memory)     PREVIEW NODE (stateless for content)   SITE FILES
  ───────────────────────────     ────────────────────────────────────   ──────────
  the overlay (all drafts) ─────▶ renders the page with it, keeps nothing  (never
  lost on tab close/reload        .build/<site>/media/                      written)
                                  └─ uploaded images (kept, stopgap)
```

- **Drafts exist only in the editor tab.** The node renders what it is sent and
  forgets it, so another tab shows the saved site.
- **Saved content comes from elsewhere.** The node has no route that returns
  saved content. In phase 2 the CMS app serves and saves documents; the test
  editor reads them from `GET /__dev/documents?key=`, a stopgap that exists
  only in a build made with `PREVIEW_DEV=1` (`npm run build:sample` sets it).
- **Content saved since the last build** travels in the overlay too, so the
  editor sends every document that differs from the bundle.

A stateless node is simpler, scales by running more copies, and has nothing to
lose or clean up. Saving, publishing and drafts across reloads belong to the
CMS app and the editor (SYSTEM-DESIGN.md section 4).

## One preview render (inside the server)

```text
 POST /__preview/render?path=/blog/blog-1
 content-type: json         1. request guard
 { documents, media }          · application/json only          else 404
                               · Sec-Fetch-Site ≠ cross-site    else 403
                               · body under the size cap        else 413 (D16)
                            2. parse the envelope               else 400
                            3. match `path` against routes.json
                               (static, dynamic, rest routes)   else 404
                            4. open the overlay (AsyncLocalStorage, per request)
                               · parse each draft with the CMS schema
                                 (defaults, coercion, references)   else 422
                               · resolve images (bundle or media map)
                            5. dynamic route: run getStaticPaths with the
                               overlay, pick the entry whose params match
                               (listing routes: paginate over whole collections)
                            6. container.renderToString(page, { params, props })
                               the shim records every document the page reads
                            7. strip dev-only <script> references, collect
                               head data
 { html, head, documents,   ◀───
   limits, renderMs }          headers: Server-Timing: render;dur=…
                                        Cache-Control: no-store
```

### The content overlay

In the preview build only, a Vite plugin rewrites the site's
`import … from "astro:content"` (in every module under `src/` that Vite
compiles, except `content.config.*`) to a shim. The shim re-exports everything
and wraps the read functions:

- `getEntry` and `getEntries`: the draft for a key if the overlay has one, the
  built entry otherwise;
- `getCollection`: built entries with overlay entries replaced, added or
  removed, then the caller's filter;
- `render(entry)`: renders a Markdown body at run time with the site's remark
  and rehype plugins and Shiki limited to the languages the site uses (D2).

Data files that components import directly (`src/config/*.json`) are overlaid
the same way, under `data:<path>` keys (D10). Because the overlay lives in
`AsyncLocalStorage`, concurrent renders never see each other's drafts. The read
log is how the editor learns which documents a page uses.

A draft is the file's raw JSON, so the shim does what Astro's loader would have
done: it parses the draft with the **CMS schema** (a copy of the collection's
Zod schema with stubbed `image()` and `reference()`, built once at build time,
D3), then turns images into `ImageMetadata` and references into
`{ collection, id }`. `POST /__preview/validate` runs only that parse and is
what the CMS app will call before saving.

### Request contract

- **`POST /__preview/render?path=<url path>`**, body `{ documents, media }`.
  - `200`: `{ html, head, documents, limits, renderMs }`;
  - `400`: the body isn't the envelope (the message names the part);
  - `403`: a cross-site request;
  - `404`: not a JSON request, or no route matches `path`;
  - `413`: the body is over the cap (4 MiB, D16), checked before parsing;
  - `422`: the overlay doesn't fit a schema (field paths in `errors`);
  - `500`: a render error, with the message for the editor.
- **`POST /__preview/validate`**: the same body, no render. `200` or `422`.
- **`POST /__preview/warm`**: loads the Markdown pipeline and the code
  languages ahead of the first draft render (about 700 ms, +100 MB).
- **`POST /__preview-media/new`**: the image bytes, `Content-Type`
  `image/png|jpeg|webp|avif|gif`, up to 10 MB. `201` with
  `{ url, width, height, format }` (the editor puts it in `media`); `415` for
  other types (no SVG, it can carry scripts) or bytes that aren't a readable
  image; `413` if empty or too big.
- **`GET /__preview-media/<file>`**: only names that match `<16 hex>.<ext>`.
- **Any other method** gets `405`. There are no routes that write the site or
  return saved content.
- **Why cross-site requests can't get in:** another origin can't send a JSON or
  image body without a CORS preflight, and these routes never answer one. The
  `Sec-Fetch-Site` check refuses the rest.
- **Preview builds only:** the site's normal `npm run build` is plain static,
  with no routes, no wrappers, no shim and no bridge.

## The pieces

Each source file has its unit test next to it (`*.test.ts`, not shown).

```text
preview-render-server/
├─ sites/                  one config per site: folder, regions, buildTimeFields,
│                          readOnlyCollections, editorOrigins, port
├─ src/
│  ├─ build.ts             astro build() + Node adapter + integration     (npm run build)
│  ├─ start.ts             imports the built entry.mjs                    (npm start)
│  ├─ site-config.ts       loads a site config, resolves .build/ paths
│  ├─ integration.ts       routes, shim, wrappers, bridge, virtual module, manifests
│  ├─ types.ts, virtual.d.ts
│  ├─ render-route.ts      POST /__preview/render
│  ├─ validate-route.ts    POST /__preview/validate
│  ├─ warmup-route.ts      POST /__preview/warm
│  ├─ media-route.ts       draft image upload and serving (stopgap)
│  ├─ request-guard.ts     content-type, cross-site and method checks
│  ├─ languages.ts         the code languages Shiki loads
│  ├─ render/              route matching, getStaticPaths and paginate,
│  │                       document discovery, handlers, envelope parsing, head data
│  ├─ overlay/             the astro:content shim: context (AsyncLocalStorage),
│  │                       content API, data proxy, Markdown, media, image service,
│  │                       the Vite plugins that rewrite imports
│  ├─ manifest/            pure parts of the manifests: import scan, routes.json,
│  │                       documents.json, languages
│  ├─ schema/              the CMS schema pass: the site's content config compiled
│  │                       with stubs (flavor 1 → schema.json, flavor 2 → bundle)
│  ├─ dev/                 --dev builds only: /__dev/documents, /__dev/memory
│  └─ client/              bridge.ts and patch.ts, which run in the previewed page
├─ test-editor/            /__editor: a form per document the page reads next to
│                          the site in an iframe. A dev tool, not the product editor
├─ test/                   fixtures, helpers, e2e/ (HTTP, budgets) and browser/
│                          (Vitest browser mode, the real iframe and protocol)
└─ .build/                 gitignored: bundle, manifests, uploads, test builds
preview-protocol/          message types, runtime checks, PROTOCOL_VERSION
scripts/                   check.ts (all quality gates), graph.ts, measure-*.mjs
```

`build.ts` and `start.ts` are thin glue with top-level side effects, so they
are tested end to end rather than unit-tested. The module graph is in
[MODULE-GRAPH.md](MODULE-GRAPH.md).

### TypeScript without a build step

- **Node 26 runs** `build.ts`, `start.ts`, `site-config.ts` and
  `integration.ts` **directly**, by stripping the types.
- **Vite compiles** the routes, the shim, the bridge and the editor as part of
  `astro build`.
- `tsconfig.json` is only for checking (`npm run typecheck`, `noEmit`). It sets
  `erasableSyntaxOnly`, so no `enum`s or `namespace`s, and imports use `.ts`
  extensions.

### How regions are added without touching the site

Regions are optional; a page with none still previews (the bridge falls back
to morphing the body). When a site config lists one, the integration writes a
wrapper per region to `.build/<site>-regions/<name>.astro`:

```astro
---
import Region from "<site>/src/components/BlockList.astro";
---
<div style="display: contents" data-preview-region="blocks"><Region {...Astro.props} /></div>
```

A Vite plugin redirects the pages' imports of the component to the wrapper
(the wrapper's own import stays bare). `display: contents` keeps the wrapper
out of the layout, so the page renders as before. `sample-site` currently
lists no regions: the morph handles everything it needs.

## Images

- **Images in the bundle.** The integration imports every image under `src/`.
  A draft's `"../assets/x.png"` is resolved against the folder of the file that
  holds the document (D5), looked up in that list and turned into
  `ImageMetadata`; `<Image>` then outputs `/_image?href=…` and the server
  resizes with `sharp`.
- **Images that aren't in the bundle** (uploads, and images saved since the
  build): the editor sends their `{ url, width, height, format }` in
  `media` (D12), and the render uses the URL as is, not resized.
- **Unknown paths:** a path in neither place fails the render with
  "image not found" (500), and the editor shows it.

## Scripts and hydration after a swap

The Container API doesn't know about the build's bundled scripts, so for
components with a `<script>` it writes a dev-server reference
(`…/Hero.astro?astro&type=script…`) that would 404 and leak a local path. The
render strips these tags. The page already ran the real bundled scripts once.

**Limit:** component scripts don't run again on swapped HTML, and a component
that hydrates (Swiper, the FAQ accordion) keeps what it did on load. Morph keeps
unchanged nodes, so this only shows where the markup changed. D6 lists the
rules and the cases covered by browser tests.

## What needs a rebuild

| Change | Rebuild? |
|---|---|
| Text, order, adding or removing entries of existing collections | no (overlay) |
| Pointing to another image that's in `src/` | no |
| A new upload or an image saved since the build | no (media map) |
| Content saved since the build | no (overlay) |
| Data read by build code (`theme.json`, the `site` fields of `config.json`) | **yes** (D1, `buildTimeFields`) |
| Markup, CSS and Tailwind classes, new components or pages, schema changes | **yes** (~10 s warm) |

Tailwind classes only exist in the CSS if they appear in source files at build
time. A class built at runtime from content won't be styled. Tina has the same
limit.

## One shared copy of Astro

`astroViewCMS/` is an npm workspace (`preview-protocol`,
`preview-render-server`, `sample-site`). npm installs one `astro` in the root
`node_modules`. `build.ts`, the site's components and the built server all use
it, so there is never a second instance. Per-site copies and isolation
(Docker) are left for phase 4.

## Bundling (tested on the old sample, not yet a build option)

By default the server build keeps npm packages **external**: `entry.mjs`
imports `astro/...` and others from `node_modules` at runtime. We also tested a
fully bundled variant on the first version of the server:

```js
// in build.ts, passed to build():
vite: { ssr: { noExternal: true, external: ['sharp'] } }
```

| | Server code | Needs at runtime |
|---|---|---|
| Default (external) | 568 KB | `node_modules` (155 MB in the workspace) |
| Bundled | 1.07 MB (255 KB gzipped) | Node built-ins + `sharp` (20 MB, image resizing only) |

The bundled server, copied to a folder with no `node_modules`, passed every
check except image resizing. **Not re-measured on `sample-site`**; `--bundle` is
a phase 4 option (SYSTEM-DESIGN.md section 9). Today's external server on
`sample-site` is 1.37 MiB in 70 files.

**Gotchas we hit:**

- **Prerendering runs from the output folder.** Astro prerenders pages from a
  temporary bundle in `<outDir>/server/.prerender`, which still uses
  `node_modules`. Build inside the workspace, then copy `client/` and `server/`
  (without `.prerender`) to wherever the server will run.
- **A relative `outDir` resolves against the site root,** not the render
  server. Use absolute paths (`site-config.ts` already does).

## Performance

How we measure:

- **Memory** is process **private memory** (`PrivateMemorySize` on Windows,
  RSS on Linux; working set is unreliable on Windows). `GET /__dev/memory` in
  a `--dev` build reports RSS after a forced GC, and `npm run measure:memory`
  drives a session.
- **Render time** is the route's `Server-Timing` header; the round trip is
  measured by the client.
- **Budgets** are tests, not prose: the end-to-end suite fails when the
  render time, bundle size or memory pass a bound (QUALITY-TOOLING.md).
  `npm run measure:listing` is the tripwire for D7 (listing routes), with
  `--posts=N` to change the post count.

### Against `astro dev` (first version, old sample, same machine)

| | `astro dev` | Preview render server |
|---|---|---|
| Private memory | **640–690 MB** | **78–94 MB** idle (~8× less) |
| Showing a content change | write the file → watcher → re-render; the editor reloads the iframe (AstroAdmin polls up to 2.5 s) | render in place, HTML patched, scroll kept |
| Needs at runtime | full `node_modules` (155 MB) | bundled: ~1 MB + `sharp` 20 MB |
| When code changes | instant (HMR) | rebuild |

### On `sample-site` (page render with overlay)

| | Value |
|---|---|
| Idle private memory | 89 MB (98 MB RSS in a `--dev` build) |
| First draft render of a Markdown body, cold | ~300 ms server, +113 MB (Shiki and the Markdown pipeline) |
| After `POST /__preview/warm` | ~200 MB RSS in ~0.7 to 1.7 s; first render then 10 to 21 ms |
| Memory after 150 renders (default sample) | 235 MB; 277 MB after 300 renders on the 200-post sample |
| Render median: home / blog post / 44-block `landing/long` | 3.4 ms / 2.8 ms / 11.4 ms (200 posts: 2.1 / 3.4 / 16.8 ms) |
| 40-block page, 100 edits | median 7 to 9 ms, p95 13 to 20 ms; the 5 ms goal is not met, the budget test bounds (60 / 100 ms) are |
| Listing routes (`/tags/design`, 200 posts) | `getStaticPaths` 3.6 ms, render 7.0 ms; D7 chose not to build a cache |
| Whole overlay, 200-post sample (226 documents) | 1.06 MiB, under the 4 MiB cap (D16) |
| Preview build | ~10 s warm (14 s default, 26 s with 200 posts) |

Full rows, with the method for each, are in WORKPLAN-PHASE-0-1.md section 10.

### Other runtimes we tried (first version)

| Runtime | Result | Verdict |
|---|---|---|
| **Bun 1.4.4** (same build) | all checks pass, render 0.7 ms; private memory **342 MB** (its allocator reserves up front on Windows) | No gain; dropped. Linux numbers are untested |
| **workerd** (Tina's Worker via `wrangler dev`) | ~24 MB per site on top of the runtime (98 MB empty) | Only pays off with many sites in one process (~10 sites: ~350 MB vs ~750 MB on Node). Revisit for phase 5 |

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Unit (Vitest) | `npm test` | 1039 tests, one `*.test.ts` next to each source file |
| Coverage | `npm run coverage` | V8 coverage with floors |
| Typecheck | `npm run typecheck` | `tsc` over source and tests |
| End-to-end | `npm run test:e2e` | 87 tests: builds `sample-site` into `.build/e2e-*`, starts the real server on a free port, checks every route, the decisions D1 to D16, and the budgets |
| Browser | `npm run test:browser` | 25 tests in Vitest browser mode (Chromium): the test pages play the editor and drive the real bridge in an iframe |
| Everything | `npm run check` from the repo root | every gate, with `-- --e2e` and `-- --all` for the longer ones |

The gates, thresholds and how to read them are in
[QUALITY-TOOLING.md](QUALITY-TOOLING.md). How the unit tests are set up:

- **Real Astro rendering.** `vitest.config.ts` uses Astro's own Vite config, so
  tests compile real `.astro` fixtures and render them through the actual
  Container API. There is no mocked renderer.
- **Dependencies are passed in, not mocked.** `startBridge(win, fetch)` and
  `startEditor(win, fetch)` take the window and `fetch` as parameters.
- **Browser code runs in happy-dom** in unit tests (`// @vitest-environment
  happy-dom`), and in real Chromium in the browser suite, which sees what
  happy-dom can't: hydration, scroll, focus and animations.
- **Left to end-to-end tests:** `build.ts` and `start.ts`.

## Known limits and next steps

Logged with the follow-ups in WORKPLAN-PHASE-0-1.md, task 1.8a (loose ends table).

- **Drafts aren't persisted.** They live only in the editor tab.
- **Component scripts** don't run on swapped HTML (D6).
- **MDX bodies** show the saved body in a draft; the `mdx-body` limit says so
  (D11). A restricted renderer is the phase 3 path.
- **Code fences in other languages** render as plain text until publish
  (`code-language:<name>`, D2).
- **Uploads accumulate** in `.build/<site>/media/` until the CMS app takes over
  media staging (phase 2).
- **Listing routes** run `getStaticPaths` over whole collections on every
  render (D7). Fine at 200 posts; `npm run measure:listing` trips at 15 ms.
- **`experimental_AstroContainer`** and Astro's internal content modules can
  change in any release. Pin Astro per bundle and keep the shim small.
- **Untested:** the 60 px scroll shift cause, 413 handling in the test editor,
  Linux memory, the bundled variant and `cms-server` memory.
- **Next (phase 2 and later):** the `cms-server` package (documents API, save
  with revisions, publish), then forms from `schema.json`, then the
  self-host package.

## Running it

```sh
cd astroViewCMS && npm install      # once: workspace install
cd preview-render-server
npm run build:sample                # preview build of sample-site (--dev: editor data route)
npm run start:sample                # http://localhost:4401, editor at /__editor
npm test                            # unit tests
npm run test:e2e                    # build + real server + HTTP checks
npm run test:browser                # Chromium browser tests
```

`npm run build` and `npm start` build and serve `sample-site` without the
editor's data route (`--dev` adds it, as `build:sample` does). From an AI agent, unset Astro's
agent-detection variables for the build (see the environment notes in
[README.md](README.md#3-environment-notes-windows-11-node-26-16-gb-ram)).
