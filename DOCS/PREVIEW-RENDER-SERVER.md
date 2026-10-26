# How the preview render server works (system view)

Covers `preview-render-server/` as of 2026-10-25 (step 1 of the plan in
`../../HANDOFF.md`). All numbers were measured on the development machine:
Windows 11, Node 26, Astro 7.4.2, 16 GB RAM. They come from the sample site
(one page, three blocks, one image).

## In one sentence

Build the site once, keeping its components as compiled functions, then run
a plain Node process that re-renders those components in memory with draft
content: no Vite, no compiler and no file watcher at runtime.

## Why not `astro dev`

`astro dev` already renders drafts, because it re-renders on every file
change. But it carries the whole toolchain for every editor: Vite, the Astro
compiler, Tailwind, the file watcher, HMR and the dependency optimizer. Most
of that only matters when **code** changes. For content edits, the compiled
components are enough.

So we split the two jobs:

- **Build** (rarely: when code changes): full toolchain, ~25 s.
- **Render** (on every edit): compiled functions only, < 1 ms.

This is the same pattern as Tina's live preview (`@tinacms/astro`, the island
route): a server-rendered route that calls Astro's Container API. Without
Tina Cloud, we don't fetch saved content and overlay the draft. The editor
always sends the complete data.

## The two phases

```text
 BUILD (npm run build): once per code change, ~25 s
 ─────────────────────────────────────────────────────────────────────────
  sampleAstroProject/                 preview-render-server/
  ├─ astro.config.mjs ─────┐          ├─ sites/sampleAstroProject.config.js
  ├─ src/components/*.astro│          │    (where the site is, which
  ├─ src/content/*.json    │          │     component renders each island)
  └─ src/**/*.png          │          └─ src/build.js
                           ▼                     │
                ┌──────────────────────────────────────────────┐
                │ astro build()                                │
                │   site's own config                          │
                │ + @astrojs/node adapter (standalone)         │
                │ + preview integration (src/integration.js):  │
                │     · injects route /__preview/[island]      │
                │     · virtual module: island components      │
                │       + every image under src/               │
                └──────────────────────────────────────────────┘
                                   │ writes (site's dist/ untouched)
                                   ▼
                preview-render-server/.build/sampleAstroProject/
                ├─ client/   static pages, CSS, images
                └─ server/   entry.mjs + compiled components (568 KB)


 RUN (npm start): long-lived, ~80 MB
 ─────────────────────────────────────────────────────────────────────────
                ┌──────────────────────────────────────────────┐
  browser ────▶ │ node .build/<site>/server/entry.mjs  :4400   │
                │   GET  /             → prerendered HTML      │
                │   GET  /_astro/*     → CSS, images           │
                │   GET  /_image?…     → resize on demand      │
                │   POST /__preview/*  → in-memory render      │
                └──────────────────────────────────────────────┘
                no Vite · no compiler · no watcher
```

## One preview render

```text
 editor / test             preview server (one Node process)
 ─────────────             ──────────────────────────────────────────────────

 POST /__preview/blocks    1. rejectIfUnsafe
 content-type: json  ────▶    · must be application/json      else 404
 { "blocks": [ … ] }          · Sec-Fetch-Site ≠ cross-site   else 403
                           2. look up island "blocks"        else 404
                              → BlockList.astro (compiled)
                           3. resolveImages(props)
                              "../assets/images/Andre2.png"
                              + contentDir "src/content/pages"
                              → ImageMetadata (imported at build time)
                           4. AstroContainer.renderToString(BlockList, props)
                              ~0.3 ms
                           5. strip <script src="….astro?astro&type=script">
                              tags (dev-only references, see below)
 HTML fragment  ◀────────
 <section data-block-index="0">…</section>
 <section …>…</section>    headers: Server-Timing: render;dur=0.3
                                    Cache-Control: no-store

 (step 2: a bridge script in the preview iframe swaps this fragment
  into <div data-preview-island="blocks"> on the page)
```

## The pieces

| File | Role |
|---|---|
| `sites/<site>.config.js` | Site folder, port, and islands: name → component plus `contentDir`. |
| `src/site-config.js` | Loads a site config and resolves paths. The output goes to `.build/<site folder name>`. |
| `src/build.js` | Calls Astro's programmatic `build()` with the site root, the Node adapter, the integration and our `outDir`. Astro merges this with the site's own `astro.config.mjs`. |
| `src/integration.js` | Astro integration, added only by `build.js`. It injects the route and generates `virtual:preview-islands`. |
| `src/preview-route.js` | The endpoint. It runs inside the built server. |
| `src/start.js` | Sets `HOST`/`PORT` and imports the built `entry.mjs`. |
| `test/smoke.js` | Checks and timings against a running server. |

The one site change was `src/components/BlockList.astro`, which moved the
block loop out of `index.astro`. An island has to be a component, because the
server can't render half a page.

## The request contract

- `POST /__preview/<island>` with a JSON body. **The body is the
  component's props**: for `blocks`, that's `{ "blocks": [...] }`, the same
  shape as `pages/home.json`.
- Responses:
  - `200`: an HTML fragment;
  - `400`: the body isn't JSON;
  - `404`: unknown island, or not a JSON request;
  - `403`: a cross-site request;
  - `405`: any method other than POST;
  - `500`: a render error (logged on the server).
