# astroViewCMS work plan

Written 2026-10-26. This replaces `../HANDOFF.md`, which is deprecated.

Read in this order:

1. **[SYSTEM-DESIGN.md](SYSTEM-DESIGN.md):** what we're building and why.
   Documents, pages, regions, changesets, the read-only preview node, the
   roadmap. It's the authority: if this plan and the design disagree, fix
   this plan.
2. **This file:** where the code stands, how to work on it, and the tasks for
   phases 0 and 1.
3. **[PREVIEW-RENDER-SERVER.md](PREVIEW-RENDER-SERVER.md):** how the current
   code works. It describes the island model that phase 1 replaces. Its
   build, image, bundling and performance sections stay valid.

The research that led here (Tina, AstroAdmin, Sveltia, Sitepins) is in the
parent folder: `../../HANDOFF.md`, `../../*-SYSTEM-OVERVIEW.md`, and the `tinacms/`,
`astroadmin/` and `sveltia-cms/` checkouts, which are reference only.

## 1. Where we are

| | Status |
|---|---|
| Preview render server: build once, render in memory, bridge, test editor, draft images | done (island model) |
| TypeScript without a build step, Vitest unit tests (115) and end-to-end suite (15) | done |
| System design | done, agreed by the user on 2026-10-26 |
| Per-island save (`save-island.ts`, `save-route.ts`, Save button) | **uncommitted, not compliant**; task 0.1 parks it |
| Richer sample site | template chosen and cloned (section 5), not yet in the workspace |
| Page render with content overlay | spike only (`preview-render-server/.build/spike/`, gitignored) |
| CMS app, saving, publishing, real editor, auth | not started (phases 2 to 4) |

Folder layout of `astroViewCMS/` (git repo on `master`, no remote):

```text
astroViewCMS/
├─ package.json             npm workspace: sampleAstroProject, preview-render-server
├─ DOCS/                    SYSTEM-DESIGN.md, WORKPLAN.md, PREVIEW-RENDER-SERVER.md
├─ preview-render-server/   the renderer (see PREVIEW-RENDER-SERVER.md)
├─ sampleAstroProject/      current sample: one page, one island; removed in task 1.10
├─ bigspring-light-astro/   cloned template (its own .git), the new sample; task 0.2
└─ dante-astro-theme/       cloned template, evaluated and rejected; task 0.6 deletes it
```

## 2. Working rules

- **Ask before committing.** Finish, summarize, ask. The user reviews changes
  before they land in history.
- **Follow the design's units.** If a function outside rendering or DOM
  swapping is keyed by a region (or "island"), it's in the wrong place. See
  "When to think in regions, and when not" in SYSTEM-DESIGN.md.
- **The preview node never writes to the site** and holds no credentials.
- **TypeScript, no build step:** Node runs `.ts` by stripping types
  (`erasableSyntaxOnly`: no `enum`, no `namespace`; imports use `.ts`).
  Vite compiles what goes into the build. `tsc` only type-checks.
- **One test file per source file** (`*.test.ts` next to it), Vitest. Glue
  with top-level side effects (`build.ts`, `start.ts`, `bridge-entry.ts`) is
  covered end-to-end. Coverage is **reported, not gated**.
- **Real Astro in tests:** render real `.astro` fixtures through the Container
  API (`getViteConfig`), no mocked renderer. Pass dependencies in (`win`,
  `fetch`) instead of module mocking.
- **Comments:** brief but thorough, on every function and route.
- **Docs:** plain-text diagrams, concise system-level explanations. The user
  prefers step-by-step "how it works" overviews.
- **Keep the sample site free of CMS config.** Everything CMS-specific lives
  in `preview-render-server/sites/<site>.config.ts`.
- **The sample site is a stand-in for real customer sites.** Prefer adding
  complexity to it over simplifying it. If the CMS can't handle something the
  template does, fix the CMS, not the template.

## 3. Environment notes (Windows 11, Node 26, 16 GB RAM)

- **Astro 7 detects AI agents** and backgrounds `astro` commands. From an
  agent, unset the markers:

  ```sh
  env -u AI_AGENT -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_AGENT_SDK_VERSION <cmd>
  ```

  The end-to-end setup already does this for its child processes. A person
  in a terminal doesn't need it.
- **Memory is tight,** often under 1 GB free. Measure **private memory**,
  not working set, because Windows trims the latter. Avoid parallel installs
  and builds.
