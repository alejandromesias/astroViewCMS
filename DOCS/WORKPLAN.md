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
| Richer sample site | `sample-site/` in the workspace with the 0.3 additions; preview-built unchanged (0.4) |
| Page render with content overlay | spike only (`preview-render-server/.build/spike/`, gitignored) |
| CMS app, saving, publishing, real editor, auth | not started (phases 2 to 4) |

Folder layout of `astroViewCMS/` (git repo on `master`, no remote):

```text
astroViewCMS/
├─ package.json             npm workspace: sampleAstroProject, preview-render-server, sample-site
├─ DOCS/                    SYSTEM-DESIGN.md, WORKPLAN.md, PREVIEW-RENDER-SERVER.md
├─ preview-render-server/   the renderer (see PREVIEW-RENDER-SERVER.md)
├─ sampleAstroProject/      old sample: one page, one island; removed in task 1.10
├─ sample-site/             the new sample (bigspring template plus additions)
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

**Result (2026-10-26).** Checked against `sample-site` after task 0.3. The
design holds. The items below are additions, not reversals.

**Decided with the user on 2026-10-26:** SYSTEM-DESIGN.md section 11, D1 to
D9 for the rows below, plus D10 (ids with slashes), D11 (MDX bodies),
D12 (image metadata in the request) and D13 (supported formats).
The phase 1 tasks below were rewritten on 2026-10-26 to follow them; each
task names the decisions it implements. If a task and a decision still
disagree, the decision wins: fix the task. The table stays as the record of
what was found.

| # | Finding | Design impact | Task |
|---|---|---|---|
| 1 | **Some JSON documents are build-time.** `theme.json` feeds the fonts in `astro.config.mjs` and the Tailwind plugin (`tw-theme.mjs`); `config.json` feeds `site`, `base` and `trailingSlash`. The overlay can't change them, so "content never needs a rebuild" is false for these | Section 3 "What still needs a rebuild" gets a line for them. `documents.json` flags a data document `buildTime: true` when a config file or plugin imports it, and the editor says "applies after rebuild" | 1.3, 3 (editor) |
| 2 | **Overlay values for Markdown documents are not just data.** `Post.astro` and `blog/index.astro` build summaries from `entry.body`, and `render()` needs the body. A bare `{...data}` overlay can't carry that | Overlay value shape: JSON documents are the raw object; `.md` and `.mdx` documents are `{ data, body }`. Update the request contract in section 3 and the editor in 1.7 | 1.4, 1.7 |
| 3 | **Collection schemas are functions.** `({ image }) => z.object(...)` for authors, testimonials and blog. The manifest and the "run the schema in the bundle" step must call it with an `image()` helper. The landing blocks are a `discriminatedUnion` and contain `reference()` inside arrays | `schema.json` generation calls schema functions with a stub `image()` that marks the field; check that `z.toJSONSchema` handles the union and the references | 1.3, 1.4 |
| 4 | **`getEntry` and `getEntries` take reference objects** (`getEntry(author)`, `getEntries(block.items)`), not only `(collection, id)` | The shim supports both call shapes, and `getEntries` over a mix of overlaid and built entries | 1.4 |
| 5 | **`image()` paths are relative to the file's folder.** For authors that is the document's folder; for `testimonials.json` (a `file()` collection) it is `src/content/`, shared by all four entries | In the media rule of section 4, "relative to the document's folder" becomes "relative to the folder of the file that holds the document" | 1.4, 2 |
| 6 | **Island bootstrap scripts are inline and emitted once.** The `astro-island` element definition and the `client:visible` directive script appear in the page before its first island. A patch must neither drop nor duplicate them. A draft that adds a pricing block to a page that had no island (for example `landing/home-v2`) would leave the new island unhydrated unless the bridge loads the scripts | The "Scripts" limit in 1.6 gets this case. Add a test: add a hydrated block to a page without one | 1.6 |
| 7 | **Listing routes compute from the whole collection.** `blog/page/[slug]` and `tags/[tag]/[...page]` call `getStaticPaths` over every post, and the render route runs it on each render | Measure with the 100 generated posts. If it is slow, cache the paths per overlay hash | 1.5, 1.8 |
| 8 | **Helper modules in `.astro` files** (`lib/contentParser.astro`: `getSinglePage` drops drafts and `-index` entries) call `getCollection` | The import rewrite also has to cover `.astro` modules, not only pages and components. A draft with `draft: true` disappears from lists, which is correct and worth a test | 1.4 |
| 9 | **Preview build with no islands still injects the old routes.** `/__editor` answers 200 and `/__preview/blocks` 404. Harmless; phase 1 replaces them | none | 1.1 |

Not found in the template, so not tested: the FAQ accordion script of the
design's section 8 (the FAQ page is static). Swiper and the React toggle cover
the "scripts and hydration" case.

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
- **Deviation, accepted 2026-10-26:** `contentDir` stays on `RegionConfig`
  and in the virtual module, marked temporary, because the POST route still
  resolves image paths with it. Task 1.5 removes it together with that route.
- **`/__preview-media/*`** stays for now, marked in code and docs as a
  stopgap until the CMS app's media staging (phase 2). Task 1.4 makes it
  answer each upload's dimensions and format (D12).

### 1.2 Rename island to region

A mechanical rename, in its own commit:

| Old | New |
|---|---|
| `islands` in the site config, `IslandConfig` | `regions`, `RegionConfig { component }`. Task 1.3 adds `buildTimeFields` |
| `data-preview-island` | `data-preview-region` |
| `virtual:preview-islands`, `virtual-preview-islands.ts` | `virtual:preview-site`, `virtual-preview-site.ts` (it will carry more than regions) |
| `.build/<site>-islands/`, `writeIslandWrappers`, `islandWrappers` | `.build/<site>-regions/`, `writeRegionWrappers`, `regionWrappers` |
| "island" in comments, README, test names | "region" |

Keep the import redirection exactly as it is; it marks any component,
including ones that load their own data.

### 1.3 Build manifests

The integration writes these next to the bundle in
`.build/<site>-manifest/`. The virtual module also exposes them to the routes.

**Status (2026-10-26): implemented.** Deviations from the text below:

- The virtual module exposes `manifestDir`, not the manifests themselves:
  `routes.json` and `documents.json` are written during and after the build,
  so the routes read them from disk when they start.
- The schema pass uses rolldown, not esbuild (esbuild isn't in the tree; Vite
  8 ships rolldown). The answer to D3's TBD is recorded there.
- Where the data store is: Astro keeps it at `<root>/.astro/data-store.json`
  (devalue format, entries carry `filePath`). It is complete in
  `astro:build:done`, where `documents.json` is written.
- `hasStaticPaths` comes from a pattern match on the page source; the hook
  does not provide it.
- The alias `resolveSpecifier` in the scan reads `paths` from the site's own
  `tsconfig.json` and does not follow `extends`.
- On sample-site the scan finds `config.json` and `theme.json` as build-time,
  and `menu.json` and `social.json` as data modules. `documents.json` has 28
  documents (without the generated posts): 4 testimonials share one file and
  carry their `entryKey`. With `buildTimeFields` from the site config,
  `config.json` lists its three `site` fields and `theme.json` is `['*']`.

| File | Contents | How |
|---|---|---|
| `documents.json` | one entry per document: key (D10: `collection/id` with slashes allowed in the id, or `data:src/config/menu.json` for JSON data modules), the file that holds it (D5), format (`json`, `md`, `mdx`, `yaml`), for `file()` loaders the entry's key inside the file, and `buildTime` plus the build-time field list (D1) | content entries carry `filePath`. First find out where the built data store is reachable from an integration hook (`astro:build:done`, or the `.astro/` data store). JSON data modules: record every `.json` under `src/` that a page or component imports |
| `routes.json` | pattern, page component file, dynamic or not, rest parameters (D10), has `getStaticPaths` | the `astro:routes:resolved` hook |
| `schema.json` | JSON Schema per collection, with `image()` and `reference()` fields marked | the CMS schema pass, flavor 1 (below) |

**The CMS schema pass (D3).** Bundle `content.config.ts` twice with esbuild,
once per stub flavor, replacing `astro:content`, `astro/loaders` and the
`image` argument with the stubs in D3's table:

- **Flavor 1** feeds `schema.json`, via
  `z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })`.
- **Flavor 2** goes into the preview bundle for the shim (task 1.4). Expose
  it through the virtual module.
- **Settle D3's TBD first:** does esbuild resolve the site's `@/` aliases
  (from `tsconfig.json`) and shared helpers? If not, run the pass through
  Vite with the site's config. Record the answer in D3.
- **Check on bigspring:** the landing `discriminatedUnion`, `reference()`
  inside arrays, and the schema functions of authors, testimonials and blog.

**Build-time data (D1).**

- Add `buildTimeFields?: Record<string, string[]>` to `SiteConfig`
  (`types.ts`): document key to field paths, with `['*']` for the whole file.
  Fill it in `sites/sample-site.config.ts` for `config.json`'s `site` fields
  and `theme.json`.
- Implement the static import scan from D1: `astro.config.*` and CSS
  `@plugin`/`@config` targets, recursively, with `es-module-lexer`. On
  bigspring it must find `config.json` and `theme.json`.
- Merge both sources into each document's `buildTime` and field list.

Unit-test the pure parts: manifest shaping from hook data, the import scan on
fixture files, and the merge of scan results with `buildTimeFields`.

### 1.3a Formats in the sample site (D13)

Add YAML to `sample-site`, so every supported format and the mixes are
covered before the overlay is built. As in task 0.3, add rather than replace.

| Addition | Tests |
|---|---|
| **`partners` collection:** `glob({ pattern: "**/*.yaml", base: "src/content/partners" })`, 3 or 4 entries with `name`, `logo: image()`, `url`, `order` and `since: z.coerce.date()` (unquoted dates in the YAML). A `partners` landing block lists them with `getCollection`, sorted by `order` | a YAML-only collection, YAML dates, `image()` in YAML |
| **`stats` collection:** `file("src/content/stats.yaml")`, 3 or 4 entries with `label`, `value` and `updated: z.date()` (not coerced). A `stats` landing block shows them | YAML `file()` entries, and D13's TBD on plain `z.date()` |
| **One author in YAML:** `src/content/authors/<name>.yaml`, after widening the authors pattern to `**/*.{json,yaml}`. One blog post references it | a collection mixing JSON and YAML, and a reference to a YAML document |
| **YAML comments** in each new file, including one inside a list | round-trip writing in phase 2 |
| Both new blocks on `landing/home-v2` | the blocks render on a page |

