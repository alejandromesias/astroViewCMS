# How the preview render server works (system view)

> **Note (2026-10-26):** this describes the island model. Phase 1 of
> [WORKPLAN.md](WORKPLAN.md) replaces it with page rendering plus a content
> overlay ([SYSTEM-DESIGN.md](SYSTEM-DESIGN.md)). The build, bundling, image
> and performance sections stay valid.

Covers `preview-render-server/` as of 2026-10-25: step 1 (in-memory render
route) and step 2 (live preview in the browser) of the plan in
`../../HANDOFF.md`. All numbers were measured on the development machine:
Windows 11, Node 26, Astro 7.4.2, 16 GB RAM. They come from the sample site
(one page, three blocks, one image).

## In one sentence

Build the site once, keeping its components as compiled functions, then run
a plain Node process that re-renders them in memory with draft content. A
small script inside the previewed page swaps the new HTML in as the editor
types: no Vite, no compiler, no file watcher and no page reload.

## Why not `astro dev`

`astro dev` already renders drafts, because it re-renders on every file
change. But it carries the whole toolchain for every editor: Vite, the Astro
compiler, Tailwind, the file watcher, HMR and the dependency optimizer. Most
of that only matters when **code** changes. For content edits, the compiled
components are enough.

So we split the two jobs:

- **Build** (rarely: when code changes): full toolchain, ~25 s.
- **Render** (on every edit): compiled functions only, < 1 ms.

This is the same pattern as Tina's live preview (`@tinacms/astro` island
route and `@tinacms/bridge`, Apache-2.0): a server-rendered route that calls
Astro's Container API, plus a bridge script that swaps the result into the
page. Without Tina Cloud, we don't fetch saved content and overlay the draft.
The editor always sends the complete data.

AstroAdmin, the other local editor we studied, saves the file, waits for
`astro dev` to notice, polls until the page's HTML changes (up to 2.5 s) and
reloads the iframe. We skip all of that.

## The two phases

```text
 BUILD (npm run build): once per code change, ~25 s
 ─────────────────────────────────────────────────────────────────────────
  sampleAstroProject/                 preview-render-server/
  ├─ astro.config.mjs ─────┐          ├─ sites/sampleAstroProject.config.ts
  ├─ src/components/*.astro│          │    (where the site is; for each
  ├─ src/content/*.json    │          │     island: component, content file)
  └─ src/**/*.png          │          └─ src/build.ts
                           ▼                     │
                ┌──────────────────────────────────────────────┐
                │ astro build()                                │
                │   site's own config                          │
                │ + @astrojs/node adapter (standalone)         │
                │ + preview integration (src/integration.ts):  │
                │     · routes /__preview/[island],            │
                │       /__preview-media/[file], /__editor     │
                │     · wraps each island component in         │
                │       <div data-preview-island> (import      │
                │       redirect; site source untouched)       │
                │     · adds the bridge script to every page   │
                │     · virtual module: island components,     │
                │       every image under src/, media folder   │
                └──────────────────────────────────────────────┘
                                   │ writes (site's dist/ untouched)
                                   ▼
                preview-render-server/.build/
                ├─ sampleAstroProject/          client/ + server/entry.mjs
                ├─ sampleAstroProject-islands/  generated wrappers
                ├─ sampleAstroProject-media/    uploaded draft images
                └─ e2e-*/                       temporary, during npm run test:e2e


 RUN (npm start): long-lived, ~80 MB
 ─────────────────────────────────────────────────────────────────────────
                ┌───────────────────────────────────────────────────┐
  browser ────▶ │ node .build/<site>/server/entry.mjs        :4400  │
                │   GET  /                  prerendered pages       │
                │   GET  /_astro/*          CSS, JS, images         │
                │   GET  /_image?…          resize on demand        │
                │   GET  /__editor          test editor             │
                │   GET  /__preview/<i>     saved props (JSON)      │
                │   POST /__preview/<i>     in-memory render (HTML) │
                │   POST /__preview-media/new    upload draft image │
                │   GET  /__preview-media/<f>    serve draft image  │
                └───────────────────────────────────────────────────┘
                no Vite · no compiler · no watcher
```