- **npm installs are slow here:** bigspring took 8.5 minutes and 564 MB of
  `node_modules` standalone.
- **npm 11 blocks install scripts** unless approved
  (`npm install-scripts approve <pkg>`). No Corepack; for pnpm use
  `npx --yes pnpm@<version>`.
- **`localhost` resolves to IPv6** for servers started without
  `HOST=127.0.0.1`. Use matching hosts when polling.
- **Python 3.12 is installed** as `py` and `python` (`C:\Python312`).
  `python3` is the Microsoft Store placeholder and fails, so don't use it.
  Prefer Node for project scripts, since the project is Node-only.
- **Heredocs in the agent's Bash tool can lose backslashes.** Write files
  that contain them with the file-writing tool.
- **Chrome DevTools automation has hung before.** Ask the user to check UIs
  in their own browser.

## 4. Gotchas already hit

- **The build folder must be inside the workspace.** Prerendering and the
  built server resolve packages from `node_modules`. A build in the OS temp
  folder fails.
- **A relative `outDir` resolves against the site root,** not the render
  server. `site-config.ts` makes every path absolute.
- **The virtual module exists only during a build.** Unit tests alias it to a
  fillable double (`test/fixtures/virtual-preview-islands.ts`).
- **Swapped-in HTML doesn't re-run component `<script>`s,** and the container
  writes dev-only script references that the route strips.
- **Under happy-dom, `URL` is the DOM's,** which `node:fs` rejects. Use paths.
- **`experimental_AstroContainer` can change in any Astro release.** Tina has
  the same exposure.
- **`resolveId` never sees `astro:content`** (Astro resolves it first). The
  overlay spike works with a `transform` hook, `enforce: 'post'`, that
  rewrites the import in modules under the site's `src/`.
- **Bigspring's `astro-auto-import@0.5.1`** declares peers only up to Astro 6.
  pnpm ignores that; npm needs `--legacy-peer-deps`. It works with Astro 7 in
  practice (the template builds).

## 5. The new sample site

### Evaluation

| | bigspring-light-astro | dante-astro-theme |
|---|---|---|
| Source | `themefisher/bigspring-light-astro` @ `4b40e8e` (2026-06-27), MIT | `JustGoodUI/dante-astro-theme` @ `83ff8f4` (2026-09-28) |
| Astro | 7.0.3 pinned | ^7.3.5 |
| Pages built | 15, in ~25 s; builds cleanly | not built |
| Home page content | a content collection entry (`homepage/-index.md`), fixed sections | a **TypeScript module** (`src/data/site-config.ts`) that imports images |
| Site settings | JSON files imported by components (`src/config/*.json`) | the same TypeScript module |
| Bodies | Markdown and MDX, with React shortcodes auto-imported | Markdown and MDX |
| Framework components | React (shortcodes, icons) | none |
| Client scripts | Swiper carousel, `ClientRouter` view transitions | theme toggle |
| Routes | static pages, `[regular]` catch-all, blog detail, blog pagination | blog, projects, tags with pagination, catch-all pages |
| Images | strings to `public/` files | `image()` fields |
| CMS fit | content-driven, already shipped with Sitepins config | home and settings are code, so a CMS can't edit them without rewriting the site |

**Decision: bigspring.** It's the closer stand-in for a client marketing
site, and its content is data. Dante would mean converting code to content,
which is subtracting from the site rather than handling it. Dante's
strengths, `image()` fields and tag pagination, are added on top of bigspring
in task 0.3.

### What bigspring brings that the design must handle

These are findings, not problems with the template. Each feeds a phase 1 task.