- **Why it refuses cross-site requests:** a page on another origin can't send
  a JSON body without a CORS preflight, and this route never answers one. The
  `Sec-Fetch-Site` check refuses the rest. It's the same idea as Tina's
  `rejectIfUnsafe`.
- The route only exists in preview builds. The site's normal `npm run build`
  is plain static, with no route and no markers.

## Images

- On the real site, `image()` fields turn `"../assets/images/x.png"` into
  `ImageMetadata` at build time. A draft is plain JSON, so the route has to do
  that conversion itself.
- At build time, the integration imports every image under `src/`. Each one
  is keyed by its path in the project (e.g.
  `src/content/assets/images/Andre2.png`).
- At render time, `resolveImages` joins each image-like string with the
  island's `contentDir`, normalizes it and looks it up. When it finds a match,
  it swaps the string for the `ImageMetadata`.
- `<Image>` then outputs `/_image?href=…&w=480&h=480&f=webp`, and the Node
  server resizes the image on request with `sharp`. The static page uses
  `/_astro/x.webp` instead, because it optimized the image at build time.
- **Not handled yet:** images that weren't in the build (new uploads) fail
  with "Local images must be imported" (500). Step 2 serves them from
  `/__preview-media/`.

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
| Text, block order, adding/removing blocks of existing types | no: just POST new data |
| Pointing to another image that's already in `src/` | no |
| A new uploaded image | no, once step 2 is done (`/__preview-media/`) |
| Markup, CSS/Tailwind classes, a new block type, schema changes | **yes** (~25 s) |

Tailwind classes only exist in the CSS if they appear in source files at
build time. A class built at runtime from content won't be styled. Tina has
the same limit.

## One shared copy of Astro

`astroViewCMS/` is an npm workspace (`package.json` lists
`sampleAstroProject` and `preview-render-server`). npm installs one copy of
`astro` in `astroViewCMS/node_modules`:

- `build.js` imports `astro` and `@astrojs/node` from there;
- the site's components import the same copy;
- at runtime, the built server finds the same copy by walking up from
  `.build/`.

So there's never a second Astro instance. Giving each site its own copy and
isolation (e.g. Docker) is left for later.

## Bundling (tested, not yet a build option)

By default, the server build keeps npm packages **external**: `entry.mjs`
imports `astro/...` and others from `node_modules` at runtime. We also tested
a fully bundled variant:

```js
// in build.js, passed to build():
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
  render server. Use absolute paths (`site-config.js` already does).

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
- `npm run smoke` makes 100 edits in a row.

### Against `astro dev` (same site, same machine)

| | `astro dev` | Preview render server |
|---|---|---|
| Private memory | **640–690 MB** | **78–94 MB** (~8× less) |
| Working set | 200–230 MB | 63–100 MB |
| JavaScript heap (V8) | — | 17 MB |
| Startup | ~4 s to "ready" | starts from a prebuilt bundle |
| Rendering a change | re-renders after a file write, plus HMR | **0.3 ms** median render, 1.6–1.9 ms round trip (0.6–1.2 ms render with the machine under load) |
| Needs at runtime | full `node_modules` (155 MB) | bundled: ~1 MB + `sharp` 20 MB |
| When code changes | instant (HMR) | rebuild, ~25 s |

Baseline: an empty Node HTTP server uses **25 MB** private memory. So our app
adds ~55 MB on top of Node: the Astro runtime, the compiled components, and
`sharp`/libvips once an image has been resized. The bundled variant used
70 MB idle and 82 MB after the smoke test.

### Other runtimes we tried

| Runtime | Result | Verdict |
|---|---|---|
| **Bun 1.4.4** (same build, unchanged) | 9/9 checks pass, render 0.7 ms. Working set 89 MB; private memory **342 MB** (Bun's allocator reserves memory up front on Windows). | No memory gain; dropped for now. Switching back is a one-command change, if Linux numbers ever look better. |
| **workerd** (Tina's Worker, run with `wrangler dev`) | workerd with an empty Worker: 98 MB; with Tina's Worker: 122 MB. So about **24 MB per site** on top of the runtime. Caveat: Tina's render returned empty, because Tina Cloud gave no data locally. | Heavier for one site. Only pays off when many sites share one process (~10 sites: ~350 MB vs ~750 MB on Node). It also costs `sharp`, filesystem access and some npm packages. Revisit only if we need many previews running at once. |

## Known limits and next steps

- **Draft images** that aren't in the build → step 2, `/__preview-media/`.
- **Component scripts** don't run on swapped HTML.
- **`experimental_AstroContainer`** can change in any Astro release.
  Tina has the same exposure.
- **Step 2:**
  - the `data-preview-island` wrapper and a bridge script (preview builds
    only), using `postMessage` → POST → swap, plus a render right after load
    ("priming");
  - a test editor page that shows the site in an iframe;
  - draft images.
- **Later:** a `--bundle` option in `build.js`, `data-field` markers for
  click-to-focus, more islands (the navbar), and per-site isolation.

## Running it

```sh
cd astroViewCMS && npm install      # once: workspace install
cd preview-render-server
npm run build                       # preview build of sampleAstroProject
npm start                           # http://localhost:4400
npm run smoke                       # checks + timings
```

From an AI agent, unset Astro's agent-detection variables for the build (see
the environment notes in `../../HANDOFF.md`).
