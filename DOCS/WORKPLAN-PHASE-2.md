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
| Steps 2.0 to 2.13 | 2.0a, 2.0d, 2.0e, 2.0f, 2.0g, 2.0h, 2.0i, 2.8a done 2026-11-01; 2.0b, 2.0c, 2.1a, 2.1b, 2.1c, 2.1d, 2.1e, 2.8b done 2026-11-01 (2.8b: gate seam only, 2.8c pending); the rest not started |

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
| 4 | 2.1f, 2.2c, 2.2d, 2.3b, 2.4a, 2.7a, 2.8e, 2.9b, 2.11a |
| 5 | 2.3c, 2.4b, 2.4c, 2.5a |
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

#### 2.1f Verify the long check modes and lift cms-server branches — after 2.1e · [build]

- Run `npm run check -- --e2e` and `npm run check -- --all` once on a quiet
  machine, since 2.1e changed their step lists (the coverage step moved into
  the fast set) and neither has run since. Fix what broke in `scripts/check.ts`
  or the docs; update the timings in QUALITY-TOOLING.md. Note any e2e flake
  (`100 consecutive edits` missed its median once on 2026-11-01).
- Raise `cms-server` branch coverage (66.67%, 8 of 12; the misses are in
  `server.ts`, lines 41-43 and 53, the Request/Response bridge) with tests
  that tell the branches apart, then raise the floors to match. Do not add
  tests for code that 2.7a will rewrite (the bridge buffers bodies today);
  if the bridge is about to change, defer those tests and say so.
- **Done when:** both long modes pass; the `cms-server` branch floor is raised
  to within 2 points of its measured number; the Result block records both.

### 2.2 Format codecs — after 2.1a · ∥ 2.3, 2.1b to 2.1d, 2.0

Design 5.4, D13. Common rules for every codec: a value that equals what was
parsed returns the original text **byte for byte**; the original line endings
(LF or CRLF) are kept; a parse failure is a typed error naming the line.
Round-trip tests run on copies of the sample's own files, committed as
fixtures.

#### 2.2a JSON codec — after 2.1a

- `parse(text)` and `write(originalText, value)`: key order of existing keys,
  indentation (tabs, 2 or 4 spaces; 2 for a new file), the final newline.
- Approach **(call, the builder may differ)**: `jsonc-parser`'s `modify` and
  `applyEdits` driven by a structural diff, so untouched parts stay byte for
  byte. If a hand-written, string-aware scanner is smaller, use that
  (IMPLEMENTATION-RECOMMENDATIONS 4).
- **Done when:** unchanged value, edited scalar, added key, removed key,
  reordered array and a hostile key (`__proto__`) round-trip as stated.

#### 2.2b YAML codec — after 2.1a

- The `yaml` package's Document API with `merge: true` (as Astro parses, so
  `<<: *anchor` keys expand). A structural `applyValue(doc, value)` updates
  scalars in place and edits sequences item by item, so comments (including
  the one inside a list in the sample) survive.
- Dates stay as the file wrote them unless the value changed.
- **Done when:** the sample's YAML files (`partners`, `stats.yaml`, the
  YAML author) round-trip with comments, order and quoting intact after an
  edit of one field and after adding a list item.

#### 2.2c Markdown and MDX frontmatter codec — after 2.2b

- Split at the `---` fences; frontmatter through the YAML codec; the body
  written exactly as given. A file gets frontmatter only if the data isn't
  empty. A file with no fences and empty data stays as is.
- **Done when:** a frontmatter-only change leaves the body byte for byte
  (bigspring's home page is frontmatter only); a body-only change leaves the
  frontmatter byte for byte; `.md` and `.mdx` both covered.

#### 2.2d `file()` entry codec — after 2.2a, 2.2b

- Rewrite only the entry found by `entryKey`; every other entry stays byte
  for byte. Both shapes: an array of objects with `id`, and an object keyed
  by id. JSON and YAML. Add, replace and remove an entry.
- **Done when:** editing one `testimonials` entry and one `stats` entry
  leaves the rest of each file byte for byte; removing the last entry leaves
  a valid empty container.

### 2.3 Git core — after 2.1a · ∥ 2.2, 2.1b to 2.1d, 2.0

Design 4.2. Git is the command line, run with `execFile`, never a shell.

#### 2.3a Exec wrapper — after 2.1a

- `git/exec.ts`: fixed argument arrays, `cwd`, a timeout, `GIT_TERMINAL_PROMPT=0`,
  stderr captured into typed errors. Refs, branch names and paths from
  outside go after `--` or are rejected when they start with `-`. The
  `exec` function is injected, with the real one as the default.
- **Done when:** unit tests cover argument-injection attempts, timeouts and
  error mapping with a fake `exec`.

#### 2.3b Repo lifecycle — after 2.3a, 2.1c

- Ensure `.cms/<site>/repo/`: clone if missing, check the `origin` URL
  matches the config, fetch, create `cms/work` from `origin/<branch>`.
- **Crash recovery (call):** on start, anything uncommitted in the working
  copy is an unfinished save (saves are atomic commits), so reset it to
  `cms/work`'s tip and log it. A leftover `cms/work-next` from an
  interrupted sync is handled in 2.10b.
- **Done when:** tests against the harness (2.1d): fresh clone, existing
  clone, wrong remote URL, a dirty tree after a simulated crash.

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

#### 2.5a Write planner — after 2.2, 2.4a

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

#### 2.8c Token and cookie — after 2.0a, 2.8a, 2.8b

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

#### 2.8d Config route and bridge — after 2.8b

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

#### 2.8e End-to-end proof — after 2.8c, 2.8d, 2.8a

- Against a real build: the frame-ancestors header on a prerendered static
  page, `401` without the cookie, the token exchange and redirect, the
  internal bearer on `/__preview/validate`, an expired token.
- **Done when:** these tests are in the end-to-end suite and pass. The
  "never `'*'`" rule of the bridge stays. [build]

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
- **Done when:** a reader can go from `DOCS/README.md` to every phase 2
  document and no document contradicts the code.

#### 2.13c Quality floors — after 2.12b

- Set the coverage floors and the Stryker threshold for `cms-server` from
  the first full run (not guessed), as for the renderer. Per-file Stryker
  floors only if the user wants them.
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