| Pattern in bigspring | Impact on the design | Task |
|---|---|---|
| Header and Footer import `src/config/menu.json`, `config.json`, `social.json` directly, including a named import (`import { nav_button } from …`) | These JSON files are **documents too**, but they're modules, not collection entries. The overlay must also cover imported JSON data files | 1.4 |
| `render(entry)` for Markdown and MDX bodies (blog, `[regular]` pages) | A draft body needs a runtime Markdown render. MDX would need a runtime compile, which is code execution | 1.4 |
| React shortcodes in MDX, `DynamicIcon.tsx` | The Container API needs the React renderer loaded | 1.5 |
| `ClientRouter` | Navigation inside the iframe doesn't reload the page, so the bridge must re-announce on `astro:page-load` | 1.6 |
| Swiper carousel (`astro-swiper`) | A swapped carousel won't re-initialize: the script re-run limit, now on a real site | 1.6 |
| Images as `public/` strings with `<Image width height>` | No conversion needed, unlike `image()` | 1.4 |
| `getStaticPaths` with `props` (`[regular]`, `blog/[single]`) and without (`blog/page/[slug]`) | Both shapes go through the route manifest | 1.5 |
| `base`, `trailingSlash` from `config.json` | The render route's URL matching must respect them | 1.5 |
| Fonts through Astro's fonts API (Google provider) | Builds fetch fonts over the network; offline builds may fail | note |
| Content ids can contain slashes (`blog/generated/post-001`; added in 0.3, which made the blog route `[...single]`) | The render route must match catch-all parameters (`[...x]`) against paths with slashes. Document keys (`collection/id`) can contain `/` in the id, so code must split on the first `/` only, and file names and URLs must handle nested ids | 1.3, 1.5 |

## 6. Phase 0: reset

Goal (from the design): park the non-compliant save work and bring in the
richer sample site. **Done when:** the sample site builds and runs with plain
`astro dev` and `astro build` inside the workspace, the preview server still
passes its tests on the old sample, and the working tree has no per-island
save code.

### 0.1 Park the per-island save work

The uncommitted files from the earlier session: `src/save-island.ts`,
`src/save-route.ts` and their tests, plus edits to `integration.ts`,
`integration.test.ts`, `types.ts`, the site config, the test editor
(`editor.astro`, `editor.ts`, `editor.test.ts`) and the end-to-end test.

1. **Ask the user first** whether that session is finished. Its files are
   still in the working tree.
2. Create branch `parked/per-island-save` from `master`, commit the work
   there with a message saying it's parked and why (SYSTEM-DESIGN.md
   section 7), and switch back to `master`. `master` is then clean.
3. Note what to reuse later, in phase 2's `cms-server`: the atomic write
   (temp file plus rename) and its tests. Nothing else carries over.

### 0.2 Bring bigspring into the workspace

1. Rename `bigspring-light-astro/` to `sample-site/`.
2. Remove its `.git` folder. Add a short "Origin" section to its README with
   the upstream URL and commit `4b40e8e`. Keep its `LICENSE` (MIT).
3. Remove what doesn't belong in a sample:
   - deploy config: `wrangler.jsonc`, `netlify.toml`, the
     `deploy:cf-workers` and `preview:cf-workers` scripts, the `wrangler`
     dependency;
   - another CMS's config: `.sitepins/`, `public/sitepins-manifest.json`,
     `public/.well-known/sitepins.json`;
   - other package managers' files: `yarn.lock`, `.yarnrc`,
     `pnpm-lock.yaml`, `pnpm-workspace.yaml`;
   - analytics: `@digi4care/astro-google-tagmanager`, its two components in
     `Base.astro` and the `google_tag_manager` block in `config.json`;
   - tooling we don't use: `eslint` (no config in the template),
     `prettier` and its plugins, `@astrojs/check` and the `check` script.
     Keep `typescript` and the `@types/*` packages.
4. Delete its `node_modules/` and `dist/` from the evaluation.
5. Align versions with the workspace: `astro` to the workspace's version
   (^7.4), `@astrojs/mdx`, `@astrojs/react` and `@astrojs/sitemap` to versions
   that support it. There must be **one** `astro` in
   `astroViewCMS/node_modules` (`npm ls astro`).
6. Add `sample-site` to the root `package.json` workspaces. Add a root
   `.npmrc` with `legacy-peer-deps=true`, with a comment explaining it's for
   `astro-auto-import`. Run `npm install` from `astroViewCMS/`.
7. Check `astro dev` and `astro build` in `sample-site/`. Every page from the
   evaluation must still build.

### 0.3 Add complexity on top of bigspring

Add, don't replace. Every existing page and collection stays as it is. Each
addition maps to a row in SYSTEM-DESIGN.md section 8.