- Add the visual checks to `DOCS/VISUAL-CHECKS-ON-SAMPLE-SITE.md`.
- **Done when:** `astro build` passes, and `documents.json` lists the new
  documents with format `yaml`, the `stats` entries with their `entryKey`, and
  the authors collection with both formats.
- Check that `documents.json` gives each document's format from its file
  extension, and marks unsupported formats `editable: false` (D13).

### 1.4 Content overlay

**Status (2026-10-26): implemented in `src/overlay/`**, except where noted.
Verified with unit tests (fakes for `astro:content`) and with a throwaway
probe route in a real preview build of `sample-site` (draft entries, data
modules, a media-map image, a Markdown draft). There is no automated test of
the overlay inside a real build yet: task 1.5's route is the natural place.

- Not done: the `stats` collection of 1.3a (not built); YAML dates are
  covered by unit tests only. The editor's media map is task 1.7.
- Settled here and recorded in the design: D3 (stubs reach local imports), D11
  (MDX inventory), D12 (wrapper works with the Container), D13 (plain
  `z.date()` needs reviving).
- Found for **task 1.5**: rendering a page with the Container needs server
  renderers registered, or hydrated components fail with `NoMatchingRenderer`
  (React: `@astrojs/react/server.js`; MDX content needs the MDX one). Register
  those from the site's integrations.
