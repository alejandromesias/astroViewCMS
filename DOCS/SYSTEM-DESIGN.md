# astroViewCMS system design proposal

Written 2026-10-26. Status: **proposal**. It supersedes the "Next steps" list
in `../HANDOFF.md` and gives the rules future sessions should follow. How the
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
| 1 | **The document is the unit of editing, drafting, validation and saving.** A document is one content entry (`pages/home`, `navbar/navegacion`), which is one file. | "Island" as the unit of everything |
| 2 | **The page is the unit of rendering.** The preview re-renders the whole page with a *content overlay*: `getEntry`/`getCollection` return draft data. | Rendering one component with props |
| 3 | **Regions (today's islands) are only DOM patch hints.** They say where to swap HTML. They carry no data contract and own no content. They are optional: a page without regions still previews. | Islands with `component` + `content.file` + `props` |
| 4 | **The preview node is read-only and stateless.** It never writes to the site, holds no credentials and stores no drafts. Saving and publishing live in the CMS app. | The save route inside the preview server |
| 5 | **The changeset is the unit of publishing.** "Save" writes all dirty documents in one step with conflict checks. "Publish" turns saved changes into one git commit and push. | Per-island Save button |

The rest of the document explains why, then specifies each part.

## 1. Vocabulary

Use these words in code, docs and conversation. Most of the confusion so far
came from "island" meaning four things at once.

| Term | Meaning | Example |
|---|---|---|
| **Document** | One content entry, identified by `collection/id`, stored in one file | `pages/home` → `src/content/pages/home.json` |
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

Memory doesn't depend on render granularity either. It is ~80 MB per running
site process. For multi-tenancy, the cost driver is **how many preview nodes
are alive**, not how big each render is.

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
 │  1. gets { documents } from editor ───┼──▶ POST /__preview/render?path=/
 │                                       │     body: overlay { "pages/home": {...},
 │                                       │                     "navbar/navegacion": {...} }
 │                                       │     renders the whole page with the overlay
 │  3. patches changed regions,  ◀───────┼─── 2. { html, documents: [...], ms }
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

- **The overlay is per request.** It lives in `AsyncLocalStorage`, set by the
  render route, so concurrent renders can't see each other's drafts. The spike
  used a global; production code must not.
- **The read log is document discovery.** The render answers with the list of
  documents the page read, so the editor knows which forms belong to this
  page. No config needed.
- **Don't rewrite `content.config.ts`**; only page and component modules.
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

- **images:** today's `resolveImages`. Paths that aren't in the build (a new
  image saved since) map to a media URL instead of failing;
- **references and defaults:** run the collection's schema if it can be
  imported in the bundle. Otherwise, use the field types from the schema
  manifest (section 4) to convert by hand.

This is the main open risk of the design. Validate it on the richer sample
site (section 8) before building on it.

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
  application/json`. Body: the overlay, `{ "<collection>/<id>": data | null }`.
  `null` means "deleted in the draft". The editor sends every document that
  differs from the preview bundle: drafts, plus documents saved since the
  bundle was built.
  - `200`: `{ html, head: { title, meta }, documents: string[], renderMs }`;
  - `400`: the body isn't a JSON object;
  - `404`: no route matches `path`;
  - `422`: the overlay doesn't fit a schema (message names the field);
  - `500`: render error, message for the editor.
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
  of "same origin".

### What still needs a rebuild

Unchanged from today: markup, CSS/Tailwind classes, new block types and
schema changes are code, so they need a new preview bundle. Content never
does. Content saved since the last bundle travels in the overlay. Rebuilding
the bundle after each publish keeps the overlay small.

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
  already does). They keep key order and 2-space JSON with a final newline.
  Markdown and MDX keep their body and frontmatter order (AstroAdmin does
  this).
- **Validation uses the schema manifest.** The preview build exports each
  collection's Zod schema as JSON Schema (`schema.json`, next to the bundle).
  The CMS app validates against that data, so it never runs site code. A
  document that fails validation isn't saved. The editor shows the errors.
- **Media.** Uploads go to a staging area of the CMS app and get a staging URL
  that drafts use. On save they move into the site, e.g.
  `src/content/assets/images/`. The document's path becomes relative to the
  document's folder, which is what `image()` expects.
- **Publish** = commit the changeset's paths, `pull --rebase`, push, AstroAdmin
  style. One commit per publish, with a message listing the documents. A
  build check before push is optional for single-tenant setups and mandatory
  when the platform builds the public site.

### CMS app API (single tenant first; multi-tenant adds `/sites/:site`)

| Route | Does |
|---|---|
| `GET /api/schema` | collections, fields, JSON Schema (from the bundle's manifest) |
| `GET /api/documents?collection=` | list: id, file, revision, title |
| `GET /api/documents/:collection/:id` | `{ data, body?, revision, file }` |
| `POST /api/media` | upload to staging, returns `{ url, id }` |
| `PUT /api/changes` | `{ changes: [{ document, baseRevision, data, deleted? }], media: [ids] }` → `200` new revisions, `409` conflicts, `422` validation errors |
| `GET /api/changes` | saved-but-unpublished documents (git status of content paths) |
| `POST /api/publish` | commit, rebase, push; returns the commit or a plain error |
| `GET /api/overlay` | documents that differ from the current preview bundle's revision, for the editor to send with every render |

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
  puts in the iframe URL. The preview origin turns it into its own cookie. No
  login form on the preview.
- **Builds:** the CMS app runs the preview build when the site's code changes
  (push webhook or a poll of the remote) and after each publish. About 25 s
  and several hundred MB while it runs. The old preview node keeps serving
  until the new bundle is ready.
- **Footprint at rest:** cms-server plus one preview node, roughly 80 MB each,
  in place of AstroAdmin's ~650 MB `astro dev`.

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
- **Active sites cost ~80 MB each.** A 4 GB host, keeping ~1 GB for the OS
  and other processes, fits about 35 concurrently edited sites. Renders take
  ~1 ms per keystroke after a 120 ms pause, so CPU is not the limit.
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
| `GET /__preview/<island>` (saved props) | A document read disguised as a region read | Replace with `GET /api/documents/:collection/:id` in the CMS app |
| `POST /__preview/<island>` renders one component with props | Only prop-driven components can preview; the navbar can't | `POST /__preview/render?path=` with the overlay (section 3). Keep the image resolution and the script stripping |
| Protocol `preview:draft { island, props }` | Region-keyed | `preview:draft { documents }` (the overlay). `preview:ready { path }`. `preview:rendered { documents, renderMs }` |
| Bridge: `innerHTML` per island, same-origin only | Swaps whole regions; editor must share the origin | Morph per region, head patch, body fallback, priming on load, configured editor origins |
| `/__preview-media/*` on the preview node | The node writes uploads; uploads tied to the build folder | Media staging moves to the CMS app. The preview only loads images by URL |
| `resolveImages` fails for images not in the build | A saved new image breaks the preview until a rebuild | Map unknown local paths to a media URL served by the CMS app |
| Test editor at `/__editor`, same origin | Fine for testing, wrong shape for the product | Keep as a dev tool. The real editor is a CMS app page on its own origin |
| `BlockList.astro` extracted from `index.astro` | No longer required | Keep it; it's a good region and harmless |

Keep as they are: the build-time import redirection (it works for any
component, so it marks regions), the build-once/Node-adapter approach, the
request guard, the "newest edit wins" logic, the animation finishing, the
test setup and the one-shared-Astro workspace.

## 8. A better sample site

The current sample has one page, one region and two block types. It can't
show where the design breaks. A sample that does should have:

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
| **1. Page render with overlay** | Content shim (`AsyncLocalStorage`, read log, image and reference conversion), route manifest and `getStaticPaths` handling, `POST /__preview/render`, protocol v2, bridge morph/head/priming, `documents.json` and `schema.json` from the build | Every case in section 8's table renders correctly or has a documented limit. Median render under 5 ms on the 40-block page. Unit and end-to-end tests as today |
| **2. CMS app, single tenant** | New `cms-server` package: document API, `PUT /api/changes` with revisions and validation, media staging, publish (commit, rebase, push), preview node supervision, separate origins and the preview token. Test editor talks to it | Edit two documents, save, reload: the preview shows saved content without a rebuild. A conflicting save answers 409. Publish creates one commit |
| **3. Real editor** | Forms from `schema.json` (AstroAdmin's model), drafts in `localStorage`, document picker from the render's document list, click-to-focus from field paths | A non-developer can edit every case in the sample without touching JSON |
| **4. Self-host package** | One container image (cms-server + preview node + git), env config, auth (one admin, argon2, sessions), rebuild on push webhook, bundled preview build (`--bundle`), Biome + CI | `docker run` on a small VPS edits and publishes the sample site |
| **5. Multi-tenant** | Tenants, sites, users, roles in Postgres; preview router with on-demand start and idle stop; build queue with sandboxed workers; bundles and media in object storage; GitHub App for commits; server-side drafts | Two tenants edit two sites at once, isolated. Idle sites use no memory. Measured: memory per active site, cold start, build cost |

## 10. Open questions and risks

- **Draft-to-parsed conversion in the shim** (section 3): Zod transforms,
  `reference()`, defaults, `render()` for Markdown and MDX bodies. This is
  the riskiest part. Decide after phase 1 on the richer sample.
- **`experimental_AstroContainer`** and Astro's internal content modules can
  change in any release. Pin Astro per preview bundle and keep the shim small.
  Tina has the same exposure.
- **Scripts and hydration after a swap.** Morph keeps more nodes than today's
  `innerHTML`, but swapped elements still don't re-run component scripts.
  Possible answers: re-run scripts of swapped regions, or let regions opt out
  of live swapping and reload the iframe.
- **Saved content between bundles.** The overlay carries every document saved
  since the last bundle. Rebuild the bundle after each publish so it stays
  small. Measure the overlay size on the 200-post sample.
- **Git integration for multi-tenant:** a GitHub App with API commits (no
  clones, cheap) or working copies on volumes (provider-neutral, more disk).
  Decide in phase 5.
- **Several editors on one site:** revisions catch conflicts on save, but
  there's no live co-editing. Document locks or presence can come later and
  would be keyed by document.