| Addition | Tests |
|---|---|
| **`landing` collection** (`src/content/landing/*.json`) with a `blocks` array: a discriminated union on `type`. Use the template's own section markup as block components under `src/layouts/blocks/`: banner, features, services (with Swiper), workflow, call to action, pricing plans, FAQ, testimonials. Route `src/pages/landing/[slug].astro` with `getStaticPaths` and `props` | page builder: add, remove and reorder blocks; dynamic routes |
| `landing/long.json` with 40+ blocks | render time, payload size, morph cost, scroll kept |
| **`authors` collection** (`src/content/authors/*.json`) with `avatar: image()` from `src/assets/authors/` | `image()` fields |
| `author: reference('authors').optional()` added to the blog schema, an author card in `PostSingle.astro`, and authors on the blog list | one page, several documents; editing an author updates every post that references it |
| **`testimonials` collection with the `file()` loader** (one `src/content/testimonials.json` holding many entries), used by the testimonials block through references | several documents in **one file** |
| `cover: image().optional()` on blog posts, used when set, next to the existing string `image` | `image()` on a collection with Markdown bodies |
| **Tag pages** `src/pages/tags/[tag]/[...page].astro` using the existing `tags` field, Dante-style | nested dynamic routes, `getCollection` listings |
| **A hydrated React component** (`client:visible`): a monthly or yearly price toggle on the pricing page | hydrated `astro-island` elements after a swap |
| A block with **scoped styles and `:global()`** | styles that cross component boundaries after a swap |
| `scripts/generate-posts.mjs` and an npm script that writes 100 posts into `src/content/blog/generated/` (gitignored) | build time, bundle size, memory, overlay size |

Done when: `astro build` passes with and without the generated posts, and
`astro dev` shows every new page.

### 0.4 Preview build of the new sample, unchanged server

- Add `preview-render-server/sites/sample-site.config.ts` with
  `islands: {}` and its own port (4401), plus `build:sample` and
  `start:sample` scripts.
- Fix whatever the current server breaks on: the React integration, the
  fonts API, `base` and `trailingSlash`. Don't add islands to it; phase 1
  replaces them.
- Record a baseline in section 10: build time, bundle size, idle private
  memory.

### 0.5 Check the design against the template

Read SYSTEM-DESIGN.md sections 3 and 8 against section 5 above. The design
was already corrected on 2026-10-26 for documents that share a file and for
imported JSON data files. Write down anything else found, and ask the user
before changing the design.

### 0.6 Clean up

Delete `dante-astro-theme/` (it can be cloned again) and the
`preview-render-server/.build/spike/` scripts once task 1.4 has its own
code. Neither is tracked by git.

## 7. Phase 1: page render with overlay

Goal (from the design): the preview renders whole pages with a content
overlay, regions are only patch hints, and nothing in the preview node is
keyed by island. **Done when:** every case in SYSTEM-DESIGN.md section 8,
built on the sample site, renders correctly or has a documented limit. The
median render on the 40-block page must be under 5 ms. Unit and end-to-end
tests pass.

Order matters: 1.1 removes code, 1.2 renames, then the new pieces come in.
The old sample keeps the suite green until 1.10.

### 1.1 Remove what the design rules out

From SYSTEM-DESIGN.md section 7:

- **Island content settings:** `content: { file, props }` and `contentDir`
  in `IslandConfig`. The `contentFile` and `contentProps` fields in the
  virtual module. Their tests.
- **`GET /__preview/<island>`** (saved props). The test editor loses its data
  source, which 1.7 replaces with a dev-only document route.
- **`POST /__preview/<island>`** and its props contract stay until 1.5
  lands, then go.
- **`/__preview-media/*`** stays for now, marked in code and docs as a
  stopgap until the CMS app's media staging (phase 2).

### 1.2 Rename island to region

A mechanical rename, in its own commit:

| Old | New |
|---|---|
| `islands` in the site config, `IslandConfig` | `regions`, `RegionConfig { component }` |
| `data-preview-island` | `data-preview-region` |
| `virtual:preview-islands`, `virtual-preview-islands.ts` | `virtual:preview-site`, `virtual-preview-site.ts` (it will carry more than regions) |
| `.build/<site>-islands/`, `writeIslandWrappers`, `islandWrappers` | `.build/<site>-regions/`, `writeRegionWrappers`, `regionWrappers` |
| "island" in comments, README, test names | "region" |

Keep the import redirection exactly as it is; it marks any component,
including ones that load their own data.

### 1.3 Build manifests

The integration writes these next to the bundle in
`.build/<site>-manifest/`. The virtual module also exposes them to the routes.