- Bigspring has no top-level primitive in its four JSON data files, so the
  Proxy limit costs nothing there.
- Markdown draft cost: see SYSTEM-DESIGN.md section 10. **D2 is settled
  (2026-10-27): keep the plugins and Shiki. Implemented:**
  - **Language allow-list:** the build writes `code-languages.json` to the
    manifest folder (`manifest/languages.ts`: fence languages of the `.md`
    and `.mdx` files, plus `extraLanguages` from the site config).
    `overlay/markdown.ts` rewrites other fences to `text` (`languages.ts`) and
    adds `code-language:<lang>` to `limits`. Unit-tested; no real-build test of
    a `cpp` draft until task 1.5 has a route to send one through.
  - **Fallback:** if a plugin throws, the draft renders without the plugins and
    Shiki and adds `markdown-plugins` to `limits` (unit-tested with a failing
    processor). A failure while *importing* `astro.config` is not covered: that
    import is static in the virtual module and would fail the whole shim.
  - **Warm-up:** `POST /__preview/warm` (`warmup-route.ts`, 204) builds the
    renderer and loads the allowed languages. Added here because it is small;
    task 1.5 still has to make the editor call it when a session starts.

**First:** make the flavor 2 stubs reach the content config's local imports,
per the note under D3's settled TBD. Add a fixture whose helper module
imports `reference` from `astro:content`, and check both flavors on it.