## The live preview loop

Three parts, each of which knows only its neighbor:

```text
 EDITOR (/__editor)            PAGE IN IFRAME (/)               SERVER
 parent window                 site HTML + bridge               same origin
 startEditor() (editor.ts)     startBridge() (bridge.ts)        preview-route.ts
 ────────────────────          ─────────────────────────        ──────────────────

 sets iframe.src = "/" ──────▶ page loads, bridge starts
                               (only inside an iframe)
             ◀──── postMessage { preview:ready,
                               islands: ["blocks"] }

 GET /__preview/blocks ──────────────────────────────────────▶  read home.json
 textbox ← saved props ◀─────────────────────────────────────── { blocks: [...] }

 user types; 120 ms after
 the last keystroke,
 JSON.parse:
   invalid → red error,
   nothing sent
   valid ──── postMessage ───▶ bridge: newest request wins
              { preview:draft,
                island, props }
                               POST /__preview/blocks ──────▶  render BlockList
                               (JSON body = props)              ~0.3 ms
                               ◀───────────────────────────── HTML fragment
                               wrapper.innerHTML = fragment
                               finish entrance animations
             ◀──── postMessage { preview:rendered,
                               island, renderMs }
 status: "Rendered in 0.3 ms"

 (on error: preview:error { island, status, message } → shown in red)
```

- **Message checks in both directions:** the bridge accepts messages only from
  `window.parent`, from the same origin. The editor accepts them only from the
  iframe, from the same origin. Both send with an explicit target origin, never
  `'*'`. AstroAdmin's iframe script sends to `'*'` and checks nothing.
- **The bridge does the fetch, not the editor.** It runs on the site's
  origin, so no CORS is needed. That's why any editor (this test page, a
  Sveltia preview template, our own editor later) can drive it with
  `postMessage` alone.
- **Newest edit wins:** each draft gets a request id. A slow answer to an older
  draft is dropped, so the page never steps back. Renders take ~1 ms, so
  there's no need for Tina's 300 ms debounce. The editor only waits 120 ms
  after the last keystroke.
- **A reload resends the draft:** if the iframe reloads (for example, you
  click a link), the bridge sends `preview:ready` again. The editor then
  resends the drafts it holds, so the page shows them again.
- **Animations:** swapped-in HTML carries the site's entrance animation
  classes, which would replay on every edit. After a swap, the bridge calls
  `finish()` on the island's animations. The first page load still animates.

### Message protocol

Defined once in the `preview-protocol/` workspace package (task 1.6a, D14), as
TypeScript types (`DraftMessage`,
`PageMessage`) plus runtime checks (`isDraftMessage`, `isPageMessage`). The
bridge and the editor both import it. Each side ignores any message that
fails its check, so a malformed or foreign message does nothing.

| Direction | Message |
|---|---|
| page → editor | `{ type: 'preview:ready', islands: string[] }` |
| editor → page | `{ type: 'preview:draft', island, props }` |
| page → editor | `{ type: 'preview:rendered', island, renderMs }` |
| page → editor | `{ type: 'preview:error', island, status, message }` |

## Where the draft lives

```text
  EDITOR TAB (browser memory)      SERVER (stateless for content)      SITE FILES
  ───────────────────────────      ──────────────────────────────      ──────────
  textbox = the draft  ─────────▶  renders it, keeps nothing           home.json
  lost on tab close/reload         .build/<site>-media/                (never
                                   └─ uploaded images (kept)            written)

  another tab, or the editor ─── GET /__preview/blocks ───▶ reads home.json
  after a reload                                             → saved content
```

- **The draft only exists in the editor tab's textbox.** The server renders
  whatever it's sent and forgets it. That's why another tab shows the
  original site, and why reloading the editor starts from `home.json` again.
- **Uploaded images are the only thing the server keeps,** in
  `.build/<site>-media/`. A draft that never gets saved leaves them behind.