| File | Contents | How |
|---|---|---|
| `documents.json` | one entry per document: key (`collection/id`, or `data:src/config/menu.json` for JSON data modules), file path, format (`json`, `md`, `mdx`, `yaml`), and for `file()` loaders the entry's key inside the file | content entries carry `filePath`. First find out where the built data store is reachable from an integration hook (`astro:build:done`, or the `.astro/` data store). JSON data modules: record every `.json` under `src/` that a page or component imports |
| `routes.json` | pattern, page component file, dynamic or not, has `getStaticPaths` | the `astro:routes:resolved` hook |
| `schema.json` | JSON Schema per collection, with `image()` and `reference()` fields marked | Zod to JSON Schema (`z.toJSONSchema`), as AstroAdmin does. Mark images and references by inspecting the schema before conversion |

Unit-test the pure parts: manifest shaping from hook data.

### 1.4 Content overlay

Start from the spike (`.build/spike/content-shim.ts` and `build-overlay.ts`),
written properly in `src/overlay/`:

- **The import rewrite:** a `transform` hook, `enforce: 'post'`, for modules
  under the site's `src/`, except `content.config.ts`.
- **Request scope:** the overlay and the read log live in `AsyncLocalStorage`,
  not a global. Renders must not see each other's drafts. Add a test with two
  concurrent renders.
- **`getEntry`, `getEntries`, `getCollection`:** overlay entries replace or add
  built ones; `null` removes. Filters run after the overlay. Each read goes
  into the log. A `file()` loader entry is overlaid per entry, not per file.
- **JSON data modules** (`src/config/*.json`): a second `transform` turns
  each imported JSON file into a module whose default export, and each
  object-valued named export, is a `Proxy`. On property access, the proxy
  reads the overlay's `data:<path>` document if present, else the built
  value, and logs the read. **Limit:** top-level primitive named exports
  can't be proxied. Find out whether bigspring has any (`nav_button` is an
  object, so it's fine) and document the limit.
- **Raw to parsed:** drafts are file-shaped. Convert them as Astro would:
  - Run the collection's schema if it can be imported in the bundle. Try
    this first, because it gives defaults, `z.coerce.date()` and enums for
    free.
  - `image()`: today's `resolveImages`. Paths not in the build map to a media
    URL, the stopgap `/__preview-media/` for now.
  - `reference()`: a string id becomes `{ collection, id }`.
  - Strings pointing at `public/` stay strings.
- **Bodies, `render(entry)`:**
  - Markdown: render the draft body at runtime with
    `@astrojs/markdown-remark`, using the site's `markdown` config (remark
    plugins, Shiki theme). **Measure memory**, since Shiki is heavy, and
    record it.
  - MDX: **don't compile at runtime in phase 1.** It's code execution and
    needs the compiler. A draft MDX body renders the saved body, and the
    render answer says so (`limits: ["mdx-body"]`), so the editor can show
    "body preview after save". Frontmatter drafts work as usual. Ask the
    user before choosing otherwise.

### 1.5 The render route

`POST /__preview/render?path=<url path>`, contract in SYSTEM-DESIGN.md
section 3:

1. Guard as today: JSON only, refuse cross-site.
2. Match `path` against `routes.json`, respecting `base` and `trailingSlash`.
   404 if nothing matches.
3. For dynamic routes, run the page's `getStaticPaths()` **inside the overlay
   scope**, pick the entry whose params match, and use its `props`. Paths
   without `props` (`blog/page/[slug]`) just get `params`.
4. Render with the Container API:
   `renderToString(page, { params, props, request, partial: false })`. The
   `request` URL must be the real page URL, because `Header.astro` reads
   `Astro.url.pathname`. Load the site's renderers (React) into the
   container. Check `Image`, `Font` and `ClientRouter` output against the
   prerendered page.
5. Strip the dev-only script tags, as today.
6. Answer `{ html, head, documents, limits, renderMs }`, plus the
   `Server-Timing` header. Errors as in the design: 400, 404, 422, 500.

Then delete `POST /__preview/<region>` and its props contract.

### 1.6 Protocol v2 and the bridge

Protocol (`src/protocol.ts`, types plus runtime checks, as today):

| Direction | Message |
|---|---|
| page to editor | `{ type: 'preview:ready', path }` |
| editor to page | `{ type: 'preview:draft', documents: Record<string, unknown \| null> }` |
| page to editor | `{ type: 'preview:rendered', path, documents, limits, renderMs }` |
| page to editor | `{ type: 'preview:error', path, status, message }` |