**Also settle D13's TBD on YAML dates** here: does a plain `z.date()` field
accept the ISO string the overlay carries? Use the `stats` collection from
1.3a. If not, revive ISO date strings for date fields in flavor 2, and record
the answer in D13.

Start from the spike (`.build/spike/content-shim.ts` and `build-overlay.ts`),
written properly in `src/overlay/`:

- **The import rewrite (D8):** a `transform` hook, `enforce: 'post'`, for
  **every** module under the site's `src/` that Vite compiles: `.astro`,
  `.ts`, `.js`, `.tsx`, `.jsx`, `.mdx`. That includes helper modules such as
  `lib/contentParser.astro`, not only pages and components. Skip
  `content.config.*`. Log a build warning when a module outside `src/`
  imports `astro:content`, because its reads won't be overlaid.
- **Request scope:** the overlay and the read log live in `AsyncLocalStorage`,
  not a global. Renders must not see each other's drafts. Add a test with two
  concurrent renders.
- **Overlay values (D2):** JSON documents are the raw object. `.md` and
  `.mdx` documents are `{ data, body }`, and the shim exposes `entry.body`
  from the draft.
- **`getEntry`, `getEntries`, `getCollection` (D4):** every call shape:
  `getEntry(collection, id)`, `getEntry({ collection, id })`, and
  `getEntries(refs)` over a mix of overlaid and built entries, in order.
  Overlay entries replace or add built ones; `null` removes, and a missing
  entry returns `undefined`, like Astro. Filters run after the overlay. Each
  read goes into the log. A `file()` loader entry is overlaid per entry, not
  per file. Ids may contain slashes (D10).
- **JSON data modules** (`src/config/*.json`): a second `transform` turns
  each imported JSON file into a module whose default export, and each
  object-valued named export, is a `Proxy`. On property access, the proxy
  reads the overlay's `data:<path>` document if present, else the built
  value, and logs the read. **Limit:** top-level primitive named exports
  can't be proxied. Find out whether bigspring has any (`nav_button` is an
  object, so it's fine) and document the limit.