- **Nothing writes to the site yet.** Saving is a later step.

This is deliberate: a stateless render server is simpler, scales by just
running more copies, and has nothing to lose or clean up. Saving belongs to
the editor side:

| Later need | Where it would go |
|---|---|
| Keep a draft across editor reloads | editor: `localStorage` |
| Save | a save step that writes `home.json` (then git commit/push, AstroAdmin-style), and moves uploads into `src/content/assets/images/` |
| Share an unsaved preview, or several editors | a draft store (server or database), keyed by draft id |

## One preview render (inside the server)

```text
 POST /__preview/blocks    1. request-guard
 content-type: json  ────▶    · must be application/json      else 404
 { "blocks": [ … ] }          · Sec-Fetch-Site ≠ cross-site   else 403
                           2. look up island "blocks"        else 404
                              → BlockList.astro (compiled, unwrapped)
                           3. resolveImages(props)
                              "../assets/images/Andre2.png"
                              + contentDir "src/content/pages"
                              → ImageMetadata (imported at build time)
                              "/__preview-media/<hash>.png" → left as a URL
                           4. AstroContainer.renderToString(BlockList, props)
                              ~0.3 ms
                           5. strip <script src="….astro?astro&type=script">
                              tags (dev-only references, see below)
 HTML fragment  ◀────────
 <section data-block-index="0">…</section>
 <section …>…</section>    headers: Server-Timing: render;dur=0.3
                                    Cache-Control: no-store
```

## The pieces

Each source file has its unit test next to it (`*.test.ts`, not shown). The
right-hand column says where the code runs.

```text
preview-render-server/
├─ sites/
│  └─ sampleAstroProject.config.ts  one site: folder, port, islands     loaded by Node
├─ src/
│  ├─ build.ts          astro build() + Node adapter + integration      Node (npm run build)
│  ├─ start.ts          sets HOST/PORT, imports the built entry.mjs     Node (npm start)
│  ├─ site-config.ts    loads a site config, resolves .build/ paths     Node
│  ├─ integration.ts    routes, island wrappers, bridge script,         Node, during the build
│  │                    virtual:preview-islands
│  ├─ preview-route.ts  GET saved props · POST render                   built server
│  ├─ media-route.ts    draft image upload + serving                    built server
│  ├─ request-guard.ts  content-type / cross-site / method checks       built server
│  ├─ types.ts          site config types                               (types only)
│  ├─ virtual.d.ts      types of the generated virtual module           (types only)
│  └─ client/
│     ├─ bridge.ts        startBridge(win, fetch); the integration adds it to every page   browser, in the iframe
│     └─ patch.ts         createPatcher(win): morphs a render into the live page          browser, in the iframe
├─ test-editor/         a separate piece, served here for convenience
│  ├─ editor.astro      /__editor markup and styles                     prerendered page
│  └─ editor.ts         startEditor(win, fetch)                         browser, parent window
├─ test/
│  ├─ fixtures/         Greeting.astro, Broken.astro, and the
│  │                    virtual-preview-islands.ts double (unit tests)
│  ├─ e2e/              global-setup.ts (build + start on a free port)
│  │                    and preview-server.e2e.test.ts
│  ├─ helpers.ts        callRoute(), jsonRequest() for route tests
│  └─ astro-modules.d.ts  lets tsc type .astro imports in tests
├─ vitest.config.ts     unit tests: Astro's Vite config, happy-dom, coverage
├─ vitest.e2e.config.ts end-to-end tests
├─ tsconfig.json        typecheck only (no emit, erasable syntax)
└─ .build/              gitignored: build output, wrappers, uploads, e2e-*
```

`build.ts` and `start.ts` are thin glue with top-level side
effects, so they're tested end-to-end rather than unit-tested.

### TypeScript without a build step

All source is TypeScript, but nothing is compiled ahead of time:

- **Node 26 runs** `build.ts`, `start.ts`, `site-config.ts` and
  `integration.ts` **directly**, by stripping the types.
- **Vite compiles** the routes, the bridge and the editor as part of
  `astro build`.