Bridge (`src/client/bridge.ts`):

- **Priming:** on start, announce `ready`. The first draft message, even an
  empty overlay, triggers a render. That updates a stale prerendered page and
  tells the editor which documents the page uses.
- **Newest wins** per page, not per region.
- **Patch:** parse with `DOMParser`. For each `[data-preview-region]`, morph
  it if its HTML changed. Patch `<title>` and changed `<meta>`. If anything
  outside regions changed, morph the whole `<body>`. Use idiomorph (about
  3 KB, bundled into the bridge by Vite). Keep finishing entrance animations.
- **`ClientRouter`:** on `astro:page-load`, announce `ready` again with the
  new path.
- **Origins:** an allowed list of editor origins (from the site config, same
  origin by default). Never `'*'`.
- **Scripts:** still not re-run after a patch. Check the Swiper carousel and
  the React toggle, and document what happens. Don't fix it in phase 1
  unless it's small.

### 1.7 Test editor v2

- **Documents, not regions:** after `preview:rendered`, list the page's
  documents. Each gets a JSON textbox, or a Markdown/frontmatter textarea for
  `.md`.
- **Data source:** a dev-only route `GET /__dev/documents?key=` on the
  preview node. It returns the raw file content from the build snapshot, and
  it's injected only when `PREVIEW_DEV=1`. It's a stopgap for the CMS app's
  `GET /api/documents` (phase 2); mark it so in code and docs.
- **Overlay:** every edited document goes out on each change, after the
  120 ms pause, as today.
- **No Save button.** Saving arrives with the CMS app in phase 2.
- Keep "Reset" per document.

### 1.8 Tests

- Unit tests for every new source file. For the overlay, test the pure parts
  directly (merge, filters, log, raw-to-parsed conversion). Cover the Vite
  `transform` output with real fixture modules.
- The end-to-end suite moves to the new sample site. One test per row of
  SYSTEM-DESIGN.md section 8: render through HTTP with an overlay, then
  assert on the HTML and the `documents` list.
- Performance in the end-to-end suite: 100 edits on `landing/long`, median
  render under 5 ms, and private memory recorded.

### 1.9 Docs

- Rewrite PREVIEW-RENDER-SERVER.md for the page-render model. Keep its build,
  bundling, images and performance sections, updated.
- Update the README, this plan (status table, section 10) and the design's
  "Open questions" with what phase 1 learned.

### 1.10 Retire the old sample

Once the end-to-end suite runs on `sample-site`:

- delete `sampleAstroProject/` and `sites/sampleAstroProject.config.ts`;
- remove it from the workspaces;
- make `sample-site` the default in `npm run build` and `npm start`.

## 8. After phase 1

Phases 2 to 5 are in SYSTEM-DESIGN.md section 9: CMS app with saving and
publishing, real editor, self-host package, multi-tenant. Flesh them out here
when phase 1 is done, using what it taught.

## 9. Running things

```sh
cd astroViewCMS && npm install      # once: workspace install
cd preview-render-server
npm run build       # preview build of the sample (~25 s, only after code changes)
npm start           # http://localhost:4400, test editor at /__editor
npm run typecheck
npm test            # unit tests, ~2 s
npm run coverage    # unit tests + coverage report (reported only)
npm run test:e2e    # builds into .build/e2e-*, real server, HTTP checks (~7 s)
```

From an agent, prefix build and test commands with the `env -u …` line from
section 3.

## 10. Measurements

Baseline on the old sample, from PREVIEW-RENDER-SERVER.md and the 2026-10-26
spike:

| | Value |
|---|---|
| Preview node private memory | 78–94 MB (`astro dev`: 640–690 MB) |
| `BlockList` render, 3 blocks | 0.3 ms median |
| Whole home page render | 0.4 ms median |
| Whole page with overlay, new container per request | ~1 ms |
| Cold start to first page | ~230 ms; first render ~7 ms |
| Preview build | ~25 s |

New sample, to fill in during tasks 0.4 and 1.8:

| | Value |
|---|---|
| `astro build` (plain), pages | ~25 s, 15 pages (template as cloned) |
| Preview build | |
| Bundle size (external / bundled) | |
| Idle and after-run private memory | |
| Render median: home, blog post, `landing/long` | |
| Markdown body draft render, memory with Shiki | |
| Overlay size with 200 generated posts | |