- **Raw to parsed (D3):** parse each draft with the flavor 2 CMS schema from
  task 1.3. That gives defaults, `z.coerce.date()`, enums and the site's own
  transforms and refinements. The stubs do the Astro-specific parts:
  - `image()`: resolve the path **against the folder of the file that holds
    the document** (D5), to the build-time `ImageMetadata`, or else to the
    entry in the request's media map (D12). Neither: the field fails with
    "image not found". Image refinements then run on
    real metadata.
  - `reference()`: a string or `{ id }` becomes `{ collection, id }`, and the
    id must exist in the bundle or the overlay.
  - A failed parse answers `422` with the field path. A refinement that
    throws answers `422` and adds `schema-refinement` to `limits`.
  - Strings pointing at `public/` stay strings; the schema doesn't touch
    them.
- **Media-map images bypass the optimizer (D12):** tag the metadata built
  from a map entry, and wrap the site's image service in preview builds so
  `getURL` returns the entry's `url` unchanged for tagged images. Settle
  D12's TBD here: check it works through the Container API, or record the
  string-`src` fallback as a limit.
- **Upload metadata (D12):** the stopgap upload route reads each image's
  width, height and format with `sharp` and answers
  `{ url, width, height, format }`. It stores the file only, no metadata.
  The request carries the metadata back in its media map.
- **Bodies, `render(entry)`:**
  - Markdown (D2): render the draft body at runtime with
    `@astrojs/markdown-remark`, using the site's `markdown` config (remark
    plugins, Shiki theme). Return `Content` and `headings` like the built
    version. **Measure memory**, since Shiki is heavy, and record it in
    section 10. If the cost looks too high, ask the user (D2's TBD).
  - MDX (D11): **don't compile at runtime.** A draft MDX body renders the
    saved body, and the render adds `mdx-body` to `limits`, so the editor can
    show "body preview after save". Frontmatter drafts work as usual.
  - **MDX inventory (D11):** list what the sample's MDX uses (shortcodes,
    expressions, imports, exports) and record it in D11. It's the input for
    the user's decision on the restricted renderer.

### 1.5 The render route

`POST /__preview/render?path=<url path>`, contract in SYSTEM-DESIGN.md
section 3:

1. Guard as today: JSON only, refuse cross-site.
2. Match `path` against `routes.json`, respecting `base` and `trailingSlash`.
   Rest parameters (`[...single]`) match ids with slashes (D10). 404 if
   nothing matches.
3. For dynamic routes, run the page's `getStaticPaths()` **inside the overlay
   scope**, pick the entry whose params match, and use its `props`. Paths
   without `props` (`blog/page/[slug]`) just get `params`. Time this step
   separately (D7); task 1.8 decides whether it needs the cache.
4. Render with the Container API:
   `renderToString(page, { params, props, request, partial: false })`. The
   `request` URL must be the real page URL, because `Header.astro` reads
   `Astro.url.pathname`. Load the site's renderers (React) into the
   container. Check `Image`, `Font` and `ClientRouter` output against the
   prerendered page.
   **Settle D6's TBD here:** the rendered `astro-island` elements must have
   `component-url` and `renderer-url` pointing at the built client chunks
   (`/_astro/PricingPlans.<hash>.js`), as the prerendered page does. If they
   point at source paths, map them through the build manifest. Record the
   answer in D6.
5. Strip the dev-only script tags, as today.
6. Answer `{ html, head, documents, limits, renderMs }`, plus the
   `Server-Timing` header. Errors as in the design: 400, 404, 422, 500.
   `limits` collects, per render, what it couldn't show. Values so far:
   `mdx-body` (D11), `schema-refinement` (D3), `markdown-plugins` and
   `code-language:<lang>` (D2). Define them in `protocol.ts` so new ones are
   added in one place (a template literal type for `code-language:`).

**Warm-up (D2).** `POST /__preview/warm`, same guard, empty body, answers
`204`. **Route and renderer warm-up are already in (task 1.4, `warmup-route.ts`);
what is left here is the editor calling it.** It loads the overlay route module (and with it `astro.config`) and
renders a small Markdown string, so the ~1.25 s first-draft cost is paid
before the first keystroke. The editor calls it when a session opens, while
it loads the document. Never call it at boot: static-only nodes must stay at
~79 MB. Record the RSS before and after in section 10.