- `tsconfig.json` is only for checking (`npm run typecheck`, `noEmit`). It
  sets `erasableSyntaxOnly`, so only syntax Node can strip is allowed: no
  `enum`s or `namespace`s. Imports use `.ts` extensions.

### How the island wrapper is added without touching the site

- **The goal:** the bridge needs a marker around each island
  (`<div data-preview-island="blocks">`). We don't want it in the site's
  source or its production HTML.
- **At build time,** the integration writes one wrapper per island to
  `.build/<site>-islands/<name>.astro`:

  ```astro
  ---
  import Island from "<site>/src/components/BlockList.astro";
  ---
  <div style="display: contents" data-preview-island="blocks"><Island {...Astro.props} /></div>
  ```

- **A Vite plugin redirects imports.** When the site's pages import
  `BlockList.astro`, the plugin points them at the wrapper instead. Two
  imports keep the bare component:
  - the wrapper's own;
  - the render route's (through the virtual module), so fragments come
    without the wrapper and the bridge replaces only its contents.
- `display: contents` keeps the wrapper out of the layout, so the page renders
  exactly as before.

The one change in the site was moving the block loop into
`src/components/BlockList.astro` (step 1). An island has to be a component,
because the server can't render half a page.

## Request contract

- **`POST /__preview/<island>`**, JSON body. **The body is the component's
  props**: for `blocks`, that's `{ "blocks": [...] }`, the same shape as
  `pages/home.json`.
  - `200`: an HTML fragment;
  - `400`: the body isn't JSON;
  - `404`: unknown island, or not a JSON request;
  - `403`: a cross-site request;
  - `500`: a render error. The message goes back to the editor and is logged
    on the server.
- **`GET /__preview/<island>`** returns the saved props as JSON, read from the
  content file on each request. Saved content changes need no rebuild.
- **`POST /__preview-media/new`**, the image bytes as the body,
  `Content-Type` `image/png|jpeg|webp|avif|gif`, up to 10 MB.
  - `201` with `{ "url": "/__preview-media/<hash16>.<ext>" }`;
  - `415` for other image types (no SVG, because it can carry scripts);
  - `413` if the image is empty or too big.
- **`GET /__preview-media/<file>`** serves an upload. Only names matching
  `<16 hex>.<ext>` are accepted, so no path tricks.
- **Any other method** gets `405`.
- **Why cross-site requests can't get in:** a page on another origin can't
  send a JSON or image body without a CORS preflight, and these routes never
  answer one. The `Sec-Fetch-Site` check refuses the rest. It's the same idea
  as Tina's `rejectIfUnsafe`.
- **Preview builds only:** the site's normal `npm run build` is plain static,
  with no routes, no wrappers and no bridge.

## Images

- **Images already in the build:** on the real site, `image()` fields turn
  `"../assets/images/x.png"` into `ImageMetadata` at build time. A draft is
  plain JSON, so the route does that conversion itself.
  - At build time, the integration imports every image under `src/`, keyed by
    its path in the project.
  - At render time, `resolveImages` joins each image-like string with the
    island's `contentDir` and looks it up.
  - `<Image>` then outputs `/_image?href=…&w=480&h=480&f=webp`, which the
    server resizes with `sharp`.
- **Uploaded draft images:** `/__preview-media/<hash>.png` isn't in that list,
  so it reaches `<Image>` as a plain string. Width and height are already set,
  so Astro accepts it and outputs `src="/__preview-media/<hash>.png"`, not
  resized. That's fine for a preview.
- **Not handled:** a relative path to an image that isn't in the build (e.g. a
  typo) fails with "Local images must be imported" (500), and the editor shows
  the message.

## Scripts in fragments

The Container API doesn't know about the build's bundled scripts, so for
components with a `<script>` it writes a dev-server reference:
`<script type="module" src="C:/…/HeroBlock.astro?astro&type=script…">`.
That would 404 in the browser and leak a local path, so the route removes
these tags. The page already ran the real bundled scripts once, on load.

