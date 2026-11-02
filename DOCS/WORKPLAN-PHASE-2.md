# Work plan, phase 2: `cms-server`, single tenant

Written 2026-10-31, after the user approved
[PHASE-2-DESIGN.md](PHASE-2-DESIGN.md). Steps 2.0 to 2.13 below turn that
design into tasks. The step numbers differ from the first scaffold of the
same day: git core, the read API and the front server became steps of their
own once the dependencies were worked out.

Read in this order:

1. [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md), the authority (sections 1 to 6, 9,
   11; D17 to D22 are this phase's decisions).
2. [PHASE-2-DESIGN.md](PHASE-2-DESIGN.md): what phase 2 builds and why. If
   this plan and the design disagree, fix this plan.
3. This file: steps, tasks, status, measurements.

Working rules, environment notes, gotchas and commands are in
[README.md](README.md) and apply here unchanged. Before writing code, read
[IMPLEMENTATION-RECOMMENDATIONS.md](IMPLEMENTATION-RECOMMENDATIONS.md);
before writing tests, [TESTING-RECOMMENDATIONS.md](TESTING-RECOMMENDATIONS.md).

## 1. Where we are

| | Status |
|---|---|
| Phase 2 design | approved by the user, 2026-10-31 |
| Decisions D17 to D22 | logged in SYSTEM-DESIGN section 11 |
| Steps 2.0 to 2.13 | 2.0a, 2.0d, 2.0e, 2.0f, 2.0g, 2.0h, 2.0i, 2.8a done 2026-11-01; 2.0b, 2.0c, 2.1a, 2.1b, 2.1c, 2.1d, 2.1e, 2.2a, 2.2b, 2.3a, 2.8b, 2.8c, 2.8d done 2026-11-01 (wave 3 complete); next: 2.1f alone, then 2.2c, 2.2d and 2.3b in parallel (gaps settled 2026-11-02), then 2.1g over them, then the rest of wave 4; the rest not started |

**Done when:** every row of PHASE-2-DESIGN.md section 1 passes. Section 5
below maps each row to the test that proves it.

## 2. How to read the headlines

Every step and task headline says what it waits for and what it can run next
to, so independent work can start together:

- **`after 2.3b, 2.4a`**: needs those tasks done and merged first. A task
  that lists nothing can start now (inside its step's own `after`).
  A bare step number (`after 2.2`) means every task of that step.
- **`∥ 2.2, 2.3`** (step headlines): runs alongside those steps. Inside a
  step, tasks whose `after` is satisfied are parallel by default.
- **`[build]`**: runs an Astro build, the end-to-end suite or the browser
  suite. The machine has little memory (README section 3), so run **one**
  `[build]` task at a time. Unit-only tasks parallelize freely.
- **`[user]`**: needs the user (a decision, an approval, a manual run).

Rules for running tasks in parallel:

- One git worktree and branch per task, cut from the latest `main`. Merge
  when the task's own tests and `npm run check` (fast) pass. Commits still
  wait for the user's go-ahead (README section 2).
- Tasks are sized for one agent session. A task's "Done when" is its whole
  review checklist.
- **Shared files to watch** (two parallel tasks editing them will collide,
  so serialize them or give both to one worker):
  - `preview-render-server/src/integration.ts` and the virtual module:
    2.0b, 2.0c, 2.0d, 2.8d;
  - `build.ts`, `start.ts`, `site-config.ts`: 2.0d, 2.0e, 2.8b;
  - the tool configs a new package touches (`biome.json`, `knip.json`,
    `stryker.config.json`, `scripts/check.ts`, `scripts/graph.ts`,
    `.dependency-cruiser*.cjs`): 2.0a, 2.1a, 2.1b;
  - the save pipeline: 2.5c builds it as a list of stages, and 2.6b, 2.7b
    and 2.7c each add a stage module and one line registering it, so they
    don't edit each other's code.

## 3. The dependency map

```text
 renderer side   2.0 adjustments ─────────▶ 2.8 front server ─────┐
                                                                   ▼
 foundations     2.0a ─▶ 2.1 package ─┬─▶ 2.2 codecs ─┐        2.9 node, builds,
                                      ├─▶ 2.3 git core ┼─▶ 2.5 save ─▶ overlay
 CMS core        2.0b,c,d ─▶ 2.4 read API ────────────┘     │   │        │
                                                             │   ├─▶ 2.6 delete guard
 media                          2.7a ─────────────────────────┘   └─▶ 2.7 media at save
 git flow        2.3 + 2.5 ─▶ 2.10 sync, re-apply, publish, build check
 editor          2.11a (early) ─▶ 2.11b..d (needs 2.5, 2.7a, 2.9e, 2.10d)
 close           2.12 stopgaps out, done-when tests ─▶ 2.13 measurements, docs
```

**Earliest-start waves** (a task can start in the first wave where all its
`after` tasks are in earlier waves; real schedules will be a little looser):

| Wave | Tasks |
|---|---|
| 1 | 2.0a, 2.0d, 2.0e, 2.0f, 2.0g, 2.0h, 2.0i, 2.8a |
| 2 | 2.0b, 2.0c, 2.1a, 2.8b |
| 3 | 2.1b, 2.1c, 2.1d, 2.1e, 2.2a, 2.2b, 2.3a, 2.8c, 2.8d |
| 4 | 2.1f (alone, first), 2.2c, 2.2d, 2.3b, 2.4a, 2.7a, 2.8e, 2.9b, 2.11a |
| 5 | 2.1g, 2.3c, 2.4b, 2.4c, 2.5a |
| 6 | 2.5b, 2.6a, 2.9a, 2.10a |
| 7 | 2.5c, 2.9c, 2.10b |
| 8 | 2.6b, 2.7b, 2.7c, 2.9d |
| 9 | 2.9e, 2.10c |
| 10 | 2.10d, 2.10g, 2.11b |
| 11 | 2.10e, 2.11c, 2.12a |
| 12 | 2.10f, 2.11d |
| 13 | 2.12b |
| 14 | 2.12c [user], 2.13a, 2.13b, 2.13c |

**Critical path** (the longest chain; it decides the elapsed time): 2.0a →
2.1a → 2.3a → 2.3b → 2.3c → 2.5b → 2.5c → 2.9d → 2.9e → 2.10d → 2.10e →
2.10f → 2.12b → 2.13. Waves 3 to 6 are where the most work can run at once
(up to eight tasks). The tail from wave 10 is close to linear.

---

## 4. Steps

### 2.0 Phase 1 adjustments — start now

Design 5.1. Nothing in `cms-server` reads a bundle before 2.0b to 2.0d are
done. Item 6 of the design (the front server) is step 2.8.

#### 2.0a Contract package `preview-contract` — start now · DONE 2026-11-01

- A new leaf workspace package, with the full QUALITY-TOOLING checklist
  ("Adding a workspace package"). It depends on `zod` (same major as the
  `astro/zod` the sites use) and on `preview-protocol` for `MediaInfo`.
  `preview-protocol` stays dependency-free: the bridge bundles it into
  pages, and it must not pull in Zod **(call)**.
- Move here from `preview-render-server/src/manifest/types.ts`:
  `DocumentRecord`, `RouteRecord`, `BuildTimeFields`. The renderer's file
  re-exports them, so imports don't churn.
- Add the request envelope type `RenderRequest { documents, media }` and
  Zod schemas for it and for the manifest records (`documentRecordSchema`,
  `routeRecordSchema`, `schemaJsonSchema` for `schema.json` including each
  collection's `loader`).
- Later tasks add to this package: `bundleJsonSchema` (2.0b), `revisionOf`
  (2.0c), the preview token (2.8c).
- **Parity test:** the envelope schema accepts and rejects the same cases
  as `render/envelope.ts` today (reuse its test table). The renderer keeps
  its own check for now; the point is that two readers can't drift.
- Add the rule `contract-is-a-leaf` (it imports only `preview-protocol`)
  to `.dependency-cruiser.cjs`.
- **Brief (2026-11-01):** derive `schemaJsonSchema` from what the renderer
  actually writes (`src/schema/`), don't invent a shape. Look up which Zod
  major `astro/zod` ships in the workspace and match it. No Astro builds in
  this task (unit tests and `npm run check` only).
- **Done when:** `npm run check` is green with the new package listed in
  every tool; the renderer's manifest types come from the contract; targeted
  tests of `manifest/` and `render/envelope` pass.

- **Result (2026-11-01):** `preview-contract/` exists with
  `manifest.ts`, `schema.ts`, `envelope.ts`, `json.ts` (`objectOf` helper) and
  tests; the renderer's `manifest/types.ts` re-exports the types. Zod 4
  (astro 7.4.2 declares `^4.6.6`). `npm run check` green.
  - `DocumentRecord` has no `satisfies` check against its Zod schema
    (`exactOptionalPropertyTypes` makes the optional output not match); its
    shape is covered by tests. `RouteRecord` has the check.
  - `schemaJsonSchema` is not `z.record`: that silently dropped a `__proto__`
    collection. It validates each entry and builds the result with
    `Object.fromEntries`; entries use `z.strictObject`, so writer drift fails
    loudly.
  - The parity test copies the renderer's `envelope.test.ts` cases instead of
    importing them (importing the renderer would break `contract-is-a-leaf`).
    The renderer keeps its own envelope check, as planned.
  - **Stryker follow-up done:** new root `vitest.mutation.config.ts` with
    `test.projects` (the renderer's config plus an inline `preview-contract`
    project); `stryker.config.json` points at it; `knip.json` lists it as an
    entry. A one-file run (`--mutate preview-contract/src/json.ts`) killed
    14 of 14 mutants. Closed 2026-11-01: `vitest.related: true` is kept in
    `stryker.config.json` and documented in QUALITY-TOOLING.md;
    `preview-protocol` is in `mutate` with its own project; a forced full run
    through the root config scored 92.83% (renderer 92.98%, protocol 97.22%,
    contract 83.10%). See the remark on 2.13c.
  - Two comments that named the old `.build/<site>-manifest/` folder were
    updated after 2.0d.

#### 2.0b Bundle identity — after 2.0a · DONE

- The build writes `bundle.json` `{ bundleId, siteCommit, protocolVersion,
  astroVersion, builtAt }` next to the manifests. `bundleId` is a fresh
  random id per build (`build.ts` generates it; `--bundle-id` overrides it
  for tests). `siteCommit` comes from `git rev-parse HEAD` in the site root,
  `null` outside a git checkout.
- `bundleJsonSchema` in the contract package.
- **Done when:** a build of `sample-site` writes a `bundle.json` the schema
  accepts, with `protocolVersion` equal to `PROTOCOL_VERSION`; unit tests
  cover the no-git case. [build]
- **Result (2026-11-01):** `bundleJsonSchema` (strict) in `preview-contract/src/bundle.ts`;
  `newBundleId()` (UUID), `readSiteCommit` and `astroVersion()` in the renderer's
  `src/bundle.ts`; `--bundle-id` on the build CLI (`start.ts` accepts and ignores
  it); `astro:build:done` writes `bundle.json` into the manifest folder.
  Calls: bundle ids match `^[A-Za-z0-9][\w.-]*$` (the id becomes a folder name
  later); `siteCommit` is 40 to 64 lowercase hex or null; `bundle.json` and
  `images.json` are written in their own try/catch that warns, before
  `documents.json`. Evidence: `manifest-identity` and `bundle-copy` e2e.
  Open: `PREVIEW-RENDER-SERVER.md` and the renderer README do not list
  `bundle.json` / `images.json` yet (2.13b).

#### 2.0c Revisions and the image list — after 2.0a · DONE

- `revisionOf(text)` in the contract package: SHA-256, hex, first 16
  characters.
- What gets hashed **(call, refines design 5.3)**: a document with a file
  of its own: the file's bytes. A `file()` entry: the canonical form of the
  entry's parsed value (JSON with sorted keys, dates as ISO strings), so the
  build and `cms-server` agree without sharing a codec, and formatting
  changes in the shared file don't touch other entries' revisions. Export
  `canonicalEntryText(value)` next to `revisionOf`.
- `documents.json` gets `revision` per document. The manifest also lists the
  images under `src/` as `{ path, hash }` (`images.json`), so `cms-server`
  can tell which saved images the bundle lacks (D12).
- **Done when:** the manifest of `sample-site` carries both, `testimonials`
  entries have different revisions, and editing one entry's formatting in
  the shared file changes no other entry's revision (unit test). [build]
- **Result (2026-11-01):** `revisionOf(string | Uint8Array)` and
  `canonicalEntryText` in `preview-contract/src/revision.ts`; `DocumentRecord.revision`
  is required; `ImageRecord` / `imageRecordSchema` added; `withRevisions` in the
  renderer's `manifest/documents.ts` (`shapeDocuments` stays pure);
  `images.json` is a plain array `{ path, hash }` sorted by path (no
  `imagesJsonSchema` yet). Calls: `revisionOf` takes bytes so images and binary
  documents are hashed raw; an entry with no file of its own hashes
  `canonicalEntryText` of its data from Astro's data store. Evidence: the four
  `testimonials` revisions are distinct; the reflow unit test passes.

#### 2.0d Manifests inside `outDir`, relative paths — start now · DONE 2026-11-01

- The manifests move from `.build/<site>-manifest/` into the bundle folder
  (`<outDir>/manifest/`). `manifestDir` and `mediaDir` leave the virtual
  module as absolute paths: the routes find the manifests relative to the
  server entry (`import.meta.url`).
- `mediaDir` stays only for the stopgap upload route until 2.12a removes
  it; it resolves relative to the bundle too.
- Copy the whole bundle folder to another path and start it: it must work
  (the portability check of SYSTEM-DESIGN section 12). **The other path is
  inside the workspace** (bundles resolve packages from
  `astroViewCMS/node_modules`); outside it is out of scope until phase 4.
- **Brief (2026-11-01):** the old names appear in `integration.ts`,
  `site-config.ts`, `types.ts`, `virtual.d.ts`, `media-route.ts`,
  `render/runtime.ts`, `overlay/markdown-instance.ts`, `manifest/languages.ts`
  and the tests `integration.test.ts`, `media-route.test.ts`,
  `site-config.test.ts`. Grep for the old `.build/<site>-manifest/` path in
  scripts (`measure:memory`, e2e setup, browser harness) and fix every user.
  Runs after 2.0e (shared `build.ts`, `start.ts`, `site-config.ts`).
- **Done when:** a unit test and an end-to-end test start a copied bundle
  from a different directory and the render, validate and warm routes
  answer. [build]

- **Result (2026-11-01):** the manifests live in
  `<outDir>/manifest/`, media in `<outDir>/media/`. The virtual module emits
  `bundleFolder('manifest'|'media', import.meta.url)` (new
  `src/bundle-folder.ts`, which walks up to the nearest folder holding
  `server/entry.mjs`). A new e2e test (`bundle-copy.e2e.test.ts`) copies a
  built `sample-site` bundle to `.build/bundle-copy-*/` and the render,
  validate and warm routes answer. Targeted e2e: 70 of 70.
  - **Bigger than briefed:** Astro empties `outDir` at build start, which
    would wipe the manifests now inside it. The integration turns off Astro's
    `emptyOutDir` and an `astro:build:start` hook (`clearBundle()`) clears
    `outDir` except `media/`, so stopgap uploads still survive rebuilds
    (checked by unit tests, not by hand). `schema.json` and `routes.json` are
    written in `astro:build:done`. `content-config.flavor1.mjs` now sits in
    `manifest/` and is cleared at build start.
  - The bundle-folder lookup assumes server code under `<bundle>/server/`
    (true for the Astro node adapter layout; the e2e test confirms it).
  - The copy test targets a folder inside the workspace. A bundle outside
    the workspace is untested and stays phase 4.
  - Old-path users in the e2e tests (`preview-server`, `d13-formats`),
    `preview-render-server/README.md` and `PREVIEW-RENDER-SERVER.md` were
    updated.
  - `regionsDir` stays a sibling of `outDir`.

#### 2.0e Overrides in `build.ts` and `start.ts` — start now · DONE 2026-11-01

- `--root`, `--out`, `--port` (and `--bundle-id` from 2.0b) as arguments,
  with the site config as the default. `start.ts` also takes `--out` and
  `PORT`. Everything stays made absolute in `site-config.ts` (the relative
  `outDir` gotcha).
- **Brief (2026-11-01):** `build.ts` and `start.ts` take the site config
  path as `argv[2]`, and `build.ts` reads `--dev`; the new flags coexist with
  both. `start.ts` already honors `PORT` (`??=`), so `--port` and `--out` are
  the new parts. Leave `--bundle-id` to 2.0b. State in the code what `--root`
  overrides in the site config. Runs before 2.0d.
- **Done when:** two builds of the same site into different folders, and
  two nodes on different ports, run side by side in a test. [build]

- **Result (2026-11-01):** new `src/cli-options.ts`
  (`parseCliOptions`, `parsePort`, `choosePort`); `build.ts` and `start.ts`
  take `--root`, `--out`, `--port` (and `--dev`); `loadSiteConfig` and
  `resolveSiteConfig` take a `SiteOverrides` argument. A new e2e test
  (`side-by-side.e2e.test.ts`) builds into two folders and runs two nodes on
  two ports. Unit tests 46 of 46.
  - `--root` overrides only the site config's `root`; it and `--out` resolve
    against the current folder, not the config's folder. The default output
    name follows the overridden root's folder name. `--port` applies to
    `start.ts`; `build.ts` accepts and ignores it.
  - Port precedence: `--port`, then `PORT`, then the config port.
  - Unknown flags, missing values and a second file argument throw, so
    `--bundle-id` reports "Unknown option" until 2.0b adds it.
  - `test/support/preview-server.ts` now exports `SERVER_DIR`, `childEnv`,
    `freePort` and `waitForServer` for reuse.

#### 2.0f Security review — DONE 2026-11-01, remaining ignore approved · [user]

- Look at the 6 moderate advisories from `npm install` and the osv-scanner
  ignores nobody reviewed (`postcss-selector-parser`, the four `qs`
  entries). Fix by upgrading where possible. Each remaining ignore gets a
  reason and an expiry date in `osv-scanner.toml`.
- **Done when:** `npm run audit` passes with no unexplained ignore; the user
  approves the remaining ones. Gate for 2.1a (design 5.1 item 7).
- **Result (2026-11-01):** root `overrides` in `package.json`
  pin `qs ~6.16.2` and `postcss-selector-parser ~6.1.5` (both minor bumps; the
  parents Stryker and `@tailwindcss/typography` pin the old versions
  exactly, and no newer parent exists). Five ignores removed. Remaining:
  `GHSA-g3hv-75wg-m249` (minimatch via Stryker 10.1.1, fix is major 11.0.1),
  until 2026-12-15, **approved by the user 2026-11-01**. Remarks: remove the overrides
  when Stryker and typography widen their pins; sample-site builds fine with
  the new parser (end-to-end suites pass); `npm run check` passes.

#### 2.0g Record the 5 ms render goal — DONE 2026-11-01

- WORKPLAN-PHASE-0-1.md section 10 and SYSTEM-DESIGN section 9 (phase 1
  row): the goal was measured and not met (7 to 9 ms median on
  `landing/long`), and accepted under the end-to-end budgets (60 ms median,
  100 ms p95).
- **Done when:** both documents say so, with the measurement rows linked.
- **Result (2026-11-01):** `WORKPLAN-PHASE-0-1.md` lines 229 to 231 and the
  phase 1 row of `SYSTEM-DESIGN.md` section 9 now say the goal was not met
  (7 to 9 ms median on `landing/long`) and was accepted under the 60 ms /
  100 ms budgets, linking to section 10. Remark: `WORKPLAN-PHASE-0-1.md`
  line 1294 calls the same page "44 blocks" (11.4 ms, 50 renders, no overlay)
  while the goal rows say "40-block"; different conditions, left as is.

#### 2.0h Validate tells real errors from refinements that threw — DONE 2026-11-01

- Each error in `ValidationResponse` (`preview-protocol`) gets
  `kind: 'invalid' | 'refinement-threw'`. `handleValidate` sets it; the
  render route keeps answering `422` for both.
- A response without `kind` (a bundle built before this change) is read as
  `invalid` by every consumer (conservative).
- **Done when:** unit tests in `render/handlers.test.ts` cover a refinement
  that throws, one that returns false, and a legacy response; the end-to-end
  D3 tests still pass. [build]
- **Result (2026-11-01):** `FieldError.kind?` is optional on
  the wire (`FieldErrorKind` in `preview-protocol`); `FieldIssue.kind` is
  required server-side (`overlay/errors.ts`). `content-api.ts` sets
  `refinement-threw` in the thrown-refinement catch and `invalid` elsewhere;
  `bridge.ts` reads a missing kind as `invalid`. `handlers.ts`, `editor.ts`
  (carries the field, never branches on it) and `preview-contract` (no copy
  of the shape) needed no change. Four new tests in `handlers.test.ts`, one
  in `bridge.test.ts`; `d12-media.e2e` expectations gained `kind: 'invalid'`.

#### 2.0i Pin D15 — DONE 2026-11-01

- A `documents.json` test: a collection without a loader has a schema
  entry and contributes no documents (design 4.5).
- **Done when:** the test exists and passes (`manifest/documents.test.ts`).
- **Result (2026-11-01):** `D15: a collection without a loader contributes
  no documents` at `documents.test.ts:160` (`loaderKinds` holds the
  collection as `undefined`, as `integration.ts` produces). The schema half
  was already covered by `integration.test.ts` ('writes schema.json for a
  collection that has no loader'). A temporary `notes/ghost` document made
  the test fail, then was reverted. Production code unchanged.

### 2.1 Package scaffold and guardrails — after 2.0a, 2.0f

#### 2.1a The package — after 2.0a, 2.0f · DONE

- `cms-server/` with the whole checklist (workspaces, scripts, strict
  `tsconfig.json` copied from `preview-protocol`, Biome, Knip entry points,
  Stryker globs, depcruise and graph paths, `check.ts` steps, the manual).
- Dependencies: `hono`, `zod`, `yaml`, `sharp`, `preview-protocol`,
  `preview-contract`. `.gitignore` gets `.cms/` and the test temp folder.
- `server.ts` builds the app from a `createApp(deps)` function, binds
  `127.0.0.1` only (no `host` setting), and a first route answers a JSON
  `404` for everything unknown.
- **Done when:** `npm run check` passes with `cms-server` in every tool, and
  `createApp(...).request('/nope')` answers `404` in a test.
- **Result (2026-11-01):** `cms-server/` with `createApp` in `src/http/app.ts`
  (design 5.2: only `http/` imports hono) and `startServer` in `src/server.ts`;
  checklist done (workspaces, Biome, Knip, Stryker globs and project, depcruise
  and graph paths, `check.ts`, QUALITY-TOOLING.md, `.gitignore` gets `.cms/` and
  `.test-tmp/`). Calls: hono has no Node adapter in the dependency list, so
  `server.ts` has a small Request/Response bridge over `node:http`; it buffers
  bodies, so 2.7a (media upload) must make it stream; knip ignores zod, yaml,
  sharp and the two workspace packages until 2.2 uses them; only the depcruise
  paths were added, the cms-server rules are 2.1b.

#### 2.1b Dependency rules — after 2.1a · DONE

- In `.dependency-cruiser.cjs` (design 5.11): `preview-render-server` never
  imports `cms-server` and the reverse; only `cms-server/src/git/` and
  `src/preview/` import `child_process`; only `src/http/` imports `hono`;
  `cms-server` imports `preview-protocol` and `preview-contract` only, never
  the renderer. Update the annex table of QUALITY-TOOLING.md.
- Prove each rule fails: add a violating import, see the error, remove it
  (as was done for cycles).
- Gaps settled (calls): add `cms-server` to the `from` list of
  `no-test-in-production`, and `^cms-server/` to the `to` lists of
  `protocol-is-a-leaf` and `contract-is-a-leaf`. The `depcruise` script
  already lists `cms-server/src`; update the annex intro to say so.
  `src/git/` and `src/preview/` don't exist yet: prove those two rules with a
  throwaway file at that path, then delete it. Do not create empty folders.
  Test files are exempt from the `child_process` and `hono` rules
  (`pathNot: TESTS`), since 2.1d's harness runs `git`; say so in the annex.
- **Done when:** `npm run depcruise` passes and the table lists the rules.
- **Result (2026-11-01):** four rules added in `.dependency-cruiser.cjs`:
  `renderer-never-imports-cms-server`, `cms-server-never-imports-renderer`,
  `child-process-only-in-git-and-preview`, `hono-only-in-http`; `^cms-server/`
  in `protocol-is-a-leaf` and `contract-is-a-leaf`; `cms-server` in
  `no-test-in-production`; annex table and intro updated. Proof: 7 throwaway
  violating files (every new or extended rule) gave 7 errors, each naming its rule;
  allowed-path probes in `src/git/`, `src/preview/` and `src/http/` gave none;
  all probes deleted, `npm run depcruise` exits 0. **Call:** `options.exclude`
  no longer drops `node_modules/`. An excluded package lost its edges, so the
  hono rule never fired (and the existing `node_modules/` matchers never did).
  `doNotFollow` already stops the walk there. Test files exempt via `pathNot`.
  **Review (2026-11-01):** the `exclude` change was not asked for; kept, since
  without it the new `hono-only-in-http` rule cannot fire. The renderer/cms-server
  separation became two rules, one per direction. `npm run check` passes. The
  throwaway-file proofs are the agent's report; the reviewer did not re-run them.

#### 2.1c Configuration — after 2.1a · DONE

- `cms.config.ts` per site, parsed with Zod (design 5.10): `site`, `remote`,
  `branch`, `siteDir`, `previewSiteConfig`, `origins`, `publish.buildCheck`,
  `media.folder`, `syncIntervalSeconds`, plus `collections.<name>
  .newEntryFormat` **(call: CMS-only data lives here, not in the renderer's
  site config)** and `git.author` (default `astroViewCMS <cms@localhost>`).
- Secrets (`PREVIEW_TOKEN_SECRET`, `PREVIEW_INTERNAL_SECRET`) from the
  environment, or generated and kept in `.cms/<site>/secrets.json` (mode
  600) so a restart doesn't invalidate sessions.
- Rejects: the same origin for CMS and preview, a non-http(s) origin, a
  `siteDir` that escapes the repo (`..`, absolute), an unknown `buildCheck`.
- Gaps settled (calls): the code lives in `cms-server/src/config/`: a pure
  `parseConfig(raw, env)` (Zod `strict()`, no file access), `loadSecrets(dir,
  deps)` with injected `readFile`, `writeFile`, `mkdir` and `randomBytes`, and
  a thin `loadConfig(path)` (a dynamic `import()` of the file, covered by one
  test on a temp `.ts` file). `origins.cms` and `origins.preview` must differ
  in scheme, host **or port** (`localhost:4400` vs `:4401` is fine).
  `previewSiteConfig` must also be relative and stay inside the repo.
  Secrets are 32 random bytes, hex. The `0o600` mode is asserted only off
  Windows (chmod is a no-op there and the developer machine is Windows).
  Remove `zod` from knip's `ignoreDependencies` for `cms-server` once used.
- **Done when:** tests cover defaults, each rejection and secret
  generation, with the file system injected.
- **Result (2026-11-01):** `cms-server/src/config/`: `schema.ts` (strict Zod
  schema, `parseConfig(raw)`), `secrets.ts` (`loadSecrets(dir, env, deps)`),
  `load.ts` (`loadConfig(path)`), each with its `*.test.ts` (94 pass, 1 skipped
  on win32). `knip.json`: `zod` removed from the cms-server `ignoreDependencies`.
  **Calls:** `parseConfig` takes no `env` (only the secrets read the
  environment); `env` is the second argument of `loadSecrets`, not a field of
  `deps`; `z.strictObject` is Zod's `strict()`. `collections` is built with
  `Object.fromEntries`, since `z.record` drops a `__proto__` name (the test found
  it). Checks beyond the list: `site` must be one safe folder segment (it names
  `.cms/<site>/`); `media.folder` must stay inside the site; origins are
  normalised to scheme, host and port, and a path, query, hash or credentials
  are refused; `newEntryFormat` is `json`, `md`, `mdx` or `yaml` (the formats
  the CMS creates, design 5.4). An empty environment value counts as unset. An
  existing secrets file is never replaced: only a missing file is created, and
  other read errors are rethrown. Defaults: `branch` `main`, `siteDir` `.`,
  `buildCheck` `auto`, `media.folder` `src/assets/uploads`,
  `syncIntervalSeconds` 60, `collections` `{}`, `git.author` as above. The mode
  600 is checked on the injected `writeFile` options on every platform; the
  real-file check is skipped on win32. `npm run check`: every gate passes; the
  cms-server floors hold, and the config files are at 100% in a run of their
  own tests.
  **Review (2026-11-01):** deviations from the "Gaps settled" text above:
  `parseConfig(raw)` has no `env`, and the `site`, `media.folder`, origin-shape
  and `newEntryFormat` checks were added (none asked for; all kept). **Open:**
  secrets taken from the environment are not validated (the file ones must be
  64 hex digits), so a short `PREVIEW_TOKEN_SECRET` is accepted; tighten in 2.8c,
  which first uses the token. `npm run check` passes.

#### 2.1d Git test harness — after 2.1a · DONE

- `test/helpers/`: creates a bare repo in a gitignored temp folder inside the
  workspace, seeded from `sample-site` (at the repo root, and a variant with
  the site under a subfolder for `siteDir`); `developerClone(remote)` that
  commits and pushes as a second person; cleanup.
- Gaps settled (calls): helpers in `cms-server/test/helpers/`, the harness
  test beside them as `harness.test.ts`. Add `test/**/*.test.ts` to the
  `cms-server` project's `include` (`vitest.projects.ts`), to `tsconfig.json`
  `include`, and to knip's `entry` and `project`. `test/` stays out of
  Stryker's `mutate` and of coverage (`src/**` only). Every `git` call goes
  through one `git(cwd, args)` helper using `execFile` (no shell, Windows
  paths) with `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` pointing at the null
  device, `GIT_TERMINAL_PROMPT=0`, and `-c user.name -c user.email -c
  core.autocrlf=false -c init.defaultBranch=main`, so the machine's git
  settings (CRLF, signing, credential helpers) cannot change a result. Temp
  folders go under `cms-server/.test-tmp/`, one unique folder per test, removed
  afterwards. The seed copies `sample-site` without `node_modules`, `dist` and
  `.astro`.
- **Done when:** a test seeds a remote, clones it as the developer, pushes,
  and a second clone sees the push.
- **Result (2026-11-01):** `cms-server/test/helpers/git.ts` (`git`,
  `makeTestRoot`, `removeTestRoot`, `seedRemote`, `cloneRemote`,
  `commitAndPush`, `readText`) and `harness.test.ts` (7 cases, all pass). Wiring:
  `vitest.projects.ts` include, `cms-server/tsconfig.json` include, knip
  `entry` and `project`. **Calls:** the null device is `NUL` on Windows
  (`os.devNull` is `\\.\nul`, which git rejects); inherited `GIT_*` variables
  are dropped; `-c commit.gpgsign=false` added to the listed flags. The
  developer's commit is `commitAndPush` and the second clone is `cloneRemote`,
  so `developerClone` is not a separate function. Seeding takes about 10 s on
  this machine, so the seeding cases have a 60 s timeout.
  **Review (2026-11-01):** `commit.gpgsign=false` and the `GIT_*` filter were
  not asked for; kept. The 10 s seed is mostly copying `sample-site`; if later
  git tests seed often, seed once per file (`beforeAll`) and clone from it.
  `npm run check` passes.

#### 2.1e Unified coverage run — after 2.1a · DONE

- One root Vitest config (`vitest.config.ts`) with `projects` for every
  package: the renderer keeps its own config and exclusions as one project,
  the others are inline projects (share the project list with
  `vitest.mutation.config.ts` rather than copying it). Unit tests only: the
  e2e and browser configs stay separate.
- A root `coverage` script and a `coverage floors` gate in `scripts/check.ts`
  that replace the renderer-only step. Floors are **per package** (per-glob
  `thresholds`), so a weak package cannot hide behind strong ones; set them
  just under each package's current numbers (`preview-contract`,
  `preview-protocol`, `cms-server`, renderer: keep its existing floors).
- Add the step to the QUALITY-TOOLING checklist "Adding a workspace package"
  (done when this task is written up) and update its overview and command
  tables.
- **Done when:** `npm run check` runs one coverage gate that fails when any
  package drops under its floor (prove it by raising one floor temporarily);
  the renderer's numbers match its old standalone run. 2.13c reviews the
  `cms-server` floor at the end. [unit-only]
- **Result (2026-11-01):** `vitest.projects.ts` (shared project list), root `vitest.config.ts`
  (coverage moved there from the renderer: Vitest reads coverage only from the root; HTML in
  `reports/coverage`), root `coverage` script. The gate now runs in the **fast** set:
  `unit tests + coverage` replaces the four per-package test steps (the per-package `test`
  scripts remain). Floors, from measured numbers: renderer 97 across (unchanged; 96.99%
  branches measured); protocol 98; contract lines/functions 98, branches 86, statements 96;
  cms-server lines 85, functions 98, branches 64, statements 83. Gate proven by raising a
  floor. **Found:** the renderer was already under its 97% branch floor since the wave-1
  commits, unseen because the old step ran only under `--e2e`; fixed with one front-server
  test (968/998 to 969). Open: `--e2e` and `--all` step lists not exercised yet; cms-server
  branches are at 66.67% and need tests as the package grows (task 2.1f).

#### 2.1f Verify the long check modes and lift cms-server branches — after 2.1e · [build] · DONE 2026-11-02

- Run `npm run check -- --e2e` and `npm run check -- --all` once on a quiet
  machine, since 2.1e changed their step lists (the coverage step moved into
  the fast set) and neither has run since. Fix what broke in `scripts/check.ts`
  or the docs; update the timings in QUALITY-TOOLING.md. Note any e2e flake
  (`100 consecutive edits` missed its 60 ms median in four full runs on
  2026-11-01: 68.3 after 2.8b, 71.8 after 2.8c, 62.6 during 2.8d and 68.1 in
  the review run; it passed alone each time. Decide whether the budget needs
  headroom or the test needs to run serially, and whether the front server
  added to the per-request cost; measure the test alone before and after the
  front server.)
- **Run this task first and alone** (review, 2026-11-02): it is `[build]`, and
  it settles the `100 consecutive edits` budget before anything else adds
  load. Other wave 4 tasks start after it.
- Raise `cms-server` branch coverage (66.67%, 8 of 12; the misses are in
  `server.ts`, lines 41-43 and 53, the Request/Response bridge) with tests
  that tell the branches apart, then raise the floors to match. Do not add
  tests for code that 2.7a will rewrite (the bridge buffers bodies today);
  if the bridge is about to change, defer those tests and say so.
- **Done when:** both long modes pass; the `cms-server` branch floor is raised
  to within 2 points of its measured number; the Result block records both.
- Gaps settled (calls, 2026-11-02):
  - **Where the cost comes from:** `serve/static.ts` answers only GET and HEAD, so the
    render POST never touches the disk; the front server is not the obvious cause. Check
    that first.
  - **Measuring "before the front server":** first, on today's code, time the test
    through the front server and again through the adapter handler alone (cheap, no
    second checkout). Only if that is inconclusive, build a baseline at the parent of
    `0fa7b2d` (the commit that added the front server, 2.8b) in a throwaway `git
    worktree` with **its own workspace links**. A `node_modules` junction to the main
    checkout makes Vite resolve `preview-protocol` and `preview-contract` to today's
    code, and the "before" build would not be clean.
  - **Deciding the budget, in this order:** (1) if the test passes when run serially
    (own Vitest project, or `describe.sequential` in a file of its own), stop there;
    (2) if the front server's cost is real, look for cheap per-request fixes first, such
    as building the CSP header once; (3) only then raise the budget, set from the
    measured median plus headroom, and log it as a change to PHASE-2-DESIGN 5.1 item 8
    (the 60 ms median is a regression gate, not a user-experience target).
  - **Floor:** `cms-server` branches 64 to 65 (within 2 points of 66.67). The 4 misses are in
    the bridge that 2.7a rewrites, so add **no tests** for them and say so in the Result.
  - **`npm run check`** runs the whole unit suite, as this plan asks; it overrides the
    "never the full suite" line of `CLAUDE.md` for this task only. Run it once at a time
    (two coverage runs collide on `reports/coverage`).

- **Result (2026-11-02):** run alone, nothing else running.
  - **Changed:** the three `100 consecutive edits` tests and the memory test moved
    from `preview-server.e2e.test.ts` to `test/e2e/budgets.e2e.test.ts`, unchanged. The
    shared HTTP helpers (`post`, `render`, `readJson`, `BASE`) are in `test/e2e/client.ts`.
    `vitest.e2e.config.ts` has two projects, `e2e` (`groupOrder` 1) and `e2e-budgets`
    (`groupOrder` 2), so the budget file runs last and alone. Each project has its own
    global setup, so the sample site is built twice. Budgets unchanged (median 60 ms).
    Root `vitest.config.ts`: `cms-server` branches floor 64 to 65. No tests added for the
    bridge in `server.ts` (misses at lines 41-43 and 53, rewritten by 2.7a). Biome
    `noExplicitAny` override is for `*.test.ts` only, so `client.ts` gets a `biome-ignore`
    on its parsed-JSON `any`. QUALITY-TOOLING.md: timings, file name, the 2026-11-02
    Stryker run. `scripts/check.ts`: nothing broken found in either run.
  - **Measured, `100 consecutive edits` of `landing/long`:** alone through the front server
    (filter run): render median 8.4 and 8.8 ms, round trip 11.8 and 12.6 ms. The budget
    file alone as its own project: render median 9.5 ms, p95 22.2 ms. Adapter handler
    alone (in-process bench, 3 rounds of 100): render median 9.7, 8.0, 8.1 ms; through
    the front server 6.9, 8.2, 7.2 ms. Round trip front 11.3, 14.1, 11.5 ms; adapter 15.3,
    12.1, 12.3 ms. The front server adds nothing measurable. `serve/static.ts` answers only
    GET and HEAD, so the render POST never touches the disk. The baseline at `0fa7b2d^` was
    not built: the inconclusive path was not reached.
  - **Full runs:** `npm run check -- --e2e` passed (e2e 46.7 s, 94 tests in 14 files;
    browser 33.4 s, 25 tests; unit tests and coverage 25.5 s, 1650 tests). `npm run check
    -- --all` passed every step except Stryker (see open items): e2e 46.0 s, browser 31.0 s,
    Stryker 593.6 s. No budget miss in either run. The check hides console output, so
    the values are not in the logs. Earlier misses were 68.3, 71.8, 62.6 and 68.1 ms in
    parallel runs.
  - **Decision:** step 1 of the budget order (run serially) resolved it. Steps 2 and 3
    were not needed: no front-server cost to cut, and the 60 ms budget is unchanged, so
    PHASE-2-DESIGN 5.1 item 8 is not edited. The serial fix is shown by two passing full
    runs. A miss in a parallel run was not reproduced, so the cause is inferred from the
    earlier pattern.
  - **Open, left for 2.1g:** the `--all` run is red on the Stryker step, so `npm run check -- --all`
    exits 1. Stryker scores 88.88% over 4,254 mutants,
    under the `thresholds.break` of 90. `cms-server` is 78.3% (`server.ts` 36%, `codecs`
    72.8%), code from waves 1 to 3. No `src` file changed in 2.1f. `thresholds.break` is
    unchanged. 2.1g owns this. Nothing committed. Logs: `/tmp/check-e2e-1.log`,
    `/tmp/check-all-1.log`.

#### 2.1g Stryker over the new code — after 2.1f, 2.2c, 2.2d, 2.3b · [build]

- Run Stryker (`npx stryker run`, or `npm run check -- --mutation`; see QUALITY-TOOLING.md) once over the code
  written since the last full run: `cms-server/src/codecs` (now with `frontmatter.ts`
  and `file-entries.ts`), `src/git` (now with `repo.ts`), `src/log.ts`,
  `src/config`, `preview-contract/src/token.ts`, `preview-render-server/src/serve/`
  and `preview-config.ts`. Triage the survivors, codecs first: a save that
  rewrites a file wrong corrupts the site, so kill the survivors that a real
  round trip could notice. Add the missing tests; do not change the global
  `break` threshold here (2.13c).
- Runs before 2.5a, which is the first task to save through the codecs.
- **Done when:** the survivors are killed or each is written down as
  equivalent, and the Result block gives the score per folder.
- **Heads-up, look at this first (2026-11-02):** `npm run check -- --all` is red on Stryker
  alone: 88.88% against the `break: 90` (found in 2.1f; no `src` file changed in that task).
  The drop comes from `cms-server` code from waves 1 to 3 (`server.ts` about 36%, `codecs`
  about 73%). Before the new-code triage above, read the per-file report, find where the
  score fell, and get `--all` back to green (kill survivors, or write each down as
  equivalent). `server.ts` is the bridge that 2.7a rewrites: do not add tests for it. If
  its survivors cannot be killed that way, say so in the Result and ask before touching
  `thresholds.break` (2.13c). 2.1f stays DONE with this open.

### 2.2 Format codecs — after 2.1a · ∥ 2.3, 2.1b to 2.1d, 2.0

Design 5.4, D13. Common rules for every codec: a value that equals what was
parsed returns the original text **byte for byte**; the original line endings
(LF or CRLF) are kept; a parse failure is a typed error naming the line.
Round-trip tests run on copies of the sample's own files, committed as
fixtures.

#### 2.2a JSON codec — after 2.1a · DONE

- `parse(text)` and `write(originalText, value)`: key order of existing keys,
  indentation (tabs, 2 or 4 spaces; 2 for a new file), the final newline.
- Approach **(call, the builder may differ)**: `jsonc-parser`'s `modify` and
  `applyEdits` driven by a structural diff, so untouched parts stay byte for
  byte. If a hand-written, string-aware scanner is smaller, use that
  (IMPLEMENTATION-RECOMMENDATIONS 4).
- **Done when:** unchanged value, edited scalar, added key, removed key,
  reordered array and a hostile key (`__proto__`) round-trip as stated.
- Gaps settled (calls, 2026-11-01): the code lives in `cms-server/src/codecs/`. 2.2a
  creates the shared `types.ts`, which 2.2b to 2.2d import and do not
  redefine: `interface Codec { parse(text: string): unknown; write(original:
  string, value: unknown): string }` and `class CodecError extends Error`
  with `format`, `line` and `column`.
  - **Dependency:** `jsonc-parser` is added to `cms-server`; knip and
    osv-scanner must stay clean.
  - **Parse is strict JSON** (Astro uses `JSON.parse`, so comments are an
    error). Parser errors become a `CodecError` with a 1-based line. The
    result keeps `__proto__` as an own key; the code never assigns by key
    onto a plain object (`Map`, `Object.hasOwn`, `Object.fromEntries`).
  - **Write:** an unchanged value returns the original string itself.
    Indentation is read from the first indented line (tab or N spaces, 2 when
    there is none or the text is empty); the line ending is the first one in
    the text (CRLF kept); a missing final newline stays missing, and a new
    file gets one. Existing keys keep their place whatever the order in
    `value` (object key order is not an edit; array order is). New keys go
    last; a type change replaces the whole node; arrays are diffed by index
    (shrink removes the tail, growth appends).
  - **Fixtures:** committed copies of three of the sample's `.json` files
    under `cms-server/test/fixtures/json/`, and a test that
    `write(text, parse(text))` returns `text` for each. CRLF and tab cases
    are synthetic strings in the test.
- **Result (2026-11-01):** `cms-server/src/codecs/types.ts` (`Codec`,
  `CodecError`), `json.ts` (`jsonCodec`), `json.test.ts`, `types.test.ts`, and
  fixtures `cms-server/test/fixtures/json/{config,testimonials,home-v2}.json`,
  byte copies of the sample's `src/config/config.json`,
  `src/content/testimonials.json` and `src/content/landing/home-v2.json`.
  `jsonc-parser` ^3.3.1 is a `cms-server` dependency (one line each in
  `package.json` and `package-lock.json`; it was already in `node_modules`
  through astro).
  - **Calls:** `parse` returns `JSON.parse`'s value. The error position comes
    from `parseTree` with comments and trailing commas disallowed; in a probe
    it reported an error for every input `JSON.parse` rejects. The message is
    `Invalid JSON at line L, column C: <reason>`. `write` diffs the old and new
    values (object keys through `Object.entries` and a `Map`, arrays by index),
    then applies `modify` and `applyEdits` one change at a time. Indentation
    is the first indented line's leading whitespace (tab or spaces), 2 when
    there is none. The line ending is the first one in the text. Whitespace-only
    text is a new file. `CodecError` is `(message, { format, line?, column? })`;
    `line` and `column` are undefined for write errors.
  - **Deviations:** a change of the root (type, or a scalar root that changed)
    rewrites the whole document, so whitespace in the old text is lost. An
    object key whose value is `undefined` counts as absent. An `undefined`
    array item or top-level value is a `CodecError`. `home-v2.json` was chosen
    over `long.json` (45 KB) for size.
  - **Unrequested:** `types.test.ts`, to follow the one-test-file-per-source
    rule. No other files changed.
  - **Finding:** `jsonc-parser`'s ESM build has extensionless imports and
    cannot load in plain Node ESM. The package's `main` (UMD) is what resolves,
    and named imports work from `cms-server` in Node, tsc and Vitest.
  - **Evidence:** `npx vitest run --project cms-server cms-server/src/codecs`:
    2 files, 40 tests, all pass (json 37, types 3). `write(text, parse(text))`
    returns `text` for each fixture. Each change kind is checked against an
    exact expected string. `npm run check`, second run: tsc (4 projects),
    biome lint, unit tests with coverage, depcruise and osv-scanner pass.
    knip failed once with an array-buffer allocation error and passed on a
    standalone rerun. biome format fails only on
    `preview-contract/src/token.ts`, another agent's file in progress.
  - **Open:** Stryker has not been run on the new files
    (TESTING-RECOMMENDATIONS 7).

#### 2.2b YAML codec — after 2.1a · DONE

- The `yaml` package's Document API with `merge: true` (as Astro parses, so
  `<<: *anchor` keys expand). A structural `applyValue(doc, value)` updates
  scalars in place and edits sequences item by item, so comments (including
  the one inside a list in the sample) survive.
- Dates stay as the file wrote them unless the value changed.
- **Done when:** the sample's YAML files (`partners`, `stats.yaml`, the
  YAML author) round-trip with comments, order and quoting intact after an
  edit of one field and after adding a list item.
- Gaps settled (calls, 2026-11-01): imports `Codec` and `CodecError` from 2.2a's
  `codecs/types.ts`.
  - **Parse:** `parseDocument(text, { merge: true })`; `doc.errors` (duplicate
    keys included) become a `CodecError` with the line from `linePos`. The
    value is `doc.toJS()`. A top-level value that is not a map or a sequence
    is refused with a `CodecError`.
  - **Diff against `toJS()` of the original**, not against the nodes, so
    merged keys count as present. A changed key that came in through `<<:`
    is written as an own key, which overrides the merged one. A change whose
    path goes *into* an alias node is a `CodecError` (the sample has no
    anchors: test it on a synthetic string).
  - **Sequences:** match items by deep equality first (longest common
    subsequence), so a removed or reordered item keeps its node and its
    comments; only unmatched items are replaced, inserted or deleted.
  - **Scalars:** a changed string keeps the node's quote style; a type change
    becomes a plain scalar. Equal values are not touched. **Correction
    (review, 2026-11-01):** the plan first said dates stay strings under the
    `yaml` core schema. Astro's `parseYaml` uses `schema: 'core'`,
    `customTags: ['timestamp']` and `merge: true`, so unquoted dates are
    `Date` objects; the codec uses Astro's options.
  - **Serialising:** the library re-serialises the whole document, so the
    guarantee is "the text differs only on the edited lines", tested as a
    line diff on the sample copies (not byte-for-byte globally). Use
    `lineWidth: 0` (no folding of long strings) and set `indentSeq` from what
    the original does. An unchanged value returns the original string. The
    original line ending is kept (CRLF converted back) and so is a missing
    final newline. `write('', value)` creates a block-style document.
  - **Fixtures:** the sample's YAML files under
    `cms-server/test/fixtures/yaml/`.
- **Result (2026-11-01):** `cms-server/src/codecs/yaml.ts` (`yamlCodec`) and
  `yaml.test.ts` (35 tests). Fixtures are byte copies under
  `cms-server/test/fixtures/yaml/`: `partners/{atlas,bright,loop,northwind}.yaml`,
  `stats.yaml`, `authors/noor-haddad.yaml`. No new dependency (`yaml` ^2.9.1 is
  already in `cms-server`). `types.ts` is unchanged.
  - **Deviation, dates:** the spec says the core schema leaves dates as strings,
    which Astro's loader reads. That is wrong. Astro's `parseYaml`
    (`@astrojs/internal-helpers`, used by the file loader) parses with
    `schema: 'core'`, `customTags: ['timestamp']` and `merge: true`, so an
    unquoted date is a `Date`. The stats schema's `z.date()` needs that. The
    codec uses Astro's options, so its values match what the site reads. A
    changed date is written as a date and the rest of its line, including its
    comment, stays.
  - **Deviation, parse:** an empty document (`null`) is refused with the same
    CodecError as a scalar, since it is not a map or a sequence.
  - **Calls:** diff against `toJS()` of the original. A changed merged key is
    written as an own pair. Removing a merged key is a CodecError, and so is
    any change that goes into an alias. Sequences: longest common subsequence
    keeps matched nodes. An unmatched new item equal to an unmatched old one
    takes that node, so a moved item keeps its quoting and comments. The rest
    are paired in order: containers are patched in place, scalars are updated
    or replaced, extra new items are created, extra old ones dropped. A list's
    header comment (above its first item) moves to whichever item takes the
    first place. A changed string keeps its quote style. Other changed scalars
    are replaced, carrying the inline comment: an in-place update kept `0x1F`'s
    hex format. After patching, `toJS()` must equal the value, else CodecError.
  - **Layout:** indent, `indentSeq`, line ending and final newline are read from
    the original. Known limit: 4-space indent with unindented sequences is not
    reproduced (the library indents them). Not in the sample; the tests cover
    the two layouts it does reproduce.
  - **Evidence:** targeted `npx vitest run --project cms-server
    cms-server/src/codecs`: 3 files, 75 tests pass (json 37, types 3, yaml 35).
    `npm run check`: all ten steps pass (exit 0). Coverage for
    `cms-server/src/codecs`: 99.06 lines, 93.29 branches, 100 functions, 99.47
    statements.
  - **Open:** Stryker has not been run on the new files (TESTING-RECOMMENDATIONS 7).

#### 2.2c Markdown and MDX frontmatter codec — after 2.2b · DONE 2026-11-02

- Split at the `---` fences; frontmatter through the YAML codec; the body
  written exactly as given. A file gets frontmatter only if the data isn't
  empty. A file with no fences and empty data stays as is.
- **Done when:** a frontmatter-only change leaves the body byte for byte
  (bigspring's home page is frontmatter only); a body-only change leaves the
  frontmatter byte for byte; `.md` and `.mdx` both covered.
- Gaps settled (calls, 2026-11-02): `cms-server/src/codecs/frontmatter.ts` (design 5.2)
  and `frontmatter.test.ts`. Imports `Codec`/`CodecError` from `types.ts` and `yamlCodec`
  from `yaml.ts`; defines nothing twice.
  - **Value shape:** `{ data, body }` (D2, design 5.3). `Codec` stays `parse(text)` and
    `write(original, value)`; one codec for both `.md` and `.mdx`.
  - **Fences:** do not import the regex from `preview-render-server/src/dev/documents.ts`
    (`cms-server` may not import the renderer, rule 2.1b, and that route goes away in
    2.12a). Write the codec's own, with **Astro's frontmatter parsing as the reference**,
    since the site reads the file through Astro. Cases to test: a byte-order mark, blank
    lines before the opening `---`, `---` with trailing spaces, `---\r\n` fences, `---`
    thematic breaks inside the body, empty frontmatter (`---\n---`), no fences.
  - **Parse:** a file without fences is `{ data: {}, body: text }`. **The body is exact:**
    do not strip the blank lines after the closing fence (the old `splitFrontmatter`
    does, for display). An unclosed fence, or frontmatter that is not a map, is a
    `CodecError`. So is TOML frontmatter (`+++`) or JSON frontmatter (D13). The caller
    (2.4a, 2.5a) presents that as "this document is read-only, it needs a developer", not
    as a crash.
  - **Write:** the frontmatter goes through `yamlCodec.write` on the original frontmatter
    text, so a body-only change leaves it byte for byte. YAML error lines are shifted by
    the fence offset so they point into the file. A file without frontmatter gets fences
    only if the data is not empty (D13). If the original had fences and the data becomes
    empty, the fences stay and nothing is written between them (check that the YAML
    codec gives an empty string for empty data, not `{}`). `write('', value)` works,
    because new documents arrive in 2.5a.
  - **Tests:** the `Done when` cases on byte copies of the sample's files under
    `cms-server/test/fixtures/markdown/`: `homepage/-index.md` (frontmatter only), a
    `blog/blog-*.md`, `pages/elements.mdx`. Plus a test that a body with leading blank
    lines renders the same as Astro's rendering of it (`@astrojs/markdown-remark`).

- **Result (2026-11-02):** `cms-server/src/codecs/frontmatter.ts` exports `markdownCodec`
  (`{ data, body }`, one codec for `.md` and `.mdx`), built on `Codec`/`CodecError` from
  `types.ts` and `yamlCodec`. Tests: `frontmatter.test.ts`, 28 passing (targeted run); byte
  copies of the sample's `homepage/-index.md`, `blog/blog-1.md` and `pages/elements.mdx` under
  `cms-server/test/fixtures/markdown/`. The `Done when` cases are exact-string assertions.
  - **Review fix (2026-11-02):** a BOM file without frontmatter gets the BOM before the new opening fence, not in the body; 2 regression tests, 30 passing.
  - **Dependency:** `@astrojs/markdown-remark` as a `cms-server` devDependency (`^7.3.4`, the
    hoisted 7.3.4) for the Astro reference test (`parseFrontmatter`, `createMarkdownProcessor`).
    The lockfile change is the workspace entry only. `npm` resolved `^7.3.4` to 7.3.5 and nested
    a second copy, so the range is pinned to the installed version.
  - **Deviations from the gaps block:**
    1. A closing fence must be a line of `---` (with trailing spaces or tabs). Astro's regex also
       closes on `---` inside a line; the line rule keeps the write-back on a real fence line, so a
       file Astro reads with a mid-line `---` is refused here, read-only.
    2. JSON frontmatter is refused only when it is fenced with `;;;`. Astro reads only YAML in
       `---` and TOML in `+++`, so a `{...}` block with no fence is body, as in Astro.
    3. Blank or comment-only frontmatter reads as `{}`, as in Astro. Writing data into it replaces
       the comments (no comments to keep).
    4. A body that would start a `---` block when there is no frontmatter is refused, so the
       write cannot change what the file reads back as.
  - **Not run:** `npm run check`, knip and Stryker (the coordinator's gate). The new devDependency
    is for knip to confirm, and the codec has no Stryker run yet.

#### 2.2d `file()` entry codec — after 2.2a, 2.2b · DONE 2026-11-02

- Rewrite only the entry found by `entryKey`; every other entry stays byte
  for byte. Both shapes: an array of objects with `id`, and an object keyed
  by id. JSON and YAML. Add, replace and remove an entry.
- **Done when:** editing one `testimonials` entry and one `stats` entry
  leaves the rest of each file byte for byte; removing the last entry leaves
  a valid empty container.
- Gaps settled (calls, 2026-11-02): `cms-server/src/codecs/file-entries.ts` (design 5.2)
  and `file-entries.test.ts`. It is a **thin layer over the file's own codec** (D13):
  parse the whole file, find the entry, change it, call `codec.write(original, whole)`.
  It does not edit text itself.
  - **Guarantee, reworded:** JSON: every other entry is byte for byte. YAML: only the edited
    lines differ, and an unchanged value returns the original string (the 2.2b guarantee).
  - **Entry id** (checked in `astro/dist/content/loaders/file.js`): array shape, the id is
    `(item.id ?? item.slug)?.toString()`; match on that, or entries keyed by `slug` are
    invisible. Keyed shape: the key, looked up with `Object.hasOwn` (hostile keys). A string
    entry named `$schema` is skipped by Astro; skip it too, and refuse it as a document key.
  - **Operations:** replace, add and remove. Replace or remove of a missing key is a
    `CodecError`; an add of an existing key is too. **Add** appends at the end of the array,
    or after the last key. In the array shape, `value.id` (or `slug`) must equal the key
    when present; when absent it is inserted first. A new `id` takes the type of the file's
    existing ids (number or string).
  - **Duplicate ids:** Astro throws `DuplicateContentEntrySlugError`, so that site does not
    build. Every operation on such a file, reads included, is a `CodecError`; the document
    is read-only and needs a developer (as for TOML frontmatter in 2.2c).
  - **Empty result:** removing the last entry writes `[]` or `{}` (JSON and YAML); test the
    YAML case, since the library may need a nudge to keep a valid empty container.
  - **Errors from below:** an edit that goes into a YAML alias, or removes a merged key, is
    the `CodecError` that `yamlCodec` already raises; do not catch it.
  - **Fixtures:** the sample only has array-shaped files (`testimonials.json`, `stats.yaml`),
    so add synthetic keyed-shape files (JSON and YAML) and one YAML with an alias, under
    `cms-server/test/fixtures/entries/`. A save never converts a file's format.
- **Result (2026-11-02):** `cms-server/src/codecs/file-entries.ts` (`changeEntry`,
  `EntryChange`, `EntryFormat`) and `file-entries.test.ts`; synthetic fixtures
  `cms-server/test/fixtures/entries/{keyed.json,keyed.yaml,alias.yaml}` (`alias.yaml` is keyed,
  with `home: &card` and `about: *card`). No dependency; `types.ts`, `json.ts`, `yaml.ts` unchanged.
  - **Shape:** `changeEntry(format, original, change)`. `format` is `{ name, codec }`; the name is
    the `format` of any CodecError, because `Codec` carries no name. `change` is
    `{ op: 'replace' | 'add' | 'remove', key, value }`. It parses the whole file, changes one
    entry, and calls `codec.write`. It edits no text.
  - **Calls:** array shape: the id is `(item.id ?? item.slug)` as a string, and an empty id is no
    id. Items without an id, and non-object items, are left alone, as Astro skips them. A value
    whose `id` or `slug` differs from the key is refused. A missing id is inserted first, typed as
    the file's `id`s are (a number when the file uses numbers; the key must round-trip, so `03`
    is refused). Keyed shape: `Object.hasOwn` for lookup, `Object.fromEntries` to build. `$schema`
    is refused as a key for every operation. A duplicate id is a CodecError for every operation
    (Astro's DuplicateContentEntrySlugError).
  - **Not in the block:** an `undefined` value is refused, since the JSON codec would treat it as
    an absent key. Removing a middle entry from a JSON array is diffed by index by the codec; the
    test shows the other entries stay byte for byte on `testimonials.json`, the one file checked.
  - **Evidence:** `npx vitest run --project cms-server cms-server/src/codecs/file-entries.test.ts`:
    1 file, 37 tests pass. The byte-for-byte cases pin the exact text (replace, add and remove on
    `testimonials.json` and `stats.yaml`; keyed JSON and YAML). The alias case pins the YAML
    codec's refusal. `biome lint` is clean on both files, `biome format` was applied to them, and
    `tsc -p cms-server` is clean.
  - **Fix (review, commit 4f1c744):** a replace without an id now keeps the replaced entry's id
    type, so a string id stays a string in a mixed-id array. Add keeps the file-wide guess. Three
    regression tests added; `file-entries.test.ts` has 40 tests passing.
  - **Open:** Stryker has not been run on the new files (TESTING-RECOMMENDATIONS 7). `npm run
    check` was not run, as instructed.

### 2.3 Git core — after 2.1a · ∥ 2.2, 2.1b to 2.1d, 2.0

Design 4.2. Git is the command line, run with `execFile`, never a shell.

#### 2.3a Exec wrapper — after 2.1a · DONE

- `git/exec.ts`: fixed argument arrays, `cwd`, a timeout, `GIT_TERMINAL_PROMPT=0`,
  stderr captured into typed errors. Refs, branch names and paths from
  outside go after `--` or are rejected when they start with `-`. The
  `exec` function is injected, with the real one as the default.
- **Done when:** unit tests cover argument-injection attempts, timeouts and
  error mapping with a fake `exec`.
- Gaps settled (calls, 2026-11-01): `cms-server/src/git/exec.ts` (the `child_process`
  rule already allows `src/git/`).
  - **Shape:** `type ExecFn = (file, args, { cwd, env, timeout, maxBuffer })
    => Promise<{ stdout, stderr }>`, rejecting with Node's error shape
    (`code`, `killed`, `signal`, `stdout`, `stderr`). The real one wraps
    `execFile` with `encoding: 'utf8'`, `windowsHide: true` and never a
    `shell`. `runGit(args, { cwd, timeoutMs = 60_000, env, exec = realExec })`
    returns stdout; a clone passes a longer timeout.
  - **Fixed environment and options:** `GIT_TERMINAL_PROMPT=0`,
    `GCM_INTERACTIVE=never`, `LC_ALL=C`, over the inherited environment
    (the test harness's isolation variables pass through); `-c
    protocol.ext.allow=never` before every command, because the remote URL
    comes from the config file.
  - **Validators, thrown before any spawn** as `GitError` kind
    `invalid-argument`: `assertRef` (no leading `-`, no whitespace, control
    or NUL, none of `~ ^ : ? * [ \`, no `..`, `@{`, `//`, trailing `/` or
    `.lock`), `assertRelativePath` (no NUL, not absolute, no `..` segment,
    no leading `-`; always passed after `--`), `assertRemoteUrl` (no leading
    `-`, no `ext::`).
  - **`GitError`:** `kind` is `invalid-argument | timeout | failed | spawn`
    (ENOENT is `spawn`, "git not found"; a killed child is `timeout`; a
    `maxBuffer` overflow is `failed`), plus `args`, `exitCode` and `stderr`.
    `://user:secret@` is redacted to `://***@` in the message, `args` and
    `stderr`.
  - **Tests:** the fake `exec` for everything above, plus one smoke test of
    the real default (`git --version`). Test files may use `child_process`.
  - **Not here:** credentials for private remotes. Git uses the machine's
    credential helper or SSH keys, and `GIT_TERMINAL_PROMPT=0` makes a missing
    credential fail fast. Open item for 2.3b's wrong-URL and auth errors.
- **Result (2026-11-01):** `cms-server/src/git/exec.ts` and `exec.test.ts`
  (72 tests). Exports: `ExecFn`, `ExecOptions`, `ExecResult`, `realExec`,
  `runGit`, `GitError`, `assertRef`, `assertRelativePath`, `assertRemoteUrl`.
  No dependency added.
  - **Calls:** `runGit`'s `args` on `GitError` are the caller's arguments, without
    the fixed `-c protocol.ext.allow=never` prefix. The redaction runs in the
    `GitError` constructor, so `message`, `args` and `stderr` are redacted in
    every error, including the validators'. Error kinds: a `maxBuffer` overflow
    is `failed`; a killed child is `timeout`; `ENOENT` is `spawn` ("git not
    found"); any other start failure is `spawn`; a non-zero exit is `failed` with
    `exitCode`. A rejection that is not an `Error` is `spawn`.
  - **Also:** `runGit` refuses a NUL in any argument (`invalid-argument`) before
    spawning. `assertRelativePath` also refuses an empty path, a drive-relative
    path (`C:x`), and a path with a `..` segment; `.` is accepted, since `siteDir`
    can be `.`. `assertRef` also refuses an empty name. `assertRemoteUrl` refuses
    an empty URL and `ext::` in any case.
  - **Evidence:** `npx vitest run --project cms-server cms-server/src/git`: 1 file,
    72 tests pass. The fake `exec` covers the validators (near-miss tables),
    timeouts, error mapping, redaction and the fixed environment. Real-process
    tests: `git --version` through the default, a stdout/stderr round trip with no
    shell, a killed timeout, and `ENOENT`. Lint and typecheck of `cms-server/src/git`
    are clean.
  - **Open:** Stryker has not been run on the new files (TESTING-RECOMMENDATIONS 7).

#### 2.3b Repo lifecycle — after 2.3a, 2.1c · DONE 2026-11-02

- Ensure `.cms/<site>/repo/`: clone if missing, check the `origin` URL
  matches the config, fetch, create `cms/work` from `origin/<branch>`.
- **Crash recovery (call):** on start, anything uncommitted in the working
  copy is an unfinished save (saves are atomic commits), so reset it to
  `cms/work`'s tip and log it. A leftover `cms/work-next` from an
  interrupted sync is handled in 2.10b.
- **Done when:** tests against the harness (2.1d): fresh clone, existing
  clone, wrong remote URL, a dirty tree after a simulated crash.
- Gaps settled (calls, 2026-11-02): `cms-server/src/git/repo.ts` and `repo.test.ts`, plus
  `cms-server/src/log.ts` (below). The `.cms` root is an **injected parameter** (the config
  has no such field; tests use `.test-tmp`).
  - **Shape:** `ensureRepo({ config, cmsDir, exec?, log? })` returns the repo folder, the site
    folder (`siteDir` joined once, here) and whether it recovered a dirty tree.
  - **Clone:** `.cms/<site>/repo/`, full history (no shallow clone: publish names the commit it
    overwrote, design 4.2), `--branch <branch>`, with `-c core.autocrlf=false` on the clone
    itself and in the repo config. Otherwise a clone on Windows converts LF files to CRLF
    and breaks every codec's byte-for-byte guarantee (`CLAUDE.md`: every file is LF). Use the
    longer clone timeout (2.3a: the default is 60 s; take 5 minutes).
  - **Identity, every start:** set `user.name` and `user.email` from `config.git.author` on
    every start, not only at clone, so a config change is not ignored. Also set
    `core.hooksPath` to an empty folder and `commit.gpgsign=false` on the CMS clone, so the
    user's global hooks or signing do not run on CMS commits. Keep the global config
    itself: it carries the credential helper.
  - **Existing clone:** check `origin` against `config.remote` (exact string compare of
    `git remote get-url origin`; loosen only on a real case), `fetch`, create `cms/work` from
    `origin/<branch>` only if missing. An existing `cms/work` is **never reset by a fetch**:
    it holds the saves. If HEAD is not on `cms/work` (detached or another branch), check it
    out after recovery. A leftover `cms/work-next` is 2.10b's.
  - **Wrong URL:** a hard `RepoError` kind `url-mismatch`; no repoint, no re-clone (anti-goal:
    lose saved work). The message shows both URLs, redacted, and says whether `cms/work` has
    unpublished saves (commits `origin/<branch>..cms/work`), so the developer knows
    whether deleting `.cms/<site>/repo` loses anything.
  - **Crash recovery:** `reset --hard` to `cms/work`'s tip plus `clean -fd` (ignored files
    kept), because a crash while creating a document leaves an untracked file (design 5.3
    step 5; staged media lives outside the repo, in `.cms/<site>/staging/`). Log every
    removed path. No mutex: recovery runs before the server listens (2.3c adds it).
  - **Errors:** a typed `RepoError` with kinds `auth-failed`, `remote-not-found`,
    `url-mismatch` and `failed`, classified from the `GitError`'s redacted stderr
    (stable under `LC_ALL=C`). Anything unrecognised is `failed` with that stderr. Only
    GitHub remotes (HTTPS and SSH) are classified for now; other hosts fall to `failed`.
  - **`runGit` additions** (in `git/exec.ts` and `exec.test.ts`, not in `repo.ts`):
    `GIT_ASKPASS` set to empty, and `GIT_SSH_COMMAND=ssh -o BatchMode=yes` **unless the
    environment already sets it**, so an SSH passphrase prompt cannot hang the server
    (`GIT_TERMINAL_PROMPT=0` does not stop it) and a user's own SSH options survive.
  - **Logger (convention for all of `cms-server`):** `src/log.ts` exports
    `Logger = { info, warn, error }(message, fields?)` and a default that writes one JSON
    line per event (stdout for info, stderr for warn and error). `fields` go through the same
    credential redaction as `GitError`. Inject it everywhere, with the default as the real
    one. Build logs stay in files under `.cms/<site>/logs/`; 2.9c's status route reports
    state, not log lines. About 30 lines, with its own test.
  - **Tests:** seed the remote once per file (the harness seed takes about 10 s) and clone
    per test. The four cases of Done-when, plus: `siteDir` variant, `core.autocrlf` in the
    clone, an existing `cms/work` kept across a fetch, HEAD off `cms/work`, an untracked
    file removed by recovery, and the error kinds from fake `exec` stderr.
- **Result (2026-11-02):** `cms-server/src/git/repo.ts` (`ensureRepo`, `RepoError`,
  `RepoErrorKind`, `RepoState`) and `repo.test.ts` (19 tests, real git on local bare remotes);
  `cms-server/src/log.ts` (`logger`, `Logger`, `LogField`) and `log.test.ts` (6 tests).
  `git/exec.ts` exports `redact` and sets `GIT_ASKPASS=` and `GIT_SSH_COMMAND`;
  `exec.test.ts` gains 2 tests (74 in total). No dependency.
  - **Calls:** `ensureRepo({ config, cmsDir, exec?, log? })` returns `{ repoDir, siteFolder,
    recovered }`. Any `GitError` becomes a `RepoError`: a GitHub remote's stderr is classified
    (`auth-failed`, `remote-not-found`), and everything else is `failed` with git's message and
    stderr. A non-git error passes through unchanged.
  - **Order:** the author, remote and branch are checked before any git call. For an existing
    clone the origin check comes before any change. Then the identity, hooks, gpgsign and
    autocrlf settings; `fetch origin`; `cms/work` from `origin/<branch>` if missing; the dirty
    check; `checkout --force cms/work`; `clean -fd`.
  - **Deviation, recovery order:** the block says "check it out after recovery" when HEAD is off
    `cms/work`. A reset cannot run on another branch without moving that branch, so the forced
    checkout runs first. It also discards the changes, so the end state is the same: HEAD on
    `cms/work`, a clean tree, and every path logged.
  - **Calls, others:** the paths come from `status --porcelain -z --untracked-files=all
    --no-renames`. They go out in one `warn` line, `Discarded the uncommitted changes of an
    unfinished save` with `{ paths }`. Ignored files are kept. The count of unpublished saves
    is `rev-list --count origin/<branch>..cms/work`, 0 when `cms/work` is missing, and the note
    says "could not be checked" when git cannot count. A `git.author` without `<email>` is a
    `failed` RepoError before any git call (the schema accepts any string; this check is new).
    The logger writes stdout for info and stderr for warn and error, and `redact` runs on every
    string field. `redact` stays in `exec.ts` and `log.ts` imports it, not a shared module.
  - **Deviation, tests:** the real-remote tests seed once per file in `beforeAll`, as the block
    asks. TESTING-RECOMMENDATIONS 1 asks for fixtures inside `it`. The seed runs the harness's
    git, not the code under test, so no Stryker coverage is lost.
  - **Evidence:** `npx vitest run --project cms-server cms-server/src/log.test.ts
    cms-server/src/git cms-server/src/codecs/file-entries.test.ts`: 4 files, 136 tests pass
    (repo 19, exec 74, log 6, file-entries 37). `tsc -p cms-server` is clean. `biome lint` is
    clean on the six files, and `biome format` was applied to the three new ones.
    `depcruise` on the new files printed a TypeScript-version warning and gave no usable
    result, so the full gate has to check the rules.
  - **Open:** Stryker has not been run on the new files (TESTING-RECOMMENDATIONS 7).
    `npm run check` was not run, as instructed. `cmsDir` is injected and has no caller yet
    (2.3c, 2.9). A leftover `cms/work-next` is left to 2.10b, as the block says.

#### 2.3c Mutex, commits, diffs, worktrees — after 2.3b

- One in-process async mutex around every repo operation (save, sync,
  publish) **(call; the design leaves locking to the builder)**, FIFO, with
  a timeout and the holder named in the timeout error.
- `commitSave(paths, message)`, `changedPaths()` (`origin/<branch>..cms/work`
  limited to `siteDir`), `showAt(ref, path)`, `worktreeAdd(ref, dir)` and
  `worktreeRemove(dir)`. Worktrees live in `.cms/<site>/worktrees/`, inside
  the workspace.
- `siteDir` joins every path here and nowhere else in the codebase needs to
  repeat it.
- **Done when:** tests with the harness, including a `siteDir` variant and
  two operations racing for the mutex.

### 2.4 Bundle reader and read API — after 2.0b, 2.0c, 2.0d, 2.1c · ∥ 2.2, 2.3

#### 2.4a Bundle reader and list routes — after 2.0b, 2.0c, 2.0d, 2.1c

- A `BundleSource` interface (`current(): Promise<BundleRef | null>`). Phase
  2 first implements it with an explicit directory from the config; 2.9c
  replaces it with the real one.
- Read `bundle.json`, `documents.json`, `schema.json`, `routes.json` and
  `images.json` with the contract schemas. Errors name the file and field.
  Tables keyed by document key use `Map`.
- `GET /api/schema`, `GET /api/documents?collection=` (key, file, revision,
  format, editable, build-time flags) and `GET /api/status` (first version:
  bundle id and commit).
- **Done when:** route tests with a bundle built from `sample-site`
  (committed trimmed fixture for unit tests, the real one for e2e); a
  corrupted manifest answers a clear error.

#### 2.4b Read one document — after 2.4a, 2.2

- `GET /api/documents?key=` (design 5.3): `{ key, value, revision, file,
  format, editable, buildTime, buildTimeFields }`. Reads from the working
  copy through the codecs; Markdown and MDX answer `{ data, body }` (D2);
  `file()` entries by `entryKey`. The revision comes from the working
  copy's text (`revisionOf`), not the manifest. Read-only formats answer
  their flags without a `value`, as the stopgap route does. `404` for an
  unknown key.
- The list route also fills `title` when the data has `title` or `name`.
- **Done when:** the cases of `dev/documents.test.ts` pass against the new
  route (copy them; that file is removed in 2.12a), including ids with
  slashes (D10) and hostile keys.

#### 2.4c Schema walker — after 2.4a

- `walkMarkers(collectionSchema, value, visit)` yields `{ path, marker }`
  for `cms: 'reference'` and `cms: 'image'` fields through objects, arrays,
  `oneOf` and `anyOf`, and `$ref` into `$defs` (guard against cycles). Used
  by 2.6a and 2.7b.
- **Done when:** tests on the sample's real `schema.json`: the landing
  blocks' `discriminatedUnion` with testimonial references, `authors`
  avatars, nested arrays.

### 2.5 Saving — after 2.2, 2.3c, 2.4 · ∥ 2.6a, 2.7a, 2.8, 2.9a

#### 2.5a Write planner — after 2.2, 2.4a, 2.1g

- A pure function from a change (`update`, `create` or `delete`, with its
  value) and the document's record to file operations (write text, delete
  file). Creation derives the path from the collection's loader in
  `schema.json` (`base`, `pattern`) and the id, and the format from
  `collections.<name>.newEntryFormat` or the first extension of the pattern
  (D13). Deleting a `file()` entry removes it from the shared file; a
  document that is alone in its file removes the file.
- Refuses read-only documents (`editable: false`) and a path that would
  leave `siteDir`.
- **Done when:** tests for each operation on JSON, YAML, Markdown, MDX and
  `file()` documents, a new entry in a mixed JSON and YAML collection, and
  an id with slashes.

#### 2.5b Changeset state from git — after 2.3c, 2.4b

- `GET /api/changes`: the documents that differ between `origin/<branch>`
  and `cms/work`, each with its saved value (or deleted) and its **base
  revision**, which is its revision at `origin/<branch>`. No side file:
  state lives in git so a crash can't desync it **(call)**.
- Commit messages carry trailers (`CMS-Overwrote: <key> <upstream-sha>`);
  2.10b writes them and this task reads them to fill `overwritten`.
- **Done when:** after two simulated saves to the same document the
  changeset has one entry with the original base revision; a deleted
  document and a created one appear.

#### 2.5c `PUT /api/changes` — after 2.5a, 2.5b, 2.0h

- The pipeline of design 5.3, as a list of stages sharing a context, so
  later tasks add stages without editing each other's code:
  1. parse with Zod; `Content-Type: application/json`; refuse
     `Sec-Fetch-Site: cross-site` (a small guard in `http/`, the renderer's
     is not importable); body cap 4 MiB (`MAX_BODY_BYTES`, as D16) **(call)**;
  2. `baseRevision` against the working copy: `409 conflict` with the
     current value; sending again with the new revision overwrites;
  3. *(slot for the delete guard, 2.6b)*;
  4. plan the writes (2.5a) and validate through a `PreviewClient`
     interface (`validate(documents, media)`), faked here and implemented
     in 2.9d. `invalid` errors answer `422` with field paths;
     `refinement-threw` don't block, and are remembered for the build check;
  5. *(slot for image handling, 2.7b, and warnings, 2.7c)*;
  6. write every file atomically (temp files, then renames; on any failure
     restore from git), commit on `cms/work` under the mutex;
  7. answer `200 { revisions, warnings, rebuild }`. `rebuild: true` when a
     changed field is listed in the document's `buildTimeFields` (D1).
- **Done when:** tests for a good save, two documents in one save, a stale
  revision (`409`), a `422`, a refinement that threw, a failed rename
  restoring the tree, and a build-time field.

### 2.6 Delete guard — after 2.2, 2.4c, 2.5c · ∥ 2.7, 2.8, 2.9

#### 2.6a Reference index — after 2.2, 2.4c

- For each document, the documents that point at it, built by walking every
  document's value with 2.4c. A reference is a string id or `{ id }`; the
  collection comes from the marker. API: `referrersOf(key)`,
  `update(key, value)`, `remove(key)`, `rebuild()` (startup, after a sync).
  No site code runs.
- **Done when:** tests on the sample's data: authors to posts, testimonial
  entries to landing blocks (inside the union), a self-reference.

#### 2.6b The guard in `PUT /api/changes` — after 2.5c, 2.6a

- Fills the stage-3 slot (design 4.3). A deletion with referrers answers
  `409 { error: 'referenced-by', document, referrers }`, unless the same
  changeset changes or deletes every referrer so it no longer points at the
  document. A referrer that is `editable: false` adds
  `needsDeveloper: true`. No force delete.
- **Done when (design R5):** delete an author alone: `409` listing the
  posts; delete it and clear the field in the posts: `200`; delete the
  author and the posts: `200`; a read-only referrer: `409` with
  `needsDeveloper`.

### 2.7 Media — after 2.1c · ∥ everything

#### 2.7a `POST /api/media` — after 2.1c

- Multipart upload, 10 MB cap, only image types, measured once with `sharp`
  (`limitInputPixels` kept on), stored as
  `.cms/<site>/staging/<sha256>.<ext>`, answered as `{ id, url, width,
  height, format }`. `GET /media/staging/<sha256>.<ext>` serves it with
  `X-Content-Type-Options: nosniff` and long caching; the name is a hash, so
  it can't be guessed and needs no cookie (design 5.5).
- **The upload must stream (from the 2.1a log).** `cms-server/src/http/server.ts`
  buffers request bodies today; this task replaces that bridge for the upload
  route so the 10 MB cap is enforced while reading (abort and answer `413` at
  the cap, never buffer the whole body first). Test it with an oversized
  body and a client that disconnects mid-upload. This is also the "bridge is
  about to change" case of 2.1f: do not test the buffering there.
- Metadata cache `.cms/<site>/media.json` (path or hash to `{ width, height,
  format }`), written atomically.
- **The stopgap route's tests move here** (`media-route.test.ts`),
  including the near-miss file names that must answer `404` (D15).
- **Done when:** those tests pass against the new route; a non-image, an
  oversized file and a decompression bomb are refused.

#### 2.7b Images at save time — after 2.5c, 2.7a, 2.4c

- A stage in the save pipeline. For every `image` marker whose value is a
  staging URL: copy the file into `media.folder` (named by hash, reusing an
  existing file with the same hash), write the value as a path relative to
  **the file that holds the document** (D5), and record the metadata in
  `media.json`. The media map passed to validate is `cms-server`'s own,
  never the editor's (D12).
- **Done when:** a save with an upload in an author avatar (own file) and in
  a `testimonials` entry (shared file, relative to `src/content/`) writes
  the right relative paths, and validation sees the real metadata.

#### 2.7c Warning for missing `public/` images — after 2.5c

- A stage that scans the changed documents' string values. A string that
  starts with `/`, ends in an image extension, and is not an `image()`
  field, whose file is not under `<siteDir>/public/`, adds a warning
  `{ key, path, code: 'public-image-missing' }`. It never blocks (design
  5.5).
- **Done when:** tests for a present file, a missing one, a value that only
  looks like a path, and an `image()` field (no warning).

### 2.8 Preview node front server (renderer side) — after 2.0d, 2.0e · ∥ 2.1 to 2.7

Design 5.7, D14. All of it lives in `preview-render-server`, and its
request-path rules apply (no `child_process`, no `fs` except the allowlist).

#### 2.8a Cookie and origin spike — DONE 2026-11-01, cookie decided: CHIPS · [build]

- A throwaway Chromium test (Playwright is in the repo): a parent page on
  `cms.localhost` embeds an iframe on `preview.localhost`. Check that:
  - a `Secure` cookie with the `__Host-` prefix is accepted over plain HTTP
    on `*.localhost`;
  - it is sent with the iframe's navigation and with `fetch` calls from
    inside the iframe;
  - `cms.localhost` never receives it, and `cms.localhost` cookies don't
    reach the preview;
  - `*.localhost` resolves from Chromium on Windows without a hosts entry.
- If anything fails: local TLS with mkcert, and say so in design 5.7 before
  2.1c and 2.8c settle the origins.
- **Done when:** the outcome is written into PHASE-2-DESIGN.md 5.7 (what
  works, with the exact cookie flags); the spike is deleted.
- **Result (2026-11-01):** design 5.7 has the outcome. The
  `SameSite=Lax` gate cookie is dropped in an iframe on another host
  (`cms.localhost` and `preview.localhost` are cross-site); mkcert would not
  fix that. Decision (user, 2026-11-01): `__Host-preview; HttpOnly; Secure;
  SameSite=None; Partitioned; Path=/`. A second spike confirmed in Chromium
  156 that it is stored with the CMS as partition key, sent on the iframe's
  navigation and `fetch`, and absent top-level and under another embedder.
  Design 5.7 is updated; Safari and Firefox are a phase 4 item in
  SYSTEM-DESIGN.md section 12, with one shared site as the fallback. 2.8b
  and 2.8c are unblocked.

#### 2.8b Front server — after 2.0d, 2.0e · DONE (gate is a seam until 2.8c)

- The preview build switches `@astrojs/node` to `mode: 'middleware'`. A small
  Node server (`src/serve/`) imports the built entry's `handler`, applies
  the steps of design 5.7 and `start.ts` runs it. Verify that the handler
  still serves static pages and `/_astro/*` in middleware mode.
- Environment: `PREVIEW_EDITOR_ORIGINS`, `PREVIEW_TOKEN_SECRET`,
  `PREVIEW_INTERNAL_SECRET`, `PORT`, `HOST`. Every response carries
  `Content-Security-Policy: frame-ancestors 'self' <origins>`.
- The gate is on whenever the secrets are set. With no secrets the server
  refuses to start unless `PREVIEW_INSECURE=1` **(call)**; `npm run
  start:sample`, the end-to-end setup and the browser harness set it.
- **Done when:** the existing end-to-end suite passes through the front
  server with `PREVIEW_INSECURE=1`; unit tests cover the header with and
  without extra origins. [build]
- **Result (2026-11-01):** `preview-render-server/src/serve/` (`settings`, `gate`,
  `static`, `front-server`); the adapter is in `mode: 'middleware'`
  (`build.ts`); `start.ts` refuses before loading the build, requires
  `options.mode === 'middleware'` and runs the front server. The adapter's
  static handler exists only in standalone mode, so `serve/static.ts` serves
  `client/` itself (traversal guarded). Order: CSP header, gate, static,
  handler. **The gate is a seam:** with both secrets set, `createGate` throws
  "task 2.8c not built", so a gated node cannot start until 2.8c. Calls:
  `PREVIEW_INSECURE` accepts only `'1'`, secrets win if both are set;
  `PREVIEW_EDITOR_ORIGINS` is validated as bare http(s) origins (blocks CSP
  injection via `;`); `start:sample` uses `--env-file=sites/local-insecure.env`
  (npm scripts run through cmd.exe on Windows). Test harnesses set
  `PREVIEW_INSECURE=1`. **`bundle-copy.e2e` now starts the copy through
  `start.ts --out <copy>`**, because in middleware mode `entry.mjs` no longer
  listens: a bundle is not self-running any more, the front server belongs to
  the renderer package (revisit if phase 4 wants a self-contained bundle).
  Evidence: e2e 92 tests; `100 consecutive edits` missed its 60 ms median once
  (68.3) in the full parallel run and passed alone. Open: `serve/` is not in
  the depcruise request-path rule list; README is 2.13b.

#### 2.8c Token and cookie — after 2.0a, 2.8a, 2.8b · DONE

- `mintPreviewToken` and `verifyPreviewToken` in the contract package:
  `base64url(payload).base64url(HMAC-SHA256)`, payload `{ site, exp }`,
  60 s lifetime, constant-time comparison, site match.
- The front server: `?preview_token=` is verified, `__Host-preview`
  is set (flags from the spike, about 12 h), and the request redirects to
  the same URL without the token (other query parameters kept). Every other
  request needs the cookie or `Authorization: Bearer <internal secret>`
  (constant-time), else `401`.
- **Done when:** unit tests for expiry, tampering, wrong site, a missing
  header, a token in a URL that has other parameters.
- Gaps settled (calls, 2026-11-01):
  - **Token API** (`preview-contract/src/token.ts`, exported from the index):
    `mintPreviewToken({ secret, site, ttlSeconds, now? })` and
    `verifyPreviewToken(token, { secret, site, now? })` returning `{ ok: true,
    exp } | { ok: false, reason: 'malformed' | 'signature' | 'expired' |
    'site' }`. The secret is used as UTF-8 key bytes (not hex-decoded). The
    payload is parsed with strict Zod. It is stateless: a token can be
    exchanged more than once inside its 60 s. `node:crypto` is imported, so
    the builder checks that no browser bundle imports `preview-contract`'s
    index (the bridge imports only `preview-protocol`); if one does, export
    the token from a subpath instead.
  - **The cookie value is the same kind of token**, minted with `ttlSeconds`
    43200 and `Max-Age=43200`, verified by the same function. Replaying it as
    `?preview_token=` gives nothing the cookie does not already give.
  - **The node needs its site:** a new `PREVIEW_SITE` variable, required when
    the gate is on, added to `serve/settings.ts`. Both secrets must be at
    least 32 characters. Also in `cms-server/src/config/secrets.ts`: secrets
    taken from the environment get the same 64-hex check as the file ones
    (the open item from 2.1c).
  - **Gate interface:** `allows(req): boolean` cannot redirect. It becomes
    `check(req): { action: 'allow' } | { action: 'redirect', location,
    setCookie } | { action: 'deny' }`, and `front-server.ts` carries it out.
    Update `front-server.test.ts` and `gate.test.ts`; `createGate` loses its
    "task 2.8c not built" throw.
  - **Exchange:** GET or HEAD with `preview_token` in the query. A bad,
    expired or wrong-site token is `401` (it does not fall back to the
    cookie). `Location` is relative (path plus the other parameters in their
    original order and encoding; all `preview_token` parameters dropped; no
    `?` if nothing is left), never built from `Host`. Status `303`,
    `Cache-Control: no-store` on the redirect and on every `401`. The token
    is never logged.
  - **Cookie:** `__Host-preview=<token>; HttpOnly; Secure; SameSite=None;
    Partitioned; Path=/; Max-Age=43200`. Read by exact name from the `Cookie`
    header; any valid one among duplicates is enough.
  - **Bearer:** `Authorization: Bearer <secret>` is compared as SHA-256
    digests with `timingSafeEqual`, and bypasses the cookie on every path.
  - **Also in this task:** add `preview-render-server/src/serve/` to the
    request-path depcruise rules (open item from 2.8b); `static.ts` is the
    one allowed `fs` user there, listed with a comment. Tests drive the real
    gate through `createFrontServer` with `fetch(..., { redirect: 'manual' })`.

- **Result (2026-11-01):** built `preview-contract/src/token.ts` (`mintPreviewToken`,
  `verifyPreviewToken`, exported from the index); the gate in `serve/gate.ts` is
  `check(req)` returning `allow`, `redirect` (303 with `Set-Cookie`) or `deny`
  (401), and `front-server.ts` carries it out, with `Cache-Control: no-store` on
  the 303 and on every 401; `serve/settings.ts` requires `PREVIEW_SITE` when the
  gate is on and a 32-character minimum on both secrets; `createGate` no longer
  throws the "not built" error; `cms-server/src/config/secrets.ts` checks env
  secrets as 64 hex digits; `serve/` is in `REQUEST_PATH` with `serve/static.ts`
  on the fs allowlist, and the annex row and the request-path paragraph in
  QUALITY-TOOLING.md are updated.
  Calls: time is Unix seconds; the token is HMAC over the payload part with the
  secret as UTF-8 bytes; the signature is checked before the payload is read, and
  expiry (`now >= exp`) before the site. Every `preview_token` in an exchange must
  verify (a bad one gives 401, no cookie fallback); all are dropped from the
  `Location`. The Location is the normalised path plus the other raw segments in
  order (empty segments dropped, token names matched after decoding), so a
  `//host` target gives only its path. A target URL cannot parse is 401. Only GET
  and HEAD exchange. The internal bearer is checked first, on every path (SHA-256
  digests, `timingSafeEqual`). The cookie is found by exact name, and any valid
  duplicate is enough. `createGate(settings, deps)` takes an optional `{ now }`
  with the real clock as the default; `Gate` requests are
  `Pick<IncomingMessage, 'method' | 'url' | 'headers'>`, so tests pass plain
  objects.
  Deviations: none in the named API. Shared secrets are compared by length first
  only in the token module (the bearer compares digests, so length does not leak).
  Unrequested: corrected the stale "gate not built" comments in
  `sites/local-insecure.env` and `test/support/preview-server.ts`; updated the
  status row at the top of this file; `token.test.ts` cases use an HMAC oracle
  built in the test; `secrets.test.ts` env values changed to valid hex.
  Evidence: `preview-contract` `token.test.ts` and `index.test.ts`, 34 passed;
  `preview-render-server` `src/serve`, 105 passed (4 files, including the real
  gate over HTTP with `redirect: 'manual'`); `cms-server` `secrets.test.ts`, 25
  passed and 1 skipped (the POSIX-only mode test). Gates: depcruise, knip,
  biome lint and format on my files, tsc for contract and cms-server, and osv
  pass. The full `npm run check` is **not green** because of work outside this
  task: the parallel 2.8d change to the bridge and its tests
  (`bridge.ts`, `bridge.test.ts`, `preview-config.test.ts`,
  `test/e2e/config-route.e2e.test.ts`, two cases in `integration.test.ts`) fails
  tsc, format, and 2 unit tests. The preview-render-server e2e suite had one
  timing miss (`100 consecutive edits`, 71.8 ms against 60 ms) and passes when
  its file runs alone (50 of 50). The browser suite has 25 failures ("not
  settled yet": the bridge never sends its second `ready`) that come from the
  2.8d bridge and harness wiring. The `/__preview/config` route answers through
  the front server with the harness origin, so the gate is not the cause. I did
  not confirm the browser suite against a pre-2.8c baseline.
  Open: cms-server does not mint the token yet (2.8d/2.8e), and its `site` must
  match `PREVIEW_SITE`; no client file imports the contract index, but depcruise
  does not enforce that (the index is outside `client-stays-browser-safe`); a
  token secret equal to the internal secret is not refused; Safari and Firefox
  are untested (phase 4).

#### 2.8d Config route and bridge — after 2.8b · DONE

- `GET /__preview/config` answers `{ editorOrigins }` from the environment
  at run time (injected route).
- The bridge fetches it before its first `ready`, drops a `preview_token`
  parameter from the `path` it sends, and keeps its `event.source ===
  window.parent` check and its "never `'*'`" rule.
- Remove `SiteConfig.editorOrigins` and the argument of `bridgeScript()`;
  update `bridge.test.ts`, `integration.test.ts`, the end-to-end tests and
  the browser harness config.
- **Done when:** the bridge tests and the browser suite pass with origins
  coming from the route. [build]
- Gaps settled (calls, 2026-11-01):
  - **The bridge already strips a `token` query parameter** (`pathWithoutToken`
    in `bridge.ts`), which is not the parameter the design names. It becomes
    `preview_token` (a site's own `token` parameter must reach the editor
    untouched). The builder checks where `token` came from, changes the
    tests, and says what it found.
  - **Route:** `src/preview-config-route.ts`, injected with `injectRoute`
    like the other preview routes, for build and dev (in dev with no front
    server the variable is unset and the answer is `[]`). It reads
    `process.env.PREVIEW_EDITOR_ORIGINS` on each request through one shared
    parser exported from `serve/settings.ts` (the CSP code uses the same
    one), answers JSON with `Cache-Control: no-store`, and `500` for an
    invalid value. The pure handler is unit-tested; the route file itself is
    excluded from coverage and Stryker like its siblings and proved by the
    end-to-end suite.
  - **Bridge:** it fetches `/__preview/config` first. Entries that are not
    exact origins (`new URL(x).origin === x`, http or https) are dropped. If
    the fetch fails, is not `200`, or the JSON is invalid, the bridge **fails
    closed**: it logs once, sends no `ready` and answers nobody. `startBridge`
    loses `options.editorOrigins`; the tests pass a fake `fetchImpl`.
  - **Harness:** the browser harness starts the node with
    `PREVIEW_EDITOR_ORIGINS=<HARNESS_ORIGIN>` instead of
    `site.config.ts`'s `editorOrigins`. The builder lists the docs that still
    mention `editorOrigins` for 2.13b; it does not rewrite them here.
- **Result (2026-11-01):** the route `GET /__preview/config` (`src/preview-config.ts`
  pure handler, `src/preview-config-route.ts` wrapper, injected in
  `integration.ts`). `parseEditorOrigins` is exported from `serve/settings.ts`
  (the CSP uses it too). `SiteConfig.editorOrigins` and the `bridgeScript()`
  argument are gone. The bridge fetches the origins first, keeps only exact
  http(s) origins, fails closed (logs once, no `ready`, no listeners), and
  drops `preview_token` from its paths.
  - **The `token` parameter, where it came from:** not the design's name. The
    phase 1 D14 work (commit af262b6, 2026-10-30) wrote the bridge's
    `pathWithoutToken` and its tests with `token`, before the gate existed.
    The gate (2.8c, `gate.ts`), PHASE-2-DESIGN 5.7 and SYSTEM-DESIGN's D14
    all name `preview_token`. The stripping therefore never matched the real
    token parameter. The function is now `pathWithoutPreviewToken`, drops
    `preview_token` in every form, and leaves a site's own `token` untouched
    (a near-miss test pins that).
  - **Ordering change found by the browser suite:** a first attempt fetched
    the origins before attaching listeners. The first load's `astro:page-load`
    then fired during the read and its second `ready` was lost; the harness
    (and D14's priming) wait for two. Listeners now attach first; a navigation
    during the read owes one `ready`, sent when the origins arrive.
  - **Also:** `startBridge` is async and resolves to the stop function or null.
    `bridgeScript()` takes only the file. The browser harness passes
    `PREVIEW_EDITOR_ORIGINS=<HARNESS_ORIGIN>` through the new `serverEnv`
    argument of `startPreviewServer`; the e2e global setup passes two origins.
    `knip.json`, the coverage excludes and Stryker name the new route file.
  - **Docs still mentioning `editorOrigins` (not rewritten, for 2.13b):**
    `preview-render-server/README.md:49`, `DOCS/PREVIEW-RENDER-SERVER.md`
    lines 67, 145, 160 and 310, `DOCS/QUALITY-TOOLING.md:355`, and
    `DOCS/PHASE-2-DESIGN.md:510` (describes the removal, so it is current).
    `DOCS/SYSTEM-DESIGN.md:1334` and `DOCS/WORKPLAN-PHASE-0-1.md` are history.
  - **Evidence:** `preview-render-server` unit tests: `bridge.test.ts`,
    `integration.test.ts`, `preview-config.test.ts`, `serve/settings.test.ts`
    pass (176 tests). Typecheck clean. Browser suite (`npm run test:browser`):
    10 files, 25 tests pass. e2e: `config-route.e2e.test.ts` (2) passes;
    `d9-old-routes` and `preview-server` pass, except one performance budget
    (median 62.6 ms against 60 ms) that passed on rerun alone. `npm run check`:
    all ten steps pass.
  - **Open:** `sites/local-insecure.env` sets no `PREVIEW_EDITOR_ORIGINS`, so a
    local `start:sample` takes no editor (as before this change). Stryker has not
    been run on the new files.

#### 2.8e End-to-end proof — after 2.8c, 2.8d, 2.8a

- Against a real build: the frame-ancestors header on a prerendered static
  page, `401` without the cookie, the token exchange and redirect, the
  internal bearer on `/__preview/validate`, an expired token.
- **Done when:** these tests are in the end-to-end suite and pass. The
  "never `'*'`" rule of the bridge stays. [build]
- **Done at review (2026-11-02):** `readGate` refuses `PREVIEW_TOKEN_SECRET`
  equal to `PREVIEW_INTERNAL_SECRET` (with a test), and depcruise's
  `client-stays-browser-safe` now also forbids `client/` importing
  `preview-contract` (proved with a throwaway file). `cms-server` has no
  internal secret yet: 2.9b, which adds it, must generate it distinct from
  `previewTokenSecret` and test that.

### 2.9 Node supervision, builds and the overlay — after 2.8, 2.3c, 2.5c · ∥ 2.6, 2.7, 2.10a

Design 4.4, 5.6.

#### 2.9a Build runner — after 2.0e, 2.3c · [build]

- Runs `preview-render-server/src/build.ts` as a child process on a git
  worktree of one commit (never the live working copy, which saves keep
  writing), into `.cms/<site>/bundles/<bundleId>/`. The child's environment
  is an allowlist (path, temp folders, `NODE_OPTIONS`); no `SSH_AUTH_SOCK`,
  no `GIT_*`, no tokens, no `cms-server` secrets (design 4.4).
- One build at a time. A trigger during a build queues one more; further
  triggers merge into it. A timeout. The log goes to
  `.cms/<site>/logs/`; the result is `{ bundleId, dir, ok, firstError }`
  with the first failing file and message.
- Garbage-collects old bundles, keeping the last two and the last good one.
- **Done when:** a build of a worktree of the seeded remote succeeds; a
  commit with a broken component fails with its `firstError`; a leaked
  secret in the parent environment is absent in the child (test); queue
  merging with a fake build function.

#### 2.9b Node supervisor — after 2.8c, 2.0e

- Starts the front server as a child process with the environment of design
  5.6. Readiness: polls `GET /__preview/config` with the internal bearer.
  Crashes restart with backoff (1 s, 2 s, 4 s, then up to 30 s); after 5
  failures in a row the state is `failed`.
- Swap on the same port: stop the old node (terminate, then kill after a
  grace period), start the new one, wait for ready. Stop the child when
  `cms-server` exits. A port already in use at start is an error that names
  the port.
- **Done when:** tests with a fake child covering backoff and the failure
  limit; an end-to-end test that swaps between two real bundles and sees the
  new `bundleId` served on the same port. [build]

#### 2.9c State, triggers and status — after 2.9a, 2.9b, 2.4a

- `.cms/<site>/state.json`, written atomically: current and last-good
  bundle, protocol-rebuild attempts per `bundleId`.
- The real `BundleSource`. The start-up sequence: load the state, start the
  current bundle's node, or build if there is none.
- Triggers from design 4.4 that are known here: no bundle, a save with
  `rebuild: true`, a protocol mismatch (compare `bundle.json`'s
  `protocolVersion` with the server's `PROTOCOL_VERSION`, at most once per
  `bundleId`), and a publish. The sync trigger arrives in 2.10a.
- `GET /api/status` in full (design 5.6): bundle id and commit, build state,
  node state, last sync, changeset size, and errors (`protocolMismatch`,
  `upstreamBuildFailed`).
- **Done when:** a test per trigger with fakes; the mismatch rebuild happens
  once and then reports the error. A bundle built before this phase (no
  `bundle.json`) counts as a mismatch.

#### 2.9d Preview client — after 2.9b, 2.5c

- The real `PreviewClient`: `validate` and `warm` over HTTP to `127.0.0.1`
  with the internal bearer, timeouts, and Zod-parsed responses (`kind`
  defaults to `invalid`). If the node isn't ready, saves answer `503
  preview-unavailable` with a plain message.
- **Done when:** the save pipeline runs against a real node: a save with a
  valid change, a `422` from the real validate. [build]

#### 2.9e Overlay, preview URL, warm-up — after 2.9c, 2.9d, 2.7a, 2.5b

- `GET /api/overlay`: `{ documents, media }`. Documents whose working-copy
  revision differs from the bundle's `documents.json` (deleted ones as
  `null`, new ones included); media entries of `media.json` that the
  bundle's `images.json` lacks.
- `GET /api/preview-url?path=`: the path must start with a single `/` (no
  scheme, no `//host`, no backslashes); the answer is the preview origin
  plus the path plus a fresh 60 s token. The first call of a session (none
  in the last 30 minutes, **call**) also calls `warm`, not the browser.
- **Done when (design R1, at HTTP level):** save two documents, read the
  overlay, post it to the preview's render route, and the HTML shows the
  saved content with no rebuild; a hostile `path` is refused. [build]

### 2.10 Sync and publish — after 2.3c, 2.4a, 2.5 · ∥ 2.6, 2.7, 2.8, 2.9

Design 4.2, 4.4. The scenarios of 2.10b are the heart of this phase.

#### 2.10a Sync — after 2.3c, 2.4a

- `fetch`; if `origin/<branch>` moved, report how: **content-only** when
  every changed path lies in a directory that holds a current document, has
  a content or image extension, and is not a build-time document;
  otherwise **code** (erring toward a rebuild; the design leaves the
  definition to the builder). A code change raises the rebuild trigger of
  2.9c.
- A network error is a `syncError` in the status, not a crash.
- **Done when:** tests with the harness: no change, a content-only push,
  a push that edits `content.config.ts`, one that edits `theme.json`
  (build-time), one that adds a new document.

#### 2.10b Re-apply the saved documents — after 2.5a, 2.5b

- Rebuild `cms/work` as the new `origin/<branch>` plus the saved changeset,
  per document (design 4.2). **Crash-safe:** build `cms/work-next` first,
  commit, then move `cms/work` to it, keeping `cms/work-prev` until the move
  succeeds; start-up finishes or discards a leftover.
- For each saved document, write its saved value into the **upstream**
  text with its codec (a `file()` entry changes only itself). If upstream's
  revision differs from the base the save started from, record it as
  overwritten with the upstream commit in a commit trailer, carrying over
  the trailers of earlier syncs. Saved images (paths under `media.folder`)
  are restored from the old branch.
- **Scenarios, one test each:** the developer edits another document; edits
  another field of the same document (the CMS version wins whole); edits
  another entry of the same `file()` file (both survive); deletes a document
  the CMS edited (recreated); edits a document the CMS deleted (stays
  deleted); reformats the file (the codec writes into the new formatting);
  pushes nothing relevant (no-op); a crash after `cms/work-next` is made.
- **Done when:** all of those pass against the harness.

#### 2.10c Guard recheck after a sync — after 2.6b, 2.10b

- After a re-apply, rebuild the reference index and run the delete guard
  over the whole changeset against the new upstream (a developer may have
  added a new referrer).
- **Done when:** upstream adds a post that references an author the CMS
  user deleted: the next publish answers `409 referenced-by`.

#### 2.10d Publish — after 2.10a, 2.10c, 2.9c, 2.9d

- `POST /api/publish` (design 4.2): sync; validate the whole changeset
  against the node of the current bundle (waiting for a running rebuild up
  to 120 s, else `503 build-in-progress`); squash into one commit on top of
  `origin/<branch>` on a temporary branch, with the message `cms: publish N
  documents (overwrote <key> from <sha>, …)` and the configured author;
  push without force; if rejected because the remote moved, sync and try
  again, at most 3 times, then `502` and the saves stay saved; on success
  move `cms/work` to the pushed commit, clear the changeset, trigger a
  rebuild.
- Answers: `200 { commit, overwritten }`, `422`, `424 build-failed` (2.10e),
  `409` for the guard, `502`. Publish and save share the mutex.
- **Done when (design R3, R4):** a publish creates one commit on the remote;
  after the developer pushed a change to a document the CMS had saved, the
  CMS version reaches the remote and the message names the overwritten
  document and commit; a push race ends in a retry that succeeds, and a
  permanent race in `502` with nothing lost. [build]

#### 2.10e Build check — after 2.9a, 2.10d

- `publish.buildCheck` (`always`, `auto`, `never`; design 4.4). `auto`
  builds first when: an MDX body changed, a build-time field changed, a
  validation hit `refinement-threw`, or code moved upstream since the
  current bundle.
- The candidate is the squashed commit, built in a worktree **before** the
  push and pushed only if the build passes; the same commit is pushed, so
  what was checked is what ships. When it passes, its bundle becomes the
  current one (one build, not two). When it fails: `424 build-failed` with
  `firstError`, nothing pushed, `cms/work` untouched, the log in
  `.cms/<site>/logs/`.
- **Done when (design R6):** a changeset that breaks the build (a draft MDX
  body with an invalid component) is not pushed under `always` and `auto`
  and is pushed under `never`; a plain content change under `auto` skips the
  build. [build]

#### 2.10f Upstream that doesn't build — after 2.10e, 2.10a, 2.9c

- Sync builds the new upstream tip when code moved. If that build fails, the
  state records `upstreamBuildFailed { sha, firstError }` and the last good
  bundle stays current. Publish validates against the last good bundle,
  pushes, and reports `upstreamBuildFailed` in its answer and in the status.
- With a build check on, the candidate's failure only blocks the push when
  its error is not the one upstream already has (same file and message)
  **(call)**.
- **Done when:** the developer pushes a broken component; the CMS user still
  publishes a content edit and is told; adding a *second* break in the same
  changeset is blocked under `always`. [build]

#### 2.10g Poll loop — after 2.10a, 2.9e

- Sync every `syncIntervalSeconds` while a session is open (any API call in
  the last 5 minutes **(call)**); stops when idle; the clock is injected;
  errors back off.
- **Done when:** tests with a fake clock: it polls while active, stops when
  idle, resumes on activity, backs off on errors.

### 2.11 Test editor on the CMS origin — 2.11a early · 2.11b after 2.9e

Design 5.8. This is still a test tool, not the phase 3 editor.

#### 2.11a Copy and serve — after 2.1c

- Copy `preview-render-server/test-editor/` into `cms-server/editor/` (the
  original is removed in 2.12a; the duplication lasts only until then).
  Serve it at `/` with security headers (`X-Content-Type-Options`, a CSP
  that allows frames only from the preview origin, no framing of the editor).
- The editor's script is browser TypeScript: bundle it at server start with
  rolldown (already in the workspace) and keep it in memory **(call; phase 3
  replaces all of this)**.
- **Done when:** the page loads from `createApp`, the script is served, and
  the headers are asserted in a test.

#### 2.11b Data sources — after 2.11a, 2.4b, 2.7a, 2.9e

- Swap the editor's data calls as in the table of design 5.8: documents from
  `GET /api/documents?key=`, uploads to `POST /api/media`, the initial overlay
  from `GET /api/overlay`, the iframe URL and its origin from `GET
  /api/preview-url`, no more `/__preview/warm` from the browser. `postMessage`
  goes to the preview origin it was given.
- The protocol-mismatch check on `ready` stays.
- **Done when:** the editor tests (moved from `test-editor/editor.test.ts`,
  happy-dom) pass against the new routes.

#### 2.11c Save and the changeset list — after 2.11b, 2.5c

- A Save button sends a `PUT /api/changes` with each document's
  `baseRevision`; shows `409` (the conflicting documents, with "reload" and
  "keep mine"), `422` next to the forms, warnings, and `referenced-by`. After
  a save the revisions update and the list from `GET /api/changes` refreshes.
  A response with `rebuild: true` shows "applies after rebuild" and waits for
  the bundle to change (poll `GET /api/status`), then reloads the iframe.
- **Done when:** editor unit tests for each response; the form hides and
  restores its draft state as before.

#### 2.11d Publish — after 2.11c, 2.10d

- A Publish button; shows the commit, the overwritten documents,
  `upstreamBuildFailed`, and the plain messages for `422`, `424`, `409` and
  `502`.
- **Done when:** editor unit tests for each answer.

### 2.12 Close the phase — 2.12a after 2.11b · 2.12b after 2.11d, 2.10f

#### 2.12a Remove the stopgaps — after 2.11b · [build]

- From the preview build: `GET /__dev/documents` (`src/dev/documents*.ts`),
  `/__editor` and `test-editor/`, `media-route.ts` and `/__preview-media/*`,
  the media folder setting, and anything left of `editorOrigins`. `/__dev/memory`
  stays (`measure:memory` uses it).
- Rewrite the end-to-end and browser tests that used them against the new
  routes or delete the ones whose cases moved (2.4b, 2.7a, 2.11b). Update
  Knip, Stryker and depcruise entries. D12 and D13 name the stopgaps: add
  their end date to the notes there.
- **Done when:** `npm run check -- --e2e` passes with none of those routes
  in the preview build.

#### 2.12b Done-when tests — after 2.11d, 2.10f · [build]

- Check the table in section 5 row by row: each row has a test that
  runs in `npm run check -- --e2e`. Write the missing ones.
- The browser test (design R7): a Chromium page on `cms.localhost` drives an
  iframe on `preview.localhost` through the token and cookie; a draft
  changes the preview; Save, reload, and the overlay shows the saved
  content.
- A monorepo variant: the whole save and publish path with `siteDir` set.
- **Done when:** the table is complete and green.

#### 2.12c Manual acceptance — after 2.12b · [user]

- The user runs one save and one publish against a throwaway GitHub repo
  with no deploy attached (not `astroViewCMS` itself), with `buildCheck:
  auto`.
- **Done when:** the user confirms it, and anything surprising is a task.

### 2.13 Measurements and docs — after 2.12b · ∥ 2.12c

#### 2.13a Measurements — after 2.12b

- Fill section 6: `cms-server` rss at rest and after a session of saves and
  a publish (a script next to `measure:memory`), publish latency under the
  three `buildCheck` modes, re-apply time on the 200-post sample, and the
  swap time from a finished build to the new node serving.
- **Done when:** the table has values, with the date and the method.

#### 2.13b Documents — after 2.12b

- A `CMS-SERVER.md` overview in the style of PREVIEW-RENDER-SERVER.md
  (diagrams, the routes, the git model, the build triggers). Update
  PREVIEW-RENDER-SERVER.md (front server, bundle layout, removed routes),
  both READMEs, SYSTEM-DESIGN (roadmap status, the Phase documents table,
  open questions), and the README map. Phase 3 moves from section 12 of
  SYSTEM-DESIGN to a design of its own when it starts.
- **Carried in (2026-11-01):** `editorOrigins` is still described in
  `preview-render-server/README.md:49`, `PREVIEW-RENDER-SERVER.md` (lines 67,
  145, 160, 310) and `QUALITY-TOOLING.md:355`; it now comes from
  `PREVIEW_EDITOR_ORIGINS` through `GET /__preview/config`. Document the YAML
  codec's known limit (4-space indent with unindented sequences is written
  indented) in `CMS-SERVER.md`. `bundle.json` and `images.json` are not in
  `PREVIEW-RENDER-SERVER.md` or the renderer README either (2.0b/2.0c logs).
  `SYSTEM-DESIGN.md` lines 51 and 202 were corrected on 2026-11-02; check the
  rest of it for the same "bundle runs `node entry.mjs`" claim.
- **Done when:** a reader can go from `DOCS/README.md` to every phase 2
  document and no document contradicts the code.

#### 2.13c Quality floors — after 2.12b

- Set the coverage floors and the Stryker threshold for `cms-server` from
  the first full run (not guessed), as for the renderer. Per-file Stryker
  floors only if the user wants them.
- **Carried in (2026-11-01):** the first Stryker run over the new files
  (`cms-server/src/codecs`, `src/git`, `src/config`, and the token and gate
  code) has not happened; 2.2a, 2.2b and 2.3a each logged that. Run it before
  setting the floor and triage the survivors, the codecs first.
- **Remark (2026-11-01, from the full Stryker run after 2.0a):**
  `preview-contract` is the weakest package at 83.10% (9 survivors, 3 with
  no coverage), against 92.98% for the renderer and 97.22% for
  `preview-protocol`. The single global `break: 90` hides it: the packages
  are pooled, so a weak package passes while the others carry it. By this
  task `preview-contract` will have grown (2.0b, 2.0c, 2.8c add the bundle
  schema, `revisionOf`, `canonicalEntryText` and the token functions, all
  security- or identity-critical). Before setting `cms-server`'s floor:
  triage the `preview-contract` survivors, and decide whether to keep one
  pooled threshold or add per-package floors (Stryker has no per-package
  `break`; it would need a script reading `reports/mutation/mutation.json`).
  Mutation runs are slow (a forced full run took ~29 min), so run it once
  here, not per task.
- **Done when:** `npm run check -- --all` passes with the new floors.

## 5. Done-when map

| Design row (section 1) | Proven by |
|---|---|
| R1. Edit two documents, save, reload: the preview shows them with no rebuild | 2.9e at HTTP level; 2.12b in the browser |
| R2. A stale `baseRevision` answers 409 | 2.5c |
| R3. Publish creates one commit | 2.10d |
| R4. A developer's push to a saved document, then publish: the CMS wins and the message names it | 2.10b scenarios; 2.10d |
| R5. Deleting a referenced document is refused unless the same save fixes it | 2.6b |
| R6. With the build check on, a changeset that breaks the build is not pushed | 2.10e |
| R7. The test editor on the CMS origin drives the preview on its own origin | 2.8e; 2.12b |
| R8. `cms-server` memory measured | 2.13a |

## 6. Measurements

| | Value |
|---|---|
| `cms-server` rss at rest, after a session of saves and a publish | |
| Publish latency: `buildCheck` `never`, `auto` without a trigger, `always` | |
| Re-apply time, 200-post sample | |
| Swap time, build done to new node serving | |

## 7. Decisions

D17 to D22 are logged in SYSTEM-DESIGN section 11. Refinements made while
planning (they stay here until the design is next edited):

- Revisions of `file()` entries hash the canonical value of the entry, not
  the codec's serialization (2.0c; refines design 5.3).
- The contract package is a new `preview-contract`, so `preview-protocol`
  stays free of Zod (2.0a).
- `collections.<name>.newEntryFormat` lives in `cms.config.ts` (2.1c).
- Changeset state lives in git (base revisions derived, overwrites in
  commit trailers), with no side file (2.5b).
- The front server refuses to start without secrets unless
  `PREVIEW_INSECURE=1` (2.8b).