Then delete `POST /__preview/<region>` and its props contract, and with them
`contentDir` on `RegionConfig` and in the virtual module (deviation noted in
1.1). Images resolve per D5 from then on.

**Deciding whether a page has `getStaticPaths`:** use the page module's
export at render time (`typeof page.getStaticPaths === 'function'`). The
manifest's `hasStaticPaths` comes from a source pattern match, which misses
forms like `export { getStaticPaths }`, so it is informational only.

**The request body (D12).** Both routes take `{ documents, media }`, not a
bare overlay. Validate the envelope before anything else and answer `400`
naming the part that failed (section 3 of the design). Tests: a non-object
body, a missing `documents`, a `documents` that isn't an object, and a
`media` entry with a non-string `url`, a zero or fractional width, or an
unknown format.

**The validate route (D3).** `POST /__preview/validate`, same guard and body
as the render route. It parses every document in the overlay with the flavor
2 schema and renders nothing. It answers `200` with `{ valid: true }`, or
`422` with `{ errors: [{ key, path, message }] }`. Read-only: it never
writes. The test editor doesn't need it in phase 1. It's the check the CMS
app calls before saving in phase 2, and its tests come now.

### 1.6 Protocol v2 and the bridge

Protocol (`src/protocol.ts`, types plus runtime checks, as today):

| Direction | Message |
|---|---|
| page to editor | `{ type: 'preview:ready', path }` |
| editor to page | `{ type: 'preview:draft', documents: Record<string, unknown \| null>, media: Record<string, MediaInfo> }` (D12) |
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
- **Hydrated components and inline scripts (D6):**
  - treat existing `astro-island` elements as opaque: morph their attributes
    only, never their children. A changed `props` re-hydrates by itself;
  - run inline scripts from the new HTML that the live page doesn't have, by
    content hash, once, as fresh `<script>` elements. Skip the ones it has.
- **Component scripts:** still not re-run after a patch (D6). Check the
  Swiper carousel and document what happens. The reload fallback is a
  phase 3 TBD; don't build it now.

### 1.7 Test editor v2

- **Documents, not regions:** after `preview:rendered`, list the page's
  documents. A JSON or YAML document gets a JSON textbox. A `.md` or `.mdx`
  document gets a frontmatter textbox, also as JSON, and a body textarea,
  sent as `{ data, body }` (D2). The test editor shows every value as JSON,
  whatever the file format (D13); dates appear as ISO strings. Writing YAML
  back is phase 2.
- **Build-time fields (D1):** documents flagged `buildTime` show "some
  fields apply after rebuild", with the field list.
- **Limits:** show each value in `limits` as a plain note, e.g. "MDX body:
  preview after save", or "`cpp` highlighted after publish" for
  `code-language:cpp`.
- **Warm-up (D2):** call `POST /__preview/warm` when the editor opens, in
  parallel with loading the documents.
- **Data source:** a dev-only route `GET /__dev/documents?key=` on the
  preview node. It returns the raw file content from the build snapshot, and
  it's injected only when `PREVIEW_DEV=1`. It's a stopgap for the CMS app's
  `GET /api/documents` (phase 2); mark it so in code and docs.
- **Overlay:** every edited document goes out on each change, after the
  120 ms pause, as today.
- **Media map (D12):** keep the `{ url, width, height, format }` of each
  upload and send the map with every draft.
- **No Save button.** Saving arrives with the CMS app in phase 2.
- Keep "Reset" per document.

### 1.8 Tests

- Unit tests for every new source file. For the overlay, test the pure parts
  directly (merge, filters, log, raw-to-parsed conversion). Cover the Vite
  `transform` output with real fixture modules.
- The end-to-end suite moves to the new sample site. One test per row of
  SYSTEM-DESIGN.md section 8: render through HTTP with an overlay, then
  assert on the HTML and the `documents` list.
