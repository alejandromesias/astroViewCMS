# astroViewCMS system design proposal

Written 2026-10-26. Status: **agreed** by the user on 2026-10-26. It gives the
rules future sessions should follow; the tasks that implement it are in
[WORKPLAN.md](WORKPLAN.md). How the
current preview server works is in
[PREVIEW-RENDER-SERVER.md](PREVIEW-RENDER-SERVER.md); this document says where
it should go and what to change on the way.

Product goals, in the user's order:

1. affordable and convenient to self-host;
2. a visual preview in the editor;
3. scalable to many tenants (CMS accounts, each editing its own deployed
   Astro site);
4. lightweight and affordable even with many tenants editing at once.

Assumption: the platform has access to each site's source code (a git repo)
and can hold its built files.

## The decisions, in short

| # | Decision | Replaces |
|---|---|---|
| 1 | **The document is the unit of editing, drafting, validation and saving.** A document is one content entry (`pages/home`, `navbar/navegacion`), usually one file. Entries of a `file()` loader share one file, and JSON data files that components import directly are documents too. | "Island" as the unit of everything |
| 2 | **The page is the unit of rendering.** The preview re-renders the whole page with a *content overlay*: `getEntry`/`getCollection` return draft data. | Rendering one component with props |
| 3 | **Regions (today's islands) are only DOM patch hints.** They say where to swap HTML. They carry no data contract and own no content. They are optional: a page without regions still previews. | Islands with `component` + `content.file` + `props` |
| 4 | **The preview node is read-only and stateless.** It never writes to the site, holds no credentials and stores no drafts. Saving and publishing live in the CMS app. | The save route inside the preview server |
| 5 | **The changeset is the unit of publishing.** "Save" writes all dirty documents in one step with conflict checks. "Publish" turns saved changes into one git commit and push. | Per-island Save button |

The rest of the document explains why, then specifies each part. Decisions
taken later, after reviewing the sample site, are logged in section 11 (D1 to
D16). Where they change a contract, the section itself is updated and points
to the decision.

## 1. Vocabulary

Use these words in code, docs and conversation. Most of the confusion so far
came from "island" meaning four things at once.

| Term | Meaning | Example |
|---|---|---|
| **Document** | One content entry, identified by `collection/id`, usually stored in one file. Two variants: entries of a `file()` loader share one file, so saving rewrites only that entry inside it. JSON data files imported straight into components (`src/config/menu.json`) are documents keyed `data:<path>` | `pages/home` → `src/content/pages/home.json` |
| **Draft** | Unsaved edited data of a document, held by the editor | the textbox content today |
| **Changeset** | The set of documents (and uploaded media) changed since the last publish | home + navbar + one new image |
| **Page** | One route of the site, rendered as a whole | `/`, `/blog/hola` |
| **Region** | A marked part of a rendered page that the bridge can swap by itself | header, main content, footer |
| **Overlay** | The documents sent with a render request, which replace the built content while that request renders | `{ "pages/home": {…draft…} }` |
| **Preview bundle** | The preview build of a site at one code revision: server, client assets, manifest | `.build/sampleAstroProject/` |
| **Preview node** | A running preview bundle: one Node process per active site | `node entry.mjs` on :4400 |
| **CMS app** | Editor UI plus API: auth, documents, drafts, saving, publishing, tenants | not built yet |

"Island" stays only as a historical name in the current code. When the config
changes shape (section 7), rename `islands` to `regions`.

## 2. Islands: what they solve, for Tina and for us

### What islands solve for Tina

From the Astro contextual-editing docs (tina.io/docs/contextual-editing/astro)
and the `@tinacms/astro` and `@tinacms/bridge` source in `../tinacms/`:

1. **An on-demand render unit on a static site.** Tina's pages are
   prerendered. Only `/tina-island/[name]` runs on request, in the site's
   Worker. Each registry entry is a self-contained recipe: `fetch` (a GraphQL
   query to Tina Cloud) + `component` + `propsFromData`. The Worker can run
   that recipe without the page.
2. **A bound on data fetching per keystroke.** Each island fetches its own
   documents from Tina Cloud, then the draft overlay replaces them. Rendering
   the whole page would rerun every query of the page in a CPU-limited
   Worker. (This is our inference; the docs don't say it.)
3. **A swap target.** The bridge replaces the marked element's content.
4. **Bridge bootstrap on static pages.** `<TinaIsland>` carries the inline
   script that loads `/admin/bridge.js` inside the admin iframe. Without an
   island, a static page has no way to start editing.
5. **Document discovery.** On load, the bridge "primes" each island. The
   endpoint answers with the form payloads (the documents) its data came
   from. That's how the admin learns which forms the page has, and `primary`
   says which one is "the page".

What islands are **not**, in Tina:

- **Not the unit of saving.** Forms, one per document, are what the admin
  edits and saves through Tina Cloud.
- **Not one-to-one with documents.** In Tina's own example
  (`examples/astro/visual-editing/src/lib/islands.ts`), the `global` document
  feeds two islands, header and footer. A page island can also read several
  documents.
- **Not a way to re-render only what changed.** `island-refresh.ts`
  re-renders *every* island on the page on each change, with the full
  overlay.

### What they solve for us

| Tina's problem | Do we have it? |
|---|---|
| 1. Render unit on a static site | **Only because we chose it.** Our render call is "one component + props", so only components that take all their content as props can show a draft. That's why `BlockList.astro` had to be extracted and why the navbar can't be an island without a refactor. |
| 2. Data fetching per keystroke | **No.** The draft arrives in the request; there's no remote query. |
| 3. Swap target | **Yes.** |
| 4. Bridge bootstrap | **No.** Preview builds inject the bridge into every page. |
| 5. Document discovery | **No**, today: the site config hard-codes it. The overlay design below gets it for free. |

### Are islands needed for lightweight rendering?

**No.** The lightness comes from three things, none of which is the island:

- the site is built once, keeping its components as compiled functions;
- a plain Node process renders them with the Container API;
- no Vite, compiler or watcher runs per editor.

Measured on 2026-10-26, same machine and sample site as the other numbers:

| Render | Median | p95 | HTML size |
|---|---|---|---|
| `BlockList` (3 blocks), today's island | 0.3 ms | 0.9 ms | 5 KB |
| **Whole home page** (layout, navbar, blocks) | **0.4 ms** | 0.9 ms | 10 KB |
| `BlockList` with 40 blocks | 0.6 ms | 1.9 ms | 73 KB |
| Whole page with a content overlay, new container per request | ~1 ms | | |
| Preview node cold start, until the first page is served | ~230 ms | | |
| First render after a cold start (container creation) | ~7 ms | | |

Memory doesn't depend on render granularity either. It is ~98 MB rss per
running site process at rest, and ~200 MB once an editing session has warmed
up the Markdown renderer (D2; WORKPLAN section 10). Metric history: until
2026-10-30 the rest figure was ~80 MB of private memory; rss also counts the
Node binary and shared libraries, so the two are not comparable. For multi-tenancy, the cost
driver is **how many preview nodes are alive**, not how big each render is.

### Did we build islands just to follow Tina?

**Partly, yes.** The useful part of the pattern is "build once, render compiled
components, swap the HTML". The island-as-render-unit part answers Tina's
constraints (a Worker, static pages, remote data), which we don't have. And
"island = component + one content file + some prop keys" is not even Tina's
model. Tina keeps documents (forms) and islands separate. That conflation is
why saving ended up per island: `save-island.ts` can only merge an island's
prop keys into its file, because the island owns a slice of a document
instead of the document.

What regions still buy us, and why we keep them as an option:

- **DOM stability.** Parts of the page that didn't change keep their nodes:
  scroll position, a playing video, an open menu, hydrated framework
  components, finished animations.
- **Smaller swaps** on long pages.
- **Editor affordances.** Hover outlines, "this area is the navbar document",
  and click-to-focus can hang off region markers.

These are user-experience gains, not scalability gains. They don't justify
bending the site's components or the save model around them.

### Where regions should go (the granularity rule)

Regions follow the **page layout**, not the content model:

```text
  page  (render unit: always the whole page)
  ├─ <head>             title, meta: patched by the bridge directly
  ├─ region "header"    e.g. Navbar.astro      reads navbar/navegacion
  ├─ region "main"      e.g. BlockList.astro   reads pages/home
  │   └─ blocks         data-block-index: click-to-focus, not swap units
  └─ region "footer"    e.g. Footer.astro      reads site/config
```

- **Mark a component as a region** when it's a stable layout area: header,
  main content, footer, sidebar. Usually 2 to 5 per page.
- **Don't make one region per block.** Adding, removing or reordering blocks
  changes the list itself, so the list's parent has to be swapped anyway.
  Inside a region, use a DOM morph (see section 3) to keep unchanged blocks
  untouched.
- **Never put data rules on regions.** Which documents a region shows is
  discovered at render time, and a region can show several.
- **Anything outside every region still updates.** The bridge falls back to
  morphing the whole `<body>`.

### When to think in regions, and when not

| Concern | Unit |
|---|---|
| Rendering a preview | page |
| Swapping HTML in the iframe | region, with the body as fallback |
| Loading content into the editor | document |
| Draft state, autosave, undo | document |
| Validation (Zod schema) | document |
| Saving | changeset of documents, conflict-checked per document |
| Publishing (git commit and push) | changeset |
| Permissions, locks, history (later) | document |
| Click-to-focus | field path inside a document (`pages/home#blocks.2.texto`) |

If a function outside rendering and swapping takes a region name as its key,
it's in the wrong place.

## 3. Preview rendering

### Overview

```text
 CMS APP (editor origin)           PREVIEW NODE (site's preview origin, read-only)
 ───────────────────────           ────────────────────────────────────────────────
 holds drafts per document         node entry.mjs   (preview bundle of the site)
        │                            · serves built pages, /_astro/*, /_image
        │ postMessage                · POST /__preview/render
        ▼                            · getEntry/getCollection shim reads the overlay
 ┌──────────────── iframe ───────────────┐
 │ site page + bridge                    │
 │  1. gets { documents, media }         │
 │     from editor ──────────────────────┼──▶ POST /__preview/render?path=/
 │                                       │     body: { documents: { "pages/home": {...},
 │                                       │                          "navbar/navegacion": {...} },
 │                                       │             media: { "<image ref>": {...} } }  (D12)
 │                                       │     renders the whole page with the overlay
 │  3. patches changed regions,  ◀───────┼─── 2. { html, documents: [...], limits, ms }
 │     head, or morphs <body>            │        documents = entries the page read
 └───────────────────────────────────────┘
```

### The content overlay

In preview builds only, a Vite plugin rewrites the site's
`import … from "astro:content"` to a shim. The shim re-exports everything and
wraps the read functions:

```text
 getEntry(collection, id)
   └─ overlay has "collection/id"?  yes → entry with data = draft (images resolved)
                                    no  → the built entry, unchanged
   └─ records "collection/id" as read by this render
 getCollection(collection, filter?)
   └─ built entries, with overlay entries replaced or added, then the filter
 getEntries(...), render(entry): same idea
```

Call shapes, value shapes and the rewrite scope are fixed by decisions D2, D4,
D8 and D10 in section 11.

- **The overlay is per request.** It lives in `AsyncLocalStorage`, set by the
  render route, so concurrent renders can't see each other's drafts. The spike
  used a global; production code must not.
- **The read log is document discovery.** The render answers with the list of
  documents the page read, so the editor knows which forms belong to this
  page. No config needed.
- **Rewrite every site module under `src/`** that Vite compiles (`.astro`,
  `.ts`, `.js`, `.tsx`, `.jsx`, `.mdx`), except `content.config.*`. Helper
  modules such as `lib/contentParser.astro` call `getCollection` too (D8).
- **Proven by a spike on 2026-10-26.** The whole home page, rendered through
  the Container API with an overlay for `navbar/navegacion` and `pages/home`,
  showed both drafts. That includes `Navbar.astro`, which loads its own data
  and takes no props. Astro resolves `astro:content` before plugins'
  `resolveId`, so the working approach is a `transform` hook
  (`enforce: 'post'`) that rewrites the import in modules under the site's
  `src/`. The throwaway code is in `preview-render-server/.build/spike/`
  (gitignored).

**Raw draft vs parsed data.** `getEntry` normally returns data parsed by the
collection's Zod schema: defaults applied, `image()` turned into
`ImageMetadata`, `reference()` turned into `{ collection, id }`. A draft is the
file's raw JSON. The shim has to do the same conversions:

- **images:** resolved to `ImageMetadata` against the folder of the file
  that holds the document (D3, D5). Images in the bundle use their
  build-time metadata. Uploads, and images saved since the bundle was built,
  use the metadata and URL in the request's media map (D12). Anything else
  fails with "image not found";
- **references and defaults:** parse the draft with the *CMS schema*, a copy
  of the collection schema built with stubbed `image()` and `reference()`
  (D3). That applies defaults, coercion and enums. Then convert the stubbed
  fields: images to `ImageMetadata` or a media URL, references to
  `{ collection, id }`.

This is the main open risk of the design. D3 narrows it; phase 1 validates it
on the sample site.

### Which page component renders a URL

The preview bundle ships a route manifest: pattern, page module and whether
the page has `getStaticPaths`. The render route:

1. matches `path` against the manifest;
2. for a dynamic route, calls the page's `getStaticPaths()` **with the overlay
   active**, picks the entry whose params match, and takes its `props`. That's
   how a renamed slug or a brand-new draft entry can be previewed;
3. calls `container.renderToString(page, { params, props, request })`.

The alternative, making every page on-demand in the preview build
(`astro:route:setup`, `prerender = false`), is simpler but breaks pages that
read `Astro.props` from `getStaticPaths`, because on-demand routes ignore it.
Use the Container API path.

### Request contract (target)

- **`POST /__preview/render?path=<url path>`**, `Content-Type:
  application/json`. Body: `{ documents, media }` (D12). `documents` is the
  overlay, `{ "<key>": value | null }`. `media` holds the metadata of images
  that aren't in the bundle. Keys
  are `<collection>/<id>`, where the id may contain slashes, or
  `data:<path>` for imported JSON files (D10). Values are the raw object for
  JSON documents and `{ data, body }` for Markdown and MDX (D2). `null` means
  "deleted in the draft". The editor sends every document that
  differs from the preview bundle: drafts, plus documents saved since the
  bundle was built.
  - `200`: `{ html, head: { title, meta }, documents: string[], limits: string[], renderMs }`.
    `limits` lists what this render couldn't show, e.g. `mdx-body` (D11);
  - `400`: the body isn't the envelope: not a JSON object, `documents`
    missing or not an object, or `media` present but not an object of
    `{ url, width, height, format }` entries with a string `url`, positive
    integer dimensions and a known format. The message names the part that
    failed;
  - `404`: no route matches `path`;
  - `413`: the body is larger than the cap, checked before parsing (D16);
  - `422`: the overlay doesn't fit a schema (message names the field);
  - `500`: render error, message for the editor.
- **`POST /__preview/validate`**, same body: parses each document with the
  CMS schema and answers `200` or `422` with field paths. Read-only. It's the
  authoritative validation the CMS app calls before saving (D3).
- **No GET of saved content and no write routes on the preview node.** Saved
  content comes from the CMS app (section 4).

### The bridge's patch step

```text
 response html ──▶ parse (DOMParser)
                     │
   for each [data-preview-region] in the new page:
     same innerHTML as the live one?   yes → leave it
                                       no  → morph it into the live region
   head: set document.title, update changed <meta>
   outside regions: hash <body> with regions blanked out;
     changed → morph the whole <body>
   hydrated components and inline scripts: rules in D6
   finish entrance animations (as today)
```

- **Morph, not `innerHTML`.** A morph library (idiomorph is about 3 KB) keeps
  unchanged nodes. That gives block-level stability without block regions.
- **Newest edit wins**, as today: drop answers to older requests.
- **On load, prime.** The prerendered page in the bundle can be older than the
  saved content. When the bridge starts, it asks the editor for the overlay,
  renders once and patches. The editor learns the page's documents from that
  first answer.
- **Origins.** The editor and the preview must be on **different origins**
  in the real product (section 5). The bridge then accepts messages only from
  configured editor origins, like Tina's `PUBLIC_TINA_ADMIN_ORIGIN`, instead
  of "same origin". In the product the origins are node runtime config, not
  part of the site build (D14).

### What still needs a rebuild

Unchanged from today: markup, CSS/Tailwind classes, new block types and
schema changes are code, so they need a new preview bundle. Content never
does. Content saved since the last bundle travels in the overlay. Rebuilding
the bundle after each publish keeps the overlay small.

**Exception: build-time data (D1).** Data files read by build code, such as
`astro.config.mjs` or a Tailwind plugin, only take effect after a rebuild.
In bigspring that's `theme.json` and the `site` fields of `config.json`. The
preview still overlays them where components read them, the editor marks
them "applies after rebuild", and saving one triggers a preview rebuild.

## 4. Drafts, saving and publishing

### Content states

```text
  draft ──Save──▶ saved ──Publish──▶ published
  (editor)        (site working copy,   (git commit + push; the host
                   not public yet)       rebuilds the public site)
```

| State | Where it lives | Who sees it |
|---|---|---|
| **Draft** | editor memory, mirrored to `localStorage` (single tenant). Later, a server draft store for several editors or devices | the editor who made it |
| **Saved** | files in the CMS app's working copy of the site repo | every editor of the site, through the preview |
| **Published** | a commit pushed to the site repo's branch | the public, after the host rebuilds |

AstroAdmin uses the same split: saves only change files, Publish commits,
pulls, checks the build and pushes.

### Rules

- **Drafts are keyed by document**, with the document's revision when the
  draft started: `site / collection / id / baseRevision`.
- **The editor edits whole documents.** A page editor shows the page's
  document (title, blocks, SEO fields), not a slice. The current "props keys"
  idea goes away.
- **Save sends a changeset, all or nothing.** Each document carries its
  `baseRevision` (a hash of the file as loaded). If any file changed on disk
  since, the save answers `409` with the conflicting documents and writes
  nothing.
- **Writes are atomic per file** (temp file and rename, as `save-island.ts`
  already does). Each format has a codec that keeps what the original file
  had: key order and indentation for JSON, comments and order for YAML, the
  frontmatter and body of Markdown and MDX. A save never converts a
  document's format (D13).
- **Validation has two levels (D3).** The preview build exports each
  collection's CMS schema as JSON Schema (`schema.json`, next to the bundle).
  The editor uses it for forms and quick checks. Before saving, the CMS app
  asks the preview node (`POST /__preview/validate`), which runs the real
  refinements in its sandbox. The CMS app itself never runs site code. A
  document that fails validation isn't saved. The editor shows the errors.
- **Media.** Uploads go to a staging area of the CMS app and get a staging URL
  that drafts use. On save they move into the site, e.g.
  `src/content/assets/images/`. The document's path becomes relative to the
  folder of **the file that holds the document**, which is what `image()`
  expects. For a `file()` collection that's the shared file's folder (D5).
- **Publish** = commit the changeset's paths, `pull --rebase`, push, AstroAdmin
  style. One commit per publish, with a message listing the documents. A
  build check before push is optional for single-tenant setups and mandatory
  when the platform builds the public site.

### CMS app API (single tenant first; multi-tenant adds `/sites/:site`)

| Route | Does |
|---|---|
| `GET /api/schema` | collections, fields, JSON Schema (from the bundle's manifest) |
| `GET /api/documents?collection=` | list: key, file, revision, title |
| `GET /api/documents?key=<key>` | `{ key, data, body?, revision, file }`. Keys can contain slashes, so they travel as a query parameter (D10) |
| `POST /api/media` | upload to staging, returns `{ id, url, width, height, format }` (D12) |
| `PUT /api/changes` | `{ changes: [{ document, baseRevision, data, deleted? }], media: [ids] }` → `200` new revisions, `409` conflicts, `422` validation errors |
| `GET /api/changes` | saved-but-unpublished documents (git status of content paths) |
| `POST /api/publish` | commit, rebase, push; returns the commit or a plain error |
| `GET /api/overlay` | `{ documents, media }`: documents that differ from the current preview bundle's revision, and the metadata of images saved since it (D12), for the editor to send with every render |

## 5. Single-tenant shape

```text
 one machine or container (VPS, home server, Fly/Railway machine)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ cms-server (Node)                    preview node (Node, child proc) │
 │  · editor UI (static SPA)             · preview bundle of the site   │
 │  · /api/* (section 4)                 · read-only, no credentials    │
 │  · supervises the preview node        · own origin/port              │
 │  · builds bundles on code change          ▲                          │
 │        │                                  │ iframe + postMessage     │
 │        ▼                                                             │
 │  site working copy (git) ── push ──▶ GitHub ──▶ host rebuilds site   │
 └──────────────────────────────────────────────────────────────────────┘
```

- **Two origins even here:** e.g. `cms.example.com` and
  `preview.cms.example.com`, or two ports locally. The previewed page runs the
  site's own scripts. On the CMS app's origin, those scripts could call
  `/api/*` with the editor's cookies.
- **Preview access** goes through a short-lived signed token that the CMS app
  puts in the iframe URL. The preview origin turns it into its own cookie and
  redirects to the URL without the token. No login form on the preview. Cookie
  names and the token rules are in D14.
- **Builds:** the CMS app runs the preview build when the site's code changes
  (push webhook or a poll of the remote) and after each publish. About 25 s
  and several hundred MB while it runs. The old preview node keeps serving
  until the new bundle is ready.
- **Footprint at rest:** cms-server plus one preview node, the node about
  100 MB (rss, measured 2026-10-30; cms-server not measured yet), in place of
  AstroAdmin's ~650 MB `astro dev`. While someone edits, the preview node grows
  to ~200 MB after the warm-up (D2), 210 to 235 MB after a session of renders on
  the sample, and ~280 MB with 200 posts (WORKPLAN section 10).

## 6. Scaling to many tenants

The single-tenant pieces become services. The interfaces stay the same: the
render contract, the CMS API and the bundle layout.

```text
                        ┌───────────────────────────────┐
  editors ──TLS──▶      │ CMS app (stateless, N copies) │──▶ Postgres: tenants, sites, users,
                        │ editor UI + /api + auth       │     roles, drafts, media index
                        └──────┬───────────────┬────────┘
                               │ jobs          │ start / route
                               ▼               ▼
  ┌────────────────────┐   ┌─────────────────────────────────────────────┐
  │ build workers      │   │ preview hosts (any number)                  │
  │ queue, 1 build at  │   │  ┌ node: site A (80 MB) ┐ ┌ node: site B ┐  │
  │ a time per worker, │   │  └──────────────────────┘ └──────────────┘  │
  │ sandboxed, no      │   │  started on demand, stopped when idle       │
  │ network secrets    │   └──────────────▲──────────────────────────────┘
  └──────┬─────────────┘                  │ pulls bundles
         │ writes bundles + schema.json   │
         ▼                                │
  ┌──────────────────────────────────────────┐   ┌────────────────────────┐
  │ object storage: preview bundles per      │   │ git: one repo per site │
  │ (site, code revision), media, optional   │   │ via a GitHub App (API  │
  │ public static builds behind a CDN        │   │ commits) or a working  │
  └──────────────────────────────────────────┘   │ copy per site          │
                                                 └────────────────────────┘
  preview router: preview-<site>.cms.example.com → node of <site>; checks the token,
  starts the node on a cold request (~230 ms + first render ~7 ms)
```

### Why this stays cheap

- **Idle sites cost no memory.** A preview node runs only while someone edits
  that site, and stops after, say, 10 idle minutes. Bundles are ~3 MB in
  object storage (bundled variant, `sharp` shared on the host).
- **Active sites cost ~210 to 280 MB each.** A node that only serves static
  pages stays at ~100 MB, but an editing session warms up the Markdown renderer
  and Shiki (D2): ~200 MB after the warm-up, 210 to 235 MB after renders on
  `sample-site`, ~280 MB with 200 posts (measured, WORKPLAN section 10). A 4 GB
  host, keeping ~1 GB for the OS and other processes, fits about 11 to 13
  concurrently edited sites (3,072 MB / 280 MB and / 235 MB). D2's phase 3 plugin
  setting is the main lever to lower it. Renders take 2 to 17 ms (median, one
  page per row in section 10; the 40-block page 7 to 9 ms), after a 120 ms pause,
  so CPU is not the limit.
- **Builds are the expensive part, and they're rare.** They happen on code
  changes and publishes, not on edits. A small queue of build workers serves
  many tenants. A build can be scaled to zero between jobs.
- **The CMS app is stateless,** so it scales by running copies behind a load
  balancer.
- **The public sites aren't served by the CMS.** They stay on each tenant's
  host (Cloudflare Pages, Netlify), or the platform serves the static build
  from object storage behind a CDN.

### Isolation and trust

Tenant site code is **untrusted code**. It runs at build time (Astro config,
integrations, components) and in every render.

- **Builds** run in a sandbox: container or microVM, no platform credentials,
  limited network, time and memory limits.
- **Preview nodes** run one process per site, as their own user, inside a
  container or similar sandbox. They have no write access and no credentials.
  The overlay comes in the request, so a preview node doesn't even need
  access to the content store. This is why decision 4 matters most here.
- **Origins:** one preview origin per site, so one site's scripts can't read
  another site's preview.
- **Git credentials and the CMS database** are only in the CMS app.
- **workerd** (about 24 MB per site in one process) stays an option if density
  ever matters more than Node compatibility (PREVIEW-RENDER-SERVER.md,
  "Other runtimes").

### What changes from single tenant

| Piece | Single tenant | Multi-tenant |
|---|---|---|
| Process manager | cms-server spawns one child | preview router + node pool per host |
| Bundles | `.build/` on disk | object storage, keyed by site and code revision |
| Drafts | `localStorage` | Postgres draft store (several editors, devices) |
| Saved content | working copy on disk | GitHub App commits on a CMS branch, or a working copy per site on a volume |
| Media staging | local folder | object storage |
| Auth | one admin account | users, tenants, roles per site |
| Builds | in-process, one at a time | queue + sandboxed workers |

## 7. What to change in the current code

Review of `preview-render-server/` on 2026-10-26, including the uncommitted
save work.

| Current | Problem | Change |
|---|---|---|
| **Uncommitted:** `save-island.ts`, `save-route.ts`, `PUT /__preview-save/<island>`, `save: true` in the site config, the Save button | Saves per island, merging only the island's prop keys. It writes from the preview node, which must stay read-only. No conflict check, no validation | **Don't commit it as is.** Keep the atomic write helper (temp file + rename) and its tests, re-keyed by document. Move saving to the CMS app's `PUT /api/changes`. For the proof of concept, a small `cms-server` package next to `preview-render-server` is enough. Drop the `save` flag and the save route from the integration |
| `islands.<name>.content: { file, props }` and `contentDir` in the site config | Ties a region to one file and a slice of it | Documents and their files come from the content layer: each entry knows its `filePath`. The build writes a `documents.json` manifest. Regions keep only `component` |
| `GET /__preview/<island>` (saved props) | A document read disguised as a region read | Replace with `GET /api/documents?key=` in the CMS app (D10) |
| `POST /__preview/<island>` renders one component with props | Only prop-driven components can preview; the navbar can't | `POST /__preview/render?path=` with the overlay (section 3). Keep the image resolution and the script stripping |
| Protocol `preview:draft { island, props }` | Region-keyed | `preview:draft { documents, media }` (D12). `preview:ready { path }`. `preview:rendered { documents, limits, renderMs }` |
| Bridge: `innerHTML` per island, same-origin only | Swaps whole regions; editor must share the origin | Morph per region, head patch, body fallback, priming on load, configured editor origins |
| `/__preview-media/*` on the preview node | The node writes uploads; uploads tied to the build folder | Media staging moves to the CMS app. The preview only loads images by URL, with metadata from the request (D12) |
| `resolveImages` fails for images not in the build | A saved new image breaks the preview until a rebuild | Map unknown local paths to a media URL served by the CMS app |
| Test editor at `/__editor`, same origin | Fine for testing, wrong shape for the product | Keep as a dev tool. The real editor is a CMS app page on its own origin |
| `BlockList.astro` extracted from `index.astro` | No longer required | Keep it; it's a good region and harmless |

Keep as they are: the build-time import redirection (it works for any
component, so it marks regions), the build-once/Node-adapter approach, the
request guard, the "newest edit wins" logic, the animation finishing, the
test setup and the one-shared-Astro workspace.

## 8. A better sample site

The current sample has one page, one region and two block types. It can't
show where the design breaks. On 2026-10-26 the user chose the
`themefisher/bigspring-light-astro` template as the base, with additions on
top. WORKPLAN.md sections 5 and 6 (task 0.3) have the evaluation and the
exact additions. The tree below is the original target list; the template
covers most of it with its own names. A sample that does should have:

```text
 src/content/
 ├─ site/config.json            singleton: brand, nav links, footer, socials
 │                              → read by Header AND Footer (one document, two regions)
 ├─ pages/home.json             blocks: hero (image), servicios, testimonios
 │                              (references), galería (image list), faq
 │                              (accordion with a <script>), cta, video embed
 ├─ pages/sobre-mi.json         title + seo { title, description } + blocks
 ├─ services/*.md               collection with markdown body, image, order
 ├─ team/*.json                 referenced from blocks and posts
 ├─ blog/*.mdx                  frontmatter + MDX body with a custom component,
 │                              author = reference("team")
 └─ assets/images/*             images used through image()
 src/pages/
 ├─ index.astro                 getEntry("pages","home")
 ├─ sobre-mi.astro              second static page, SEO fields in <head>
 ├─ servicios/index.astro       getCollection("services"), sorted list
 ├─ servicios/[slug].astro      getStaticPaths over services, props from it
 ├─ blog/index.astro            listing with author names (references)
 └─ blog/[slug].astro           MDX render(entry), author card
 src/components/
 ├─ Header.astro, Footer.astro  read site/config themselves (no props)
 ├─ blocks/*                    one per block type; one with scoped styles
 │                              and :global(), one with a client script
 └─ Counter.svelte or .tsx      a hydrated framework island (client:visible)
```

What each part tests:

| Case | Tests |
|---|---|
| `site/config` in header and footer | one document, two regions, and a component that reads its own data |
| SEO fields in `<head>` | changes outside every region (head patch) |
| Testimonials or authors by reference | one region, several documents; editing `team/ana` must update `/blog/*` |
| `servicios/[slug]` | dynamic routes, `getStaticPaths` props under the overlay, renaming a slug, a brand-new draft entry |
| Listing pages | `getCollection` overlay: edit a service title, see the list change |
| Markdown and MDX bodies | `render(entry)` with a draft body, MDX components |
| FAQ accordion script, hydrated component | what breaks after a swap: scripts not re-run, hydration of swapped `astro-island` elements |
| Scoped styles and `:global()` | styles that cross component boundaries after a swap |
| Galería with many images, one new upload | image resolution, staging URLs, saved-but-not-built images |
| A home page with 40+ blocks | render time, payload size, morph cost, scroll kept |
| Generated content (200 posts, a script) | build time, bundle size, memory of the preview node |

Keep the sample free of CMS config, as today. Everything CMS-specific stays
in `preview-render-server/sites/<site>.config.ts`.

## 9. Roadmap

Each phase ends with something testable. Phases 1 and 2 are the single-tenant
core.

| Phase | Work | Done when |
|---|---|---|
| **0. Reset the save work** | Park the uncommitted per-island save (section 7). Write the richer sample site (section 8) | Sample site builds and runs with plain `astro dev` and `astro build` |
| **1. Page render with overlay** | Content shim (`AsyncLocalStorage`, read log, image and reference conversion), route manifest and `getStaticPaths` handling, `POST /__preview/render`, protocol v2, bridge morph/head/priming, `documents.json` and `schema.json` from the build | Every case in section 8's table renders correctly or has a documented limit. Median render on the 40-block page measured against a 5 ms goal; the budget tests of QUALITY-TOOLING.md gate regressions. Unit, end-to-end and browser tests, all inside the quality flow |
| **2. CMS app, single tenant** | New `cms-server` package: document API, `PUT /api/changes` with revisions and validation, media staging, publish (commit, rebase, push), preview node supervision, separate origins and the preview token, editor origins as node config with `frame-ancestors`, rebuild on protocol mismatch (D14). Test editor talks to it | Edit two documents, save, reload: the preview shows saved content without a rebuild. A conflicting save answers 409. Publish creates one commit |
| **3. Real editor** | Forms from `schema.json` (AstroAdmin's model), drafts in `localStorage`, document picker from the render's document list, click-to-focus from field paths | A non-developer can edit every case in the sample without touching JSON |
| **4. Self-host package** | One container image (cms-server + preview node + git), env config, auth (one admin, argon2, sessions), rebuild on push webhook, bundled preview build (`--bundle`), Biome + CI | `docker run` on a small VPS edits and publishes the sample site |
| **5. Multi-tenant** | Tenants, sites, users, roles in Postgres; preview router with on-demand start and idle stop; build queue with sandboxed workers; bundles and media in object storage; GitHub App for commits; server-side drafts | Two tenants edit two sites at once, isolated. Idle sites use no memory. Measured: memory per active site, cold start, build cost |

### Before phase 2: preparing for a third package

Phase 2 adds `cms-server`. It holds saving, validation, git credentials and
publishing, which makes it the riskiest code in the system. Quality-tooling
review (2026-10-29, [QUALITY-TOOLING-PLAN.md](QUALITY-TOOLING-PLAN.md) step
10) found that the guardrails list their scope by path, so a new package is
unchecked until it is added. At the start of phase 2:

- Create the package with the checklist in [QUALITY-TOOLING.md, "Adding a
  workspace package"](QUALITY-TOOLING.md#adding-a-workspace-package), so it
  has the strict flags, Biome, Knip, Stryker and depcruise from its first commit.
- Add the import rules the design already implies, mirroring decision 4:
  - the preview renderer never imports `cms-server`;
  - only `cms-server` may use `child_process` and git (the mirror of the
    renderer's read-only request-path rule);
  - `cms-server` may import `preview-protocol`, but not the renderer's
    internals; anything they share belongs in `preview-protocol`.
- Keep `cms-server`'s HTTP boundary on the same pattern as the render envelope:
  parse every request with Zod; never cast.

## 10. Open questions and risks

- **Draft-to-parsed conversion in the shim** (section 3). D3 sets the
  approach. Proven in task 1.4: defaults, coercion, `reference()` and
  `image()` resolution, refinements that throw, and Markdown `render()` at
  run time with the site's remark plugins (`remark-toc`, `remark-collapse`)
  and Shiki (`one-dark-pro`). **Cost of the Markdown render, measured on `sample-site`**
  (standalone script with forced GC, RSS): importing the site's
  `astro.config` +88 MB and ~1 s (mostly Vite and the integrations it pulls
  in; a built server idles at 79 MB and reaches ~149 MB once its first overlay
  route loads); creating the Container +7 MB; the Markdown pipeline plus
  Shiki's engine on the first render +26 MB and ~70 ms; the first `js` block
  +9 MB; each further language +0 to +7 MB and 15 to 80 ms, with outliers
  (`cpp` +28 MB and 260 ms, `ruby` +7 MB and 340 ms). All 23 languages
  tried: 238 MB; after 400 more renders it levels off at 253 MB. Limiting
  Shiki to the three languages the site uses (`javascript`, `html`, `css`;
  other fences render as plain text) levelled off at 218 MB (D2 adopts this). The site's plugins reach the server
  because the virtual module imports the site's `astro.config` (only for sites
  with a content config).
- **MDX bodies** (D11): live preview only for frontmatter in phase 1. The
  restricted renderer is the phase 3 path (decided 2026-10-30).
- **`experimental_AstroContainer`** and Astro's internal content modules can
  change in any release. Pin Astro per preview bundle and keep the shim small.
  Tina has the same exposure.
- **Scripts and hydration after a swap.** Morph keeps more nodes than today's
  `innerHTML`, but swapped elements still don't re-run component scripts.
  Possible answers: re-run scripts of swapped regions, or let regions opt out
  of live swapping and reload the iframe.
- **Saved content between bundles.** The overlay carries every document saved
  since the last bundle. Rebuild the bundle after each publish so it stays
  small. Measure the overlay size on the 200-post sample; it sets the body
  cap of D16 (WORKPLAN task 1.8).
- **Git integration for multi-tenant:** a GitHub App with API commits (no
  clones, cheap) or working copies on volumes (provider-neutral, more disk).
  Decide in phase 5.
- **Several editors on one site:** revisions catch conflicts on save, but
  there's no live co-editing. Document locks or presence can come later and
  would be keyed by document.

## 11. Decision log

Decisions taken after the design was agreed, from the review of the sample
site (WORKPLAN.md task 0.5, 2026-10-26). Each one says what to do, or marks a
**TBD** with who settles it and when. Sessions must follow these. To change
one, ask the user and add a new entry instead of editing the old one.

Status: **decided** unless the entry says TBD.

### D1. Data files that are read at build time

**Finding.** `theme.json` feeds the fonts in `astro.config.mjs` and the
Tailwind plugin `tw-theme.mjs`. The `site` block of `config.json` feeds
`site`, `base` and `trailingSlash`. The overlay can't change build output, so
"content never needs a rebuild" is false for them.

**Decision.**

- **Detect at build time.** `documents.json` flags a data document
  `buildTime: true` when build code imports it. Build code is anything that
  runs to produce the build rather than inside a page render. Detection is a
  static import scan, done by the integration before the build, from two
  kinds of roots:
  - `astro.config.*` and the local modules it imports, recursively. In
    bigspring that finds `config.json` and `theme.json`.
  - CSS `@plugin` and `@config` directives in the site's stylesheets, and the
    local modules they point at, recursively. In bigspring, `main.css` loads
    `tailwind-plugin/tw-theme.mjs`, which imports `theme.json`.

  Every `.json` under `src/` found this way is flagged. Use `es-module-lexer`
  (Vite already depends on it) for JavaScript and a plain directive match for
  CSS.
- **Limit:** files read with `fs` or dynamic `import()` by build code aren't
  detected. The site config's `buildTimeFields` (below) covers them by hand,
  and an entry there also flags a file the scan missed.
- **Fields, not only files.** `config.json` mixes build-time fields with
  fields that components read (`nav_button`, `params`). Automatic per-field
  detection isn't attempted. The site config lists the build-time fields:

  ```ts
  buildTimeFields: {
    'data:src/config/config.json': ['site.base_url', 'site.base_path', 'site.trailing_slash'],
    'data:src/config/theme.json': ['*'],
  }
  ```

  A flagged file without a list counts as all build-time.
- **The preview still overlays the whole document.** Components that read
  these fields show the draft. What the build produced, such as fonts, CSS or
  routes, stays as built.
- **The editor marks those fields "applies after rebuild".**
- **Saving a build-time field triggers a preview rebuild** (CMS app,
  phase 2). The old bundle serves until the new one is ready.

### D2. Overlay values for Markdown and MDX documents

**Finding.** `Post.astro` and `blog/index.astro` build summaries from
`entry.body`, and `render(entry)` needs the body. A data-only overlay can't
carry it.

**Decision.**

- **Value shapes:** JSON documents (glob, `file()` entries, imported data
  files) are the raw object. `.md` and `.mdx` documents are
  `{ data, body }`: `data` is the raw frontmatter and `body` the raw text
  after it.
- **The shim exposes `entry.body`** as the draft body.
- **`render(entry)` on a Markdown draft** renders the body at runtime with
  `@astrojs/markdown-remark`, using the site's `markdown` config: remark
  plugins and Shiki theme. It returns `Content` and `headings` like the
  built version. Measured in task 1.4 (see section 10).
- **Settled (2026-10-27): keep the site's plugins and Shiki. Plain code
  blocks are only a fallback when the render fails.**
  - **Why:** most of the cost is importing `astro.config` (~1 s, ~+88 MB),
    and plain code blocks wouldn't remove it. Shiki adds ~40 MB with the
    allow-list below, and up to ~90 MB without it. Dropping the plugins would
    break the preview's accuracy (heading ids, directives, plugin-set
    frontmatter) and make code blocks flicker between saved and draft styles.
    Idle built servers stay at 79 MB, because only the overlay route loads
    the config.
  - **Language allow-list:** Shiki highlights only the languages allowed.
    That's the languages of the code fences in the built content, plus an
    optional `extraLanguages` list in the site config. The shim rewrites any
    other fence to `text` before rendering and adds
    `code-language:<lang>` to `limits`, so the editor can show "highlighted
    after publish". The build writes the list to `code-languages.json` in the
    manifest folder (fences are read from the `.md` and `.mdx` files; names
    are canonical, so `js` and `javascript` count as one). The next rebuild adds new
    languages automatically.
    Measured: RSS plateaus at 218 MB instead of 253 MB, and the `cpp`
    (+28 MB) and `ruby` spikes go away.
  - **Warm-up:** when an editing session starts, not at boot. The editor
    calls `POST /__preview/warm` while it loads the document (answers 204).
    That builds the Markdown renderer and loads the allowed languages (measured
    on `sample-site`: 92 MB to 196 MB, 0.26 s; a repeat call takes 12 ms;
    private memory, task 1.5. Task 1.8 measured rss, 98 MB to 201 MB, 1.7 s
    wall including the first request). Nodes that only serve static pages stay
    at ~98 MB rss (~80 MB private memory, the earlier figure).
  - **Fallback on failure:** if importing the config or running a plugin
    throws, render plain code blocks without plugins and add
    `markdown-plugins` to `limits`, the same pattern as D11.
  - **Later (phase 3):** a per-site setting that names only the Markdown
    plugins, so the preview doesn't import the whole config. It saves most
    of the ~88 MB and takes the integrations' code out of the preview
    bundle, which helps bundle portability. See WORKPLAN section 8.
- **`render(entry)` on an MDX draft:** see D11.

### D3. Collection schemas: one stubbed CMS schema, two uses

**Findings.**

- Schemas are often functions, `({ image }) => z.object(...)`.
- They contain `reference()` (blog author, testimonial items inside a
  `discriminatedUnion` in the landing blocks).
- `z.toJSONSchema` (Zod 4 in `astro/zod`, checked 2026-10-26) throws on
  transforms such as `image()` unless `io: 'input'` is set. With it, it
  exports discriminated unions as `oneOf` and keeps `.meta()` markers.

**Decision.**

- **Build a CMS schema from `content.config.ts`** in a separate bundling
  pass, as AstroAdmin does with esbuild. The pass replaces three things with
  stubs; everything else, Zod included, is the site's own code:
  - `astro:content`: `defineCollection` records the loader and schema.
    `reference(c)` is a stub (below).
  - The `image` argument passed to schema functions is a stub (below).
  - `astro/loaders`: `glob()` and `file()` record their options and load
    nothing.
- **The pass runs twice, with two flavors of the `image` and `reference`
  stubs.** One bundle per flavor, because each use needs different behavior:

  | Stub | Flavor 1: `schema.json` | Flavor 2: draft parsing |
  |---|---|---|
  | `image()` | `z.string().meta({ cms: 'image' })` | a preprocess that turns the path into `ImageMetadata` (D5), then `z.custom<ImageMetadata>()`, with the same marker |
  | `reference(c)` | `z.string().meta({ cms: 'reference', collection: c })` | accepts a string or `{ id }`, **checks the id exists** in the bundle or the overlay, returns `{ collection, id }` |

- **Use 1: `schema.json`,** from
  `z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })`, for
  forms and quick checks in the editor.
- **Use 2: draft parsing in the shim.** Parse the draft with the flavor 2
  schema: defaults, coercion, enums, and the site's own transforms and
  refinements. A parse error answers `422` with the field path.
- **Refinements on images run on real metadata.** Astro's docs show schemas
  like `image().refine((img) => img.width >= 1080)`. With a string stub that
  refinement would see a string and fail or throw. Flavor 2 resolves the path
  first, so the refinement sees `width`, `height` and `format`, as on the
  real build:
  - images compiled into the bundle use their build-time metadata;
  - uploaded draft images and images saved since the bundle use the
    metadata in the request's media map (D12);
  - a path that resolves to neither fails the field with "image not found",
    as Astro's build does.

  If a refinement **throws** instead of returning false, for example because
  it reads a property our metadata lacks, the render answers `422` with the
  error and adds `schema-refinement` to `limits`. The real build stays the
  final check for those.
- **References are checked for existence in flavor 2.** A draft pointing at
  a deleted or misspelled author fails with `422` naming the field, as
  Astro's build would flag it. `null` in the overlay counts as deleted.
  Flavor 1, the JSON Schema, can only check that the value is a string.
  - **The check covers only the documents in the overlay.** Deleting an
    author alone, without drafting the posts that reference it, answers `200`
    and the post renders without its author.
  - **A real build does not fail on this** (checked 2026-10-30 on
    `sample-site` with `ana-torres.json` removed). Astro logs `ERROR Invalid
    content reference` for each post and `WARN Entry authors → ana-torres was
    not found` for each page, exits 0, and publishes the pages without the
    author. So the preview and the build agree on the HTML; the preview just
    hides the error lines. Phase 2 puts the guard in the CMS app, which
    refuses or warns on deleting a document that others reference
    (WORKPLAN.md section 8).
- **The real Astro schema never runs on drafts.** Astro's `image()` resolves
  files during content sync, which doesn't exist at render time.
- **Authoritative validation runs on the preview node,**
  `POST /__preview/validate` (section 3). The CMS app calls it before saving.
  The preview node already runs site code in a sandbox; the CMS app never
  does. JSON Schema can't express refinements, so it can't be the last word.
- **Settled in task 1.3 (2026-10-26): the bundler pass resolves the site's
  imports.** The pass uses rolldown, Vite 8's own bundler (esbuild isn't in
  the tree), with the site's `tsconfig.json`. `@/…` aliases and shared Zod
  helpers resolve, and the site's Zod is bundled in. Tested on a fixture and
  on bigspring. Flavor 2 needs no separate bundling: the preview build's Vite
  compiles the content config like any other module, so the aliases come from
  Astro. Two implementation facts:
  - The stubs are applied by **rewriting the two import specifiers in the
    content config's source**, not by resolving them. Astro's own resolver for
    `astro:content` runs first in a real build, and Astro also loads
    `content.config.ts` itself through the same Vite plugins, so the rewrite
    only applies to the copy that the virtual module imports with the query
    `?preview-cms-schema`.
  - Flavor 1 runs in `astro:config:setup`, so `schema.json` exists before the
    build. A Zod schema that can't be exported records `error` for that
    collection instead of failing the build.
  - **The stubs must reach the whole import graph of the content config,**
    not only the config file. Sites often split schemas into helper modules
    that import `reference` or `defineCollection` from `astro:content`
    themselves. Without the stubs there, flavor 1 can't bundle and flavor 2
    gets the real `reference()`. In flavor 2, carry the query onto the
    config's local imports, recursively, so those helpers get stubbed
    copies while pages keep the real modules. Added after the 1.3 review;
    **done in task 1.4**: flavor 1 rewrites every local module of the bundle,
    flavor 2 carries the query onto local imports. Tested with a helper that
    imports `reference` from `astro:content`.

### D4. `getEntry` and `getEntries` call shapes

**Finding.** The site calls `getEntry(author)` and `getEntries(block.items)`
with reference objects, not only `getEntry(collection, id)`.

**Decision.** The shim supports every public call shape:

- `getEntry(collection, id)` and `getEntry({ collection, id })`;
- `getEntries(refs)` over a mix of overlaid and built entries, keeping their
  order;
- a missing entry returns `undefined`, like Astro, and `null` in the overlay
  counts as missing.

Every read goes into the read log. A unit test covers each shape.

### D5. `image()` paths are relative to the file that holds the document

**Finding.** For authors, that's the document's own folder. For
`testimonials.json`, a `file()` collection, it's `src/content/`, shared by
all its entries.

**Decision.**

- `documents.json` records each document's file.
- The shim resolves draft image paths against that file's folder.
- Saving writes new image paths relative to it.
- The per-island `contentDir` setting is gone.

### D6. Hydrated components and inline scripts after a patch

**Findings.**

- Astro writes inline bootstrap scripts once per page, before the first
  hydrated component: the `astro-island` element definition and one script
  per `client:` directive.
- Checked 2026-10-26: the definition guards itself
  (`customElements.get('astro-island') || customElements.define(…)`), and
  directive scripts only assign `Astro.<directive>`. Running them again is
  safe.
- `astro-island` observes its `props` attribute and calls `hydrate()` again
  when it changes. **Corrected in task 1.6 (2026-10-27):** that alone does
  nothing for a hydrated island. Astro removes the `ssr` attribute after
  hydrating, and the React renderer returns at once for an island without
  it. Putting `ssr` back first makes React render the new props into its
  existing root, which keeps the component's state.

**Decision.** The bridge's patch rules:

- **Existing `astro-island` elements are opaque.** The morph compares and
  updates their attributes only, never their children. The framework owns
  those children. A changed `props` is applied by setting `ssr` back and
  then `props` (see the finding above); the island's state survives. An
  unchanged island is left exactly as it is.
- **Inline scripts in the new HTML that the live page doesn't have,** by
  content hash, run once: the bridge inserts fresh `<script>` elements so the
  browser executes them. Scripts the page already has are skipped. That
  covers a draft that adds the first hydrated block to a page, e.g. a
  pricing block on `landing/home-v2`.
- **Component `<script>` modules still don't run again on patched HTML**,
  e.g. a Swiper carousel in a changed region. That stays a known limit.
  **Checked in task 1.6 in a real browser:** the carousel on
  `landing/home-v2` is initialized by its script (it adds
  `swiper-initialized` and inline styles). The first render after load
  (priming) already morphs it back to the server's markup, because the live
  DOM differs from the render, and it stops working until the page is
  reloaded. Any page with a script-initialized widget behaves like this.
  A cheap fix would compare a render with the previous render instead of
  the live DOM, but Swiper puts a random class in every render, so it needs
  more than that. Left to the phase 3 fallback.
  **TBD (phase 3, with the real editor):** a fallback that re-renders and
  reloads the iframe with the overlay for regions marked script-dependent.
- **Settled in task 1.5 (2026-10-27):** the Container API writes source
  specifiers (`component-url="@/components/PricingPlans"`,
  `renderer-url="@astrojs/react/client.js"`) and a
  `before-hydration-url="astro:scripts/before-hydration.js"`, none of which a
  page can load. The render route passes the Container a `resolve` function
  that maps them through the server manifest's `entryModules`
  (`virtual:astro:manifest`), which holds exactly those keys. The islands then
  match the prerendered page: `/_astro/PricingPlans.<hash>.js` and
  `/_astro/client.<hash>.js`, and an empty entry (before-hydration) leaves the
  attribute out. Tested on `/pricing` and `/elements` (`src/render/islands.ts`).
- **The Container needs the site's renderers** (React, MDX), or hydrated
  components fail with `NoMatchingRenderer`. Astro drops its renderer list
  from the server bundle unless the build has an on-demand *page*, and the
  preview routes are endpoints. The integration therefore injects one unused
  on-demand page (`/__preview/anchor`); the route then reads
  `virtual:astro:renderers`.
- **Tests:** add a hydrated block to a page without one, change the toggle's
  props, and move a block next to a hydrated one.
- **Browser findings (task 1.8 step 2, 2026-10-30, Chromium):**
  - **Gap: a block inserted before a hydrated island replaces the island's
    node.** It re-hydrates and its state resets (the pricing toggle goes back
    to Monthly). A block inserted after it keeps the node and the state. The
    morph matches the island by position, so a shift in front of it loses the
    match. Task 1.8a tried a stable key (2026-10-30): an `id` of
    `island:<component-url>#<index>` on live and rendered islands fixed the
    browser case, but it writes our `id` onto the page's islands and replaces
    a node whose `component-url` changed, which broke three `patch.test.ts`
    cases (in-place attribute update, only-differing writes, ssr restore).
    Decision: **a limit of phase 1, pinned by the `GAP` test.** Phase 3 solves
    it with the editor, which knows which block moved. The attempt is not kept
    in the repo.
  - **Known limits, now pinned by tests.** Priming morphs the three Swiper
    carousels on `landing/home-v2` back to server markup (3 initialised to 0).
    The FAQ accordion on `/elements` keeps its state across a swap (the React
    island survives); its `active` class reads `undefined` because of a bug in
    the sample's Accordion, not in the patch.
  - **Inline scripts and elements do not pile up.** Ten props edits keep two
    island bootstraps and one body `<style>`; ten add and remove edits leave no
    extra `<style>`.
  - **`define:vars` and JSON-LD (task 1.8a item 3, 2026-10-30, Chromium).** The
    fixture is a test-only page, `/fixtures/define-vars` (`sample-site`
    `src/pages/fixtures`, entry in a `fixtures` collection, not sample content):
    a `<script define:vars>` and a JSON-LD block. A draft that changes the
    define:vars value updates it in the live page. **Limit:** each change runs
    the new script once, but the old script element stays (the morph keeps
    `SCRIPT`), so ten value edits leave eleven define:vars scripts; an edit with
    the same values adds none. **Limit:** a JSON-LD edit appends a second block
    and keeps the stale one, so ten edits leave eleven blocks, the first one
    stale. Both are pinned by `define-vars.browser.test.ts` and not fixed here.
    **Consequence:** the live preview DOM drifts from the built page during a
    long session (stale JSON-LD first, extra scripts). Authors see nothing, a
    crawler-style check of the preview would. **Fix (phase 3):** in `patch.ts`,
    replace JSON-LD and `define:vars` scripts by content or position instead
    of keeping them; real sites put JSON-LD in their SEO head, so it grows with
    every title or description edit. **Side effect:** the fixture's `fixtures`
    collection is in the sample build and `documents.json` lists
    `fixtures/define-vars` as an editable document (checked 2026-10-30, 37
    documents), so the phase 3 editor would show it. See 1.8a item 7.
    A `<style define:vars>` was tried and dropped: it added a `<style>` to the
    landing page's head, which broke the inline-elements census, so styles are
    not measured.
  - **Scroll limit.** An edit above the viewport on `landing/long` moves
    `scrollY` by 60 px (2400 to 2340) while the untouched block stays on screen
    (+0.28 px). This looks like browser scroll anchoring, not yet confirmed.
    The "scrollY unchanged" expectation holds for edits below the viewport.
    Left as a limit; `overflow-anchor: none` on the preview page is the first
    thing to try if the editor needs exact scroll.

### D7. Listing routes run `getStaticPaths` over whole collections

**Finding.** `blog/page/[slug]` and `tags/[tag]/[...page]` compute their paths
from every post, on every render.

**Decision.**

- **Measured in task 1.5 (2026-10-27), with 100 generated posts (105 in
  all):** `getStaticPaths` takes 0.1 to 2 ms on a warm server (first call
  20 ms), against a 2 to 5 ms render: `blog/[...single]` 0.2 ms,
  `tags/[tag]/[...page]` 0.8 to 2 ms, `blog/page/[slug]` 0.1 to 0.3 ms. The
  threshold below isn't crossed, so **no cache for now**.
- **Measured again in task 1.8 (2026-10-30), with 200 posts:** the threshold
  **is crossed on tag pages**. `/tags/design` (74 of 200 posts) adds 3.3 ms to
  the median `getStaticPaths` and 3.1 ms to the median render; `/blog/page/2`
  adds 0.2 ms.
- **Decision (2026-10-30): not built in phase 1.** The 3.1 ms is on the worst
  page of the 200-post sample (a tag with 74 posts); that render still takes
  about 6 ms, far under the 30 ms budget, and the editor renders once per
  debounced edit. The cache's key is the overlay entries the route read, so a
  mistake shows a stale listing in the preview, which costs more than the
  milliseconds it saves. The rule below changes to: cache when
  `getStaticPaths` adds more than 2 ms to the median render **and** the page
  matters in absolute terms, which is any of:
  - a listing page whose median render goes over about 15 ms;
  - a real site with a tag of several hundred posts (the cost grows with
    posts per tag);
  - visible lag on a listing page in the phase 3 editor;
  - phase 5, if CPU time per render limits concurrent sites.
  Task 1.8a (item 5) adds a tripwire. Review at the start of phase 3.
  The tripwire exists (2026-10-30): `npm run measure:listing` copies
  `sample-site` to a temp folder, generates 200 posts there, and prints the
  median render and `getStaticPaths` share of `/blog/page/2` and `/tags/design`,
  flagging any page over 15 ms. It is a manual tool, not a gate.
  Run it at the start of phase 3, before changes to the listing render path
  (content shim, route matching, pagination, Astro or collection upgrades),
  and when a listing or tag page feels slow. Read the `/tags/design` row: a
  page over 15 ms is the cue to revisit this decision. Measured 2026-10-30:
  `/blog/page/2` 6.3 ms (`getStaticPaths` 0.3), `/tags/design` 7.7 ms (3.6,
  47%). **Follow-up before the phase 3 run:** the 200-post size is a constant
  in the script (`POSTS`); make it a parameter so a tag with 1,000 posts can be
  measured.
- **Cache only if needed:** if `getStaticPaths` adds more than 2 ms to the
  median render, memoize its result per route. The key is the overlay entries
  of the collections it read (from the read log). An empty overlay means one
  computation per bundle.

### D8. Which modules get the `astro:content` rewrite

**Finding.** Helper modules such as `lib/contentParser.astro` call
`getCollection`, not only pages and components.

**Decision.**

- **Rewrite every module under the site's `src/`** that Vite compiles:
  `.astro`, `.ts`, `.js`, `.tsx`, `.jsx`, `.mdx`. Skip `content.config.*`.
- **Limit:** modules outside `src/`, such as npm packages or components from
  integrations, aren't rewritten, so their reads aren't overlaid. Document
  the limit, and log a build warning when such a module imports
  `astro:content`.
- **Test:** a draft with `draft: true` disappears from listings, because
  `getSinglePage` filters it.

### D9. Old routes in builds without regions

**Finding.** A preview build with no islands still injects `/__editor` and
`/__preview/<island>`.

**Decision.** No change; task 1.1 removes them.

### D10. Ids that contain slashes

**Finding** (from task 0.3). Generated posts have ids like
`generated/post-001`. The template's `blog/[single].astro` became
`[...single].astro` so the parameter can hold the slash. Real sites nest
content folders too.

**Decision.**

- **Document keys split at the first `/`:** collection before it, id after,
  slashes included (`blog/generated/post-001`). Data files use
  `data:<path>`.
- **APIs pass keys as a query parameter** (`?key=`), never as a path
  segment.
- **The render route matches rest parameters** (`[...x]`) against ids with
  slashes.
- **Keep the template change.** URLs didn't change, and it's the case to
  test.

### D11. MDX bodies

**Finding.** Live preview of an MDX body means compiling and running it at
render time: code written by an editor, plus the MDX compiler in every
preview node.

**Decision.**

- **Phase 1:** MDX frontmatter previews live. A draft body renders the saved
  body, and the render answers `limits: ["mdx-body"]`. The editor shows
  "body preview after save".
- **Phase 3, decided (2026-10-30): build a restricted renderer.** Parse the
  body with `remark-mdx` without running it, render the Markdown, and render
  component tags from an allowed list (bigspring's shortcodes: Button,
  Accordion, Notice, Video, Youtube, Tabs, Tab) with literal props only.
  Expressions, imports and exports show a placeholder. That's Tina's
  `TinaMarkdown` model. The inventory below shows it covers the sample's one
  MDX file. When it lands, a draft body renders live and `mdx-body` stays in
  `limits` only for a body the renderer can't show (a placeholder was used).
- **Not planned:** compiling and running arbitrary MDX at render time.
- **Inventory (task 1.4, 2026-10-26).** `sample-site` has one MDX file,
  `src/content/pages/elements.mdx` (253 lines), and the generated posts are
  Markdown. It uses only the shortcodes that `astro.config.mjs` auto-imports,
  with literal props: `Button` (2, `label`, `link`, `style`), `Notice` (4,
  `type`), `Tabs` with `Tab` (1 + 3, `name`), `Accordion` (3, `title`),
  `Youtube` (1, `id`, `title`) and `Video` (1, `src`, `width`). `Tabs`,
  `Accordion` and `Youtube` carry `client:load`. It has **no** `import`,
  `export` or `{expression}`. So the restricted renderer would cover this
  file with an allow-list of those seven components and literal props, and
  `client:load` would still need the hydration scripts of D6.
  Rendering an MDX entry through the Container also needs the MDX
  renderer registered (see task 1.5).

### D12. Image metadata travels in the request

**Finding.** D3 resolves draft image paths to real metadata (width, height,
format) so image refinements work. In phase 1 the preview node's stopgap
upload route can read that metadata itself. From phase 2 on, uploads go to
the CMS app (section 7), and images saved since the last bundle aren't in the
bundle either. The preview node has no access to those files, so it needs
the metadata from somewhere else.

**Decision.**

- **The render and validate requests carry a media map** next to the
  documents. The body is an envelope:

  ```json
  {
    "documents": { "<key>": "value or null" },
    "media": {
      "<image ref>": { "url": "…", "width": 1200, "height": 800, "format": "webp" }
    }
  }
  ```

  An image ref is a staging URL, as written in the draft, or a project path
  such as `src/assets/authors/new.png` for images saved since the bundle.
  The shim resolves a document's relative path against the holding file's
  folder (D5) before looking it up.
- **Resolution order in flavor 2:** an image in the bundle uses build-time
  metadata, then the media map, else "image not found".
- **Whoever stores the image measures it, once.**
  - Phase 1: the stopgap upload route answers
    `{ url, width, height, format }`, read with `sharp`. The test editor
    keeps a media map and sends it with every draft.
  - Phase 2: `POST /api/media` answers the same shape. `GET /api/overlay`
    returns `{ documents, media }`, with media entries for images saved since
    the bundle. The CMS app measures those on save and caches by content
    hash. The editor merges both into the map it sends.
- **The preview node stores no metadata** and never fetches images to
  measure them. It stays stateless and needs no storage access (decision 4).
- **The CMS app's own map is authoritative.** Metadata from the editor only
  affects previews. When the CMS app calls `POST /__preview/validate` before
  saving, it sends the media map it measured itself, not the editor's.
- **Map URLs are rendered as-is, never optimized.** The image source in the
  HTML is the entry's `url`, unchanged. It never reaches Astro's `/_image`
  optimizer, the same as draft uploads today ("not resized"). Otherwise a
  `url` chosen by whoever sends the request could make the preview node
  fetch an arbitrary address. How:
  - flavor 2 tags the metadata it builds from a map entry as media-map
    metadata;
  - preview builds wrap the site's image service (bigspring sets
    `sharpImageService()`) in a pass-through service. For tagged metadata,
    `getURL` returns the `url` unchanged and no `/_image` URL is generated.
    Everything else goes to the site's service as before;
  - `/_image` keeps the site's own `image.domains` and `remotePatterns`, so
    it won't fetch hosts the site didn't allow.

  **Settled in task 1.4 (2026-10-26): the wrapper works through the Container
  API.** A page rendered with a media-map avatar contains the entry's URL
  unchanged and no `/_image?href=` for it, in a real preview build of
  `sample-site`. No fallback needed. The wrapper replaces what Astro resolves
  for `virtual:image-service` in the server build (`src/overlay/image-service.ts`).
- **Same envelope from phase 1 on,** so phase 2 only moves the upload.

### D13. Supported formats

**Finding.** The design handled formats only implicitly, and YAML hardly
appeared. A format matters only where files are read and written, in the CMS
app. The preview node gets parsed values (D2) and never parses file text,
except when it renders a Markdown body. In Astro 7, the parser is chosen per
file by extension (checked 2026-10-26):

- `glob()` reads Markdown and MDX as content, and JSON, YAML and TOML as
  data;
- `file()` parses JSON, YAML or TOML;
- one collection can mix formats; bigspring's blog mixes `.md` and `.mdx`.

**Decision.** An opinionated set, sized for the user's own sites.

| Format | Supported as |
|---|---|
| **JSON** | `glob()` and `file()` collections; settings files that components import |
| **YAML** (`.yaml`, `.yml`) | `glob()` and `file()` collections |
| **Markdown** (`.md`) with YAML frontmatter | content entries, including files that are only frontmatter (bigspring's home page) |
| **MDX** (`.mdx`) with YAML frontmatter | content entries; the body follows D11 |

- **Not supported:** TOML, Markdoc, TOML or JSON frontmatter, and YAML or
  TOML files imported by components. Vite can't import YAML without a
  plugin, so imported settings files stay JSON. `documents.json` still lists
  such documents, with their format and `editable: false`. The preview shows
  them as built, and the build logs a warning.
- **The preview node is format-agnostic.** A YAML document's value is a plain
  object, like a JSON document's. Markdown and MDX values are
  `{ data, body }` (D2). Nothing else in the preview depends on the format.
  **One stated exception:** the test editor's dev-only route
  `GET /__dev/documents` (WORKPLAN task 1.7, only with `PREVIEW_DEV=1`) parses
  the site's files, because the data store holds schema-parsed values, not the
  raw ones the overlay needs. It goes away with the CMS app's
  `GET /api/documents` (phase 2), where the codecs live.
- **Formats can mix,** within a collection and entry by entry. Editing keeps
  each document's own format, and **a save never converts formats.**
- **New entries** use the collection's `newEntryFormat` from the site config
  if set. Otherwise they use the first extension in the loader's pattern, so
  `**/*.{json,yaml}` creates JSON.
- **One codec per format in the CMS app (phase 2).** A codec parses text
  into a value, and serializes a value back into the original text,
  keeping what it can:
  - **JSON:** key order, the original indentation (2 spaces if new), and a
    final newline;
  - **YAML:** comments, key order and quoting style, through the `yaml`
    package's Document API, which edits the parsed document in place;
  - **Markdown and MDX:** split the frontmatter at its `---` fences, write
    it with the YAML codec, and write the body exactly as edited. A file
    without frontmatter gets one only if the data isn't empty;
  - **`file()` collections:** rewrite only the edited entry inside the file,
    found by its `entryKey` from `documents.json`, with the file's codec.
    Every other entry stays untouched.
- **YAML dates (settled in task 1.4, 2026-10-26).** YAML turns an unquoted
  `2025-04-04` into a `Date`. JSON can't carry one, so in the overlay it
  arrives as an ISO string. `z.coerce.date()` accepts that, but **a plain
  `z.date()` rejects it** (tested). The shim therefore revives: when the
  parse reports "expected date" at a path that holds an ISO date string, it
  turns that string into a `Date` and parses again. It works for any schema
  shape (nested, arrays, unions) without walking the schema, and a string
  that isn't a date still fails. The same applies to Markdown frontmatter.
  Covered by unit tests; the `stats` collection of task 1.3a doesn't exist
  yet, so it isn't tested against YAML itself.
- **Sample coverage:** a YAML-only collection, a YAML `file()` collection,
  and one collection mixing JSON and YAML (WORKPLAN task 1.3a).

### D14. The bridge ships in the bundle; the protocol is its own package

**Finding.** Review of task 1.6 (2026-10-27) asked whether the bridge belongs
to the preview node, the editor, or neither.

- It runs in the site's page on the preview origin and calls only that
  origin's `POST /__preview/render`. The editor cannot patch a cross-origin
  iframe, so it is the preview node's browser half.
- It is built into every preview bundle by the site's Vite, together with the
  render, validate and warm-up routes and the `astro:content` shim. Its patch
  rules (D6) depend on the bundle's Astro and renderer versions: `astro-island`
  attributes, restoring `ssr` for React, the bootstrap scripts.
- A node-wide `bridge.js`, built once per preview-server version, would save
  few rebuilds (the routes are in the bundle anyway) and would need to support
  every Astro version still in storage. Tina loads its bridge at run time, but
  from the admin build, which is not tied to a site's Astro version.
- Its contract, `protocol.ts`, sits in `preview-render-server`, which pulls in
  Astro, sharp and rolldown. The CMS app and the real editor (phases 2 and 3)
  would depend on all of that to read a message type.
- `editorOrigins` is platform config (where the CMS app lives) but is baked in
  at build time through `SiteConfig`.

**Decision.**

- **The bridge stays in the preview bundle.** A node-served `bridge.js` stays
  an option for phase 3 or later, only if bundles pile up across protocol
  versions.
- **The protocol is its own package, `preview-protocol/`,** no dependencies,
  shared by the bridge, the render handlers and every editor (WORKPLAN task
  1.6a). It has `PROTOCOL_VERSION`. `preview:ready` and `preview:draft` carry
  it. The guards check shape only; a separate `protocolMismatch()` treats a
  missing field like a different value, so a bundle that predates the version
  shows a mismatch instead of silently failing. The render response carries no
  version, because the route and the bridge ship together.
- **On a mismatch the CMS app triggers a preview build** instead of failing,
  since a site nobody edits keeps an old bundle for months. At most once per
  bundle (site, code revision, bundle id), so a worker on an old version
  cannot loop. If the new bundle still mismatches, the editor shows the error.
  While it builds (about 25 s) the editor shows the saved page with a note.
- **The bridge announces `ready` twice on a first load (browser test, task
  1.8 step 2, 2026-10-30).** `astro:page-load` also fires on the first load,
  so the page sends two `ready`s. The protocol rule: **the editor answers every
  `ready` and a render is idempotent.** An editor that answers both renders
  twice on load with the same output; that costs one extra render per load and
  is accepted. **Gap, fixed 2026-10-30 (task 1.8a item 1): a draft that landed
  between the two `ready`s could be dropped,** because the second `ready`
  bumped the bridge's request counter and the newest-wins rule discarded the
  earlier answer, so the preview could stay stale. The bridge now bumps the
  counter only when the path differs from the one it last announced, so a
  repeat `ready` for the same path keeps an answer in flight. A real
  navigation still drops it. Tests: a browser case in `priming.browser.test.ts`
  and unit cases in `bridge.test.ts`.
- **Editor origins are node runtime config (phase 2).** `PREVIEW_EDITOR_ORIGINS`
  is set by the cms-server or the preview router. The node sends
  `frame-ancestors 'self' <origins>` on every page (needs a server in front of
  the static pages) and serves the list at `GET /__preview/config` (an injected
  route, no wrapper). The bridge keeps its own origin check as a second line of
  defence and keeps the "never `'*'`" rule until an e2e test proves the header
  on static pages. Changing the CMS domain needs a restart, not a rebuild.
- **The preview token never reaches a `postMessage`.** The node exchanges the
  token in the iframe URL for its cookie and redirects to the URL without it;
  the bridge also drops a token parameter from the `path` it sends in `ready`.
- **Cookies (phase 2).** The preview runs on a subdomain
  (`preview-<site>.cms.example.com`), so the site's scripts can set cookies on
  the parent domain, which the CMS app and other previews would receive. Name
  the CMS session cookie and the preview cookie with the `__Host-` prefix (no
  `Domain`, `Path=/`, `Secure`), so no subdomain can set or shadow them. Check
  the two-port local setup. Stronger, to weigh in phase 5: serve previews from
  a separate registrable domain, as GitHub does with `githubusercontent.com`.
- **Terminology.** "Decision 4" is the read-only preview node in the summary
  table at the top; "D4" is the `getEntry` call shapes.

### D15. Clarifications from the quality-tooling round

**Finding.** The mutation-testing follow-ups (2026-10-29,
`Handoffs/HANDOFF-2026-10-29-2305.md`) fixed behaviour in tests that the log
didn't state. None of it contradicts an earlier entry; this entry records it
so the earlier ones stay unedited.

**Decision.**

- **D10, hostile keys.** Document keys, overlay keys and config keys may be
  any string, including prototype names (`__proto__`, `constructor`). Code
  keyed by them uses `Map`, `Object.hasOwn` and `Object.fromEntries`, never a
  plain object lookup ([IMPLEMENTATION-RECOMMENDATIONS.md](IMPLEMENTATION-RECOMMENDATIONS.md)
  section 1).
- **D10, generated identifiers.** Where the build turns a JSON key into an
  identifier (`export const <key>` in `overlay/plugins.ts`), the result must
  be safe for any key; the list of reserved words is checked against the full
  set, not the keys the sample happens to use.
- **D1, content entries.** `buildTimeFields` may name content entries
  (`authors/ana`), not only `data:` files. The flag reaches `documents.json`
  the same way.
- **D6, island URLs.** The resolver joins the site's base and a chunk path
  with exactly one slash between them, whatever slashes each side carries
  (`/x//` + `_astro/a.js` gives `/x/_astro/a.js`). Pinned in
  `render/islands.test.ts`.
- **D12, stopgap media route.** The tests of `media-route.ts`, including the
  near-miss file names that must answer `404`, belong to the phase 1 stopgap.
  In phase 2 they move with the route to `POST /api/media` instead of being
  deleted.
- **TBD (the user confirms after phase 1), D3, collections without a
  loader.** Today such a collection gets a `schema.json` entry and contributes
  no documents (no `glob` or `file` to read). That is tested for the schema
  only. Once confirmed, add a `documents.json` test.

### D16. A size cap on render and validate bodies

**Finding.** `render/handlers.ts` reads the request with `request.json()` and
nothing caps its size. Only the upload route has a cap (10 MB). Decision 4
makes the overlay travel in every request, so its size grows with the content
saved since the bundle (section 10), and a hostile client can send any size.

**Decision.**

- **`POST /__preview/render` and `POST /__preview/validate` reject a body
  over the cap with `413`, before parsing it.** Check `Content-Length` first
  and count bytes while reading, so a missing or false header doesn't bypass
  the cap.
- **The cap is 4 MiB (4,194,304 bytes)**, a constant next to the check
  (`MAX_BODY_BYTES`), like the upload route's `MAX_BYTES`. Measured in task
  1.8 (2026-10-30): the overlay with every document of the 200-post sample
  differing from the bundle is 1,108,985 bytes (1.06 MiB, 226 documents), and
  a full draft of `landing/long` is 33,412 bytes. 4 MiB leaves 3.8x headroom
  over the larger, enough for about 790 posts of that size in one overlay.
- **Multi-tenant (phase 5):** the cap may become per-site runtime config, set
  by the preview router. Keep it a single constant until a site needs more.