**Limit:** component scripts don't run again on swapped-in HTML. For example,
`HeroBlock`'s `animationend` listener stays attached to the old element.

## What needs a rebuild

| Change | Rebuild? |
|---|---|
| Text, block order, adding/removing blocks of existing types | no |
| Pointing to another image that's already in `src/` | no |
| A newly uploaded image | no (`/__preview-media/`) |
| Saved content changing on disk | no (`GET` reads the file each time) |
| Markup, CSS/Tailwind classes, a new block type, schema changes | **yes** (~25 s) |

Tailwind classes only exist in the CSS if they appear in source files at
build time. A class built at runtime from content won't be styled. Tina has
the same limit.

## One shared copy of Astro

`astroViewCMS/` is an npm workspace (`package.json` lists
`sampleAstroProject` and `preview-render-server`). npm installs one copy of
`astro` in `astroViewCMS/node_modules`:

- `build.ts` imports `astro` and `@astrojs/node` from there;
- the site's components import the same copy;
- at runtime, the built server finds the same copy by walking up from
  `.build/`.

So there's never a second Astro instance. Giving each site its own copy and
isolation (e.g. Docker) is left for later.

## Bundling (tested, not yet a build option)

By default, the server build keeps npm packages **external**: `entry.mjs`
imports `astro/...` and others from `node_modules` at runtime. We also tested
a fully bundled variant (step 1 code):

```js
// in build.ts, passed to build():
vite: { ssr: { noExternal: true, external: ['sharp'] } }
```

| | Server code | Needs at runtime |
|---|---|---|
| Default (external) | 568 KB | `node_modules` (155 MB in the workspace) |
| Bundled | 1.07 MB (255 KB gzipped) | Node built-ins + `sharp` (20 MB, image resizing only) |

The bundled server, copied to a folder with no `node_modules`, passed every
check except image resizing, which failed only because `sharp` wasn't there.
For comparison, wrangler reports Tina's Worker bundle at 1.2 MB.

**Gotchas we hit:**

- **Prerendering runs from the output folder.** Astro prerenders pages from a
  temporary bundle in `<outDir>/server/.prerender`, which still uses
  `node_modules`. So build inside the workspace, then copy `client/` and
  `server/` (without `.prerender`) to wherever the server will run.
- **A relative `outDir` resolves against the site root,** not against the
  render server. Use absolute paths (`site-config.ts` already does).

So the toolchain is needed once, at build time. Each running preview only
needs Node plus about 3 MB (bundle + static files), plus `sharp` if images
should be resized.

## Performance

How we measured:

- **Memory** is the process's **private memory** (Windows `PrivateMemorySize`).
  Working set is unreliable on Windows, because the OS trims it. Both are
  listed.
- **Render time** comes from the route's `Server-Timing` header. **Round
  trip** is measured by the test client.
- The end-to-end suite (`npm run test:e2e`) makes 100 edits in a row. Step 2
  and the TypeScript rewrite added no measurable overhead: the median render
  is still 0.3 ms, and the round trip is ~1.8 ms.

### Against `astro dev` (same site, same machine)

| | `astro dev` | Preview render server |
|---|---|---|
| Private memory | **640–690 MB** | **78–94 MB** (~8× less) |
| Working set | 200–230 MB | 63–100 MB |
| JavaScript heap (V8) | — | 17 MB |
| Startup | ~4 s to "ready" | starts from a prebuilt bundle |
| Showing a content change | write the file → watcher → re-render; the editor reloads the iframe (AstroAdmin polls up to 2.5 s) | **0.3 ms** render, ~2 ms round trip, HTML swapped in place, scroll kept |
| Needs at runtime | full `node_modules` (155 MB) | bundled: ~1 MB + `sharp` 20 MB |
| When code changes | instant (HMR) | rebuild, ~25 s |

Baseline: an empty Node HTTP server uses **25 MB** private memory. So our app
adds ~55 MB on top of Node: the Astro runtime, the compiled components, and
`sharp`/libvips once an image has been resized. The bundled variant used
70 MB idle and 82 MB after a full test run.