- One test per decision, at least:
  - D1: `config.json` and `theme.json` come out `buildTime`, `menu.json` doesn't;
  - D2: a Markdown draft body changes the rendered post and the blog summary;
  - D3: a missing image, a deleted author and a wrong enum each answer
    `422` with the field path;
  - D12, optimizer bypass: a media entry with `url`
    `http://169.254.169.254/x.png` renders that exact string as the image
    source, no `/_image?href=` in the HTML points at it, and the server makes
    no outbound request while rendering. `GET /_image?href=<that url>`
    is refused, because the site doesn't allow that host;
  - D12: an uploaded image resolves through the media map, and an image
    refinement sees its width; the same upload without a map entry answers
    "image not found"; `/__preview/validate` agrees with the render;
  - D4: `getEntry(ref)` and `getEntries(refs)` over overlaid testimonials;
  - D5: a testimonial avatar resolves against `src/content/`;
  - D6: add a hydrated pricing block to `landing/home-v2` and check it
    hydrates; change the toggle's props;
  - D8: a post set to `draft: true` disappears from `/blog` and its tag pages;
  - D10: render `/blog/generated/post-001` with an overlay;
  - D11: an MDX body draft answers `limits: ["mdx-body"]`;
  - D13: a draft of the YAML author changes the post that references it; a
    draft of one `stats` entry changes only that entry; a partners draft
    reorders the block; the authors listing mixes JSON and YAML entries.
- Performance in the end-to-end suite: 100 edits on `landing/long`, median
  render under 5 ms, and private memory recorded.
- **D7 measurement:** generate 200 posts
  (`node scripts/generate-posts.mjs 200` in `sample-site/`) and time
  `getStaticPaths` on `/blog/page/2` and a tag page. Over 2 ms added to the
  median render: build the cache from D7. Record the numbers in section 10.

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

Work already decided for phase 2:

- **Format codecs (D13):** JSON, YAML, and Markdown and MDX frontmatter plus
  body, each parsing to a value and writing back into the original text.
  Round-trip tests on the sample's files: comments kept (including the one
  inside a list), key order kept, the body untouched when only frontmatter
  changed, one `stats` entry rewritten while the others stay byte for byte,
  no format converted, and new entries created in the collection's default
  format.

Work already decided for phase 3:

- **Markdown plugins without the whole config (D2).** A per-site setting
  that names the remark and rehype plugins and the Shiki theme, so the
  preview no longer imports `astro.config`. Measure it against the ~88 MB
  the import costs now. It also takes the integrations' code out of the
  preview bundle, which helps bundle portability below.

Known issues to carry into those phases:

- **Bundle portability (before `--bundle` in phase 4, and before bundles go
  to object storage in phase 5).** `manifestDir` and `mediaDir` are absolute
  build-machine paths baked into the virtual module, and the manifests live
  in `.build/<site>-manifest/`, outside `outDir`. A bundle copied elsewhere
  loses them. Move the manifests into `outDir` and resolve both folders
  relative to the server entry or from an environment variable.
- **`tsconfig.json` `extends`.** The import scan reads `paths` from the
  site's own `tsconfig.json` only. Astro's base configs define no `paths`,
  so this is fine for typical sites. Follow `extends` if a real site needs
  it.

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
| `astro build` (plain), pages | ~25 s cold, 15 pages (template as cloned). With task 0.3: 24 pages, ~6 s warm; with 100 generated posts: 249 pages, ~14 s, `dist` 8.6 MB |
| Preview build (`npm run build:sample`, task 0.4) | ~10 s warm (fonts and images cached), 24 pages |
| Bundle size (external / bundled) | external: server 0.6 MB (565 KB of JS), client 4.5 MB (97 files). Bundled variant: not measured (`--bundle` is a phase 4 option) |
| Idle and after-run private memory | 89 MB idle; 90 MB after fetching 8 pages (working set 96 MB). No islands, so no renders yet |
| Render median: home, blog post, `landing/long` | |
| Markdown body draft render, memory with Shiki | |
| Overlay size with 200 generated posts | |