### Other runtimes we tried

| Runtime | Result | Verdict |
|---|---|---|
| **Bun 1.4.4** (same build, unchanged) | 9/9 checks pass, render 0.7 ms. Working set 89 MB; private memory **342 MB** (Bun's allocator reserves memory up front on Windows). | No memory gain; dropped for now. Switching back is a one-command change, if Linux numbers ever look better. |
| **workerd** (Tina's Worker, run with `wrangler dev`) | workerd with an empty Worker: 98 MB; with Tina's Worker: 122 MB. So about **24 MB per site** on top of the runtime. Caveat: Tina's render returned empty, because Tina Cloud gave no data locally. | Heavier for one site. Only pays off when many sites share one process (~10 sites: ~350 MB vs ~750 MB on Node). It also costs `sharp`, filesystem access and some npm packages. Revisit only if we need many previews running at once. |

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Unit tests (Vitest) | `npm test` (`npm run test:watch` while developing) | one `*.test.ts` next to each source file |
| Coverage | `npm run coverage` | V8 coverage, text plus an HTML report in `coverage/`. Reported only, no threshold |
| Typecheck | `npm run typecheck` | `tsc` over source and tests |
| End-to-end | `npm run test:e2e` | builds the sample site into `.build/e2e-*` (`PREVIEW_BUILD_DIR`), starts the real server on a free port, checks the built page, every route and the timings over HTTP, then cleans up. ~7 s in total on the dev machine, build included |

How the unit tests are set up:

- **Real Astro rendering.** `vitest.config.ts` uses Astro's own Vite config
  (`getViteConfig`), so tests compile real `.astro` components. The route
  tests render `test/fixtures/Greeting.astro` (props, `<Image>`, a component
  script) and `Broken.astro` (throws) through the actual Container API. There
  is no mocked renderer.
- **The virtual module is a test double.** `virtual:preview-islands` is
  aliased to `test/fixtures/virtual-preview-islands.ts`, which exports empty
  `islands` and `images` for each test file to fill in, and a temporary
  `mediaDir`.
- **Dependencies are passed in, not mocked.** `startBridge(win, fetch)` and
  `startEditor(win, fetch)` take the window and `fetch` as parameters. Tests
  pass a fake parent window and a `vi.fn()` fetch, with no module mocking.
- **Browser code runs in happy-dom,** chosen per file
  (`// @vitest-environment happy-dom`). The editor tests reuse the real markup
  from `editor.astro`, with the iframe replaced by a plain element.
- **Left to end-to-end tests:** `build.ts` and `start.ts`
  are glue with top-level side effects. They're excluded from unit coverage,
  and the end-to-end suite runs them for real.

At the time of writing: 115 unit tests in ~2 s, plus 15 end-to-end tests.
Unit coverage is 100% of lines and functions, and 91.5% of branches.

## Known limits and next steps

- **Drafts aren't persisted.** They live only in the editor tab (see "Where the
  draft lives").
- **Component scripts** don't run on swapped HTML.
- **Uploads accumulate** in `.build/<site>-media/`, with no cleanup.
- **`experimental_AstroContainer`** can change in any Astro release.
  Tina has the same exposure.
- **Next:**
  - a save step (write `home.json`, move uploads into the site), probably
    followed by git commit/push;
  - forms generated from the Zod schemas instead of the JSON textbox
    (AstroAdmin converts them to JSON Schema);
  - click-to-focus using the blocks' `data-block-index`, AstroAdmin's
    `focusBlock` idea;
  - more islands (the navbar), a `--bundle` option, per-site isolation.

## Running it

```sh
cd astroViewCMS && npm install      # once: workspace install
cd preview-render-server
npm run build                       # preview build of sampleAstroProject
npm start                           # http://localhost:4400
                                    # editor: http://localhost:4400/__editor
npm test                            # unit tests
npm run test:e2e                    # build + real server + HTTP checks
```

From an AI agent, unset Astro's agent-detection variables for the build (see
the environment notes in [WORKPLAN.md](WORKPLAN.md)).
