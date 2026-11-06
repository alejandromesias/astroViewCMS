# Work plan, phase 2: `cms-server`, single tenant

Written 2026-10-31, after the user approved
[PHASE-2-DESIGN.md](../Designs/PHASE-2-DESIGN.md). Steps 2.0 to 2.13 below turn that
design into tasks. The step numbers differ from the first scaffold of the
same day: git core, the read API and the front server became steps of their
own once the dependencies were worked out.

Read in this order:

1. [SYSTEM-DESIGN.md](../Designs/SYSTEM-DESIGN.md), the authority (sections 1 to 6, 9,
   11; D17 to D22 are this phase's decisions).
2. [PHASE-2-DESIGN.md](../Designs/PHASE-2-DESIGN.md): what phase 2 builds and why. If
   this plan and the design disagree, fix this plan.
3. This file: steps, tasks, status, measurements.

Working rules, environment notes, gotchas and commands are in
[README.md](../README.md) and apply here unchanged. Before writing code, read
[IMPLEMENTATION-RECOMMENDATIONS.md](../Guidelines/IMPLEMENTATION-RECOMMENDATIONS.md);
before writing tests, [TESTING-RECOMMENDATIONS.md](../Guidelines/TESTING-RECOMMENDATIONS.md).

## 1. Where we are

| | Status |
|---|---|
| Phase 2 design | approved by the user, 2026-10-31 |
| Decisions D17 to D22 | logged in SYSTEM-DESIGN section 11 |
| Steps 2.0 to 2.13 | 2.0a, 2.0d, 2.0e, 2.0f, 2.0g, 2.0h, 2.0i, 2.8a done 2026-11-01; 2.0b, 2.0c, 2.1a, 2.1b, 2.1c, 2.1d, 2.1e, 2.2a, 2.2b, 2.3a, 2.8b, 2.8c, 2.8d done 2026-11-01 (wave 3 complete); 2.1f, 2.2c, 2.2d, 2.3b, 2.4a, 2.7a, 2.8e, 2.9b, 2.11a done 2026-11-02 (wave 4 complete, branch `phase-2-wave-4`); 2.1g (codecs scope; the rest of its scope moved to 2.1h with deadlines), 2.1i, 2.3c, 2.4b, 2.4c, 2.5a done 2026-11-03 (wave 5 complete, branch `phase-2-wave-5`); 2.0j, 2.1h, 2.5b, 2.5c, 2.6a, 2.9a, 2.10a done 2026-11-03 to 2026-11-06 (wave 6 complete, branch `phase-2-wave-6`); next: wave 7 (2.6b, 2.9c, 2.10b); the rest not started |

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
| 5 | 2.1g (codecs only, 2026-11-03), 2.1i, 2.3c, 2.4b, 2.4c, 2.5a (after 2.1g) |
| 6 | 2.0j (alone, `[build]`), 2.1h (now also `repo.ts`, before 2.5b), 2.5b, 2.6a, 2.9a, 2.10a, 2.5c (moved here 2026-11-04; starts after 2.10a merges) |
| 7 | 2.6b, 2.9c, 2.10b |
| 8 | 2.7b, 2.7c, 2.9d |
| 9 | 2.9e, 2.10c |
| 10 | 2.10d, 2.10g, 2.11b |
| 11 | 2.10e, 2.11c, 2.12a |
| 12 | 2.10f, 2.11d |
| 13 | 2.12b |
| 14 | 2.12c [user], 2.13a, 2.13b, 2.13c |

Wave 5 order (2026-11-03): the orchestrator writes `codecs/by-format.ts`, rebuilds `sample-site`
alone in the main checkout and refreshes `cms-server/test/fixtures/bundle/` **before** 2.4b or 2.4c
starts (2.4b's revision-equality test compares against today's files). Then 2.4b and 2.4c run in
parallel; 2.5a waits for 2.1g.

Wave 6 order (2026-11-03, revised after review): 2.1h part 1 comes first in the wave, in this order: `repo.ts` (seed `repo.test.ts` from a small fixture), the `core.hooksPath` guard in `repo.ts`, then `codecs/by-format.ts`, `manifest/documents.ts` and `preview-contract/src/revision.ts`. `documents/` waits for 2.5b's revision split, and `plan-write.ts` waits for 2.5b to close (2.5b and 2.0j both change it). 2.1h must finish `repo.ts` before 2.5b. 2.5b may start in parallel with the tests, but is not closed before `repo.ts` has a score. 2.6a, 2.9a and 2.10a do not wait for 2.1h.

Wave 6/7/8 reorder (2026-11-04): 2.5c moved from wave 7 to wave 6. Its gates are met: 2.0h, 2.0j, 2.5a and 2.5b are done, and `server.ts` was scored in 2.1h 2a (93.2%). Order inside wave 6: 2.10a first (it adds `tx.fetch` to `git/ops.ts`), then 2.5c alone in `http/`, `save/` and `ops.ts` (it adds `tx.restore`); 2.6a and 2.9a run in parallel with either, since 2.6a works in `references/`, `schema/walk.ts` and `documents/paths.ts`. Wave 7 is then 2.6b, 2.9c and 2.10b. Wave 8 is 2.7b, 2.7c and 2.9d. 2.6b, 2.7b and 2.7c each add a stage to the same pipeline array, so 2.6b runs apart from 2.7b and 2.7c.

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
- What gets hashed **(call, refines design 5.3; corrected 2026-11-03)**: a
  document with a file of its own: the file's bytes. A `file()` entry: the
  raw value of the entry, as its file's parser reads it, without its id, in
  canonical JSON (`revisionOfEntry`, preview-contract). Only for an array file:
  in an object-keyed file the key is the id, so the value is hashed whole
  (`revisionOfKeyedEntry`; review fix 2026-11-03, an `id` or `slug` field there is data). Not the value after
  the collection schema: the store's data has the schema applied, so it can
  hold defaults the file lacks and lacks keys the schema drops (`id`, in the
  sample). The build and `cms-server` each parse the file with the same
  Astro options, so they agree without sharing a codec, and formatting
  changes in the shared file don't touch other entries' revisions. Export
  `canonicalEntryText(value)` and `revisionOfEntry(entry)` next to `revisionOf`.
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
- **Correction (2026-11-03):** the build hashed the store's data for `file()`
  entries, which is the schema-applied value. The cause, found by diffing
  `testimonials/t-ana`: the store drops `id`, which the schema does not declare.
  The fix: `withRevisions` reads each `file()` document's file with Astro's
  options and hashes `revisionOfEntry` of the raw entry (without its id). The
  store's data is used only for a document with no file. Unit tests: a schema
  default does not move a revision; an unquoted YAML date hashes as a `Date`;
  a missing entry is a build error that names the file and the entry. Two
  earlier `testimonials` revisions in the fixture (`t-ana`) changed with it.

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
  - Review fix (P1): `build.ts` runs `assertOutDirIsSafe` before the build, so
    `--out .` (the repo root, the cwd) or a non-empty folder without a
    `bundle.json` is refused before anything is cleared.

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
  - **Review fix (P2):** a thrown non-Error (`null`, a string, an object) no
    longer makes the catch throw again. `error-message.ts` `errorMessage()` is
    used in `content-api.ts`, `dev/documents.ts` and `schema/json-schema.ts`;
    `integration.ts` still has its own `(error as Error).message` sites.

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

#### 2.0j Read-only flag per collection in `schema.json` — after 2.5a · [build] · DONE 2026-11-03

- Added 2026-11-03 (user approved), from the 2.5a open item. `planWrite` cannot tell that a *new* key
  belongs to a read-only collection: `documents.json` carries `editable: false` only per existing
  document, and the `readOnlyCollections` list stays in the preview site config.
- Add `readOnly?: boolean` to `collectionSchemaJson` (`preview-contract/src/schema.ts`; the object is
  strict, so the reader would otherwise reject it). `integration.ts` writes it as `true` for each name in
  `site.readOnlyCollections`, and leaves it out otherwise. `cms-server` passes it to `planWrite`, which
  refuses a create in such a collection with `read-only`.
- **Done when:** a contract test (flag accepted, absent flag still valid), an `integration.test.ts` case
  (`fixtures` carries `readOnly: true`, another collection does not), a `plan-write.test.ts` case, and
  the `cms-server/test/fixtures/bundle/` `schema.json` refreshed after a `sample-site` build (run alone,
  as for 2.4c). Runs before 2.5c; it shares `integration.ts` with nothing else open.
- **Decisions (2026-11-03, review):**
  - `readOnly: true` is written only for read-only collections. No `readOnly: false`, so `schema.json` does not churn.
  - `integration.ts` warns (`logger.warn`) for a name in `site.readOnlyCollections` that is not a collection of the build. The warning is new: `manifest/documents.ts` ignores such names silently today (`new Set(readOnlyCollections)`), and this task leaves that code alone. `documents.json` output does not change.
  - Test for the warning: an `integration.test.ts` case with an unknown name.
  - **Custom `generateId` (decided 2026-11-03, user approved):**
    - `customId: true` on the loader record (`loaderInfoSchema` in `preview-contract/src/schema.ts`, a new optional `z.literal(true)`), written only when true. The stub `glob()` (`preview-render-server/src/schema/stubs-flavor1.ts`) sets it when its options carry a `generateId`. The loader schema is a plain `z.object`, not strict, so without the explicit key the reader drops it silently: add it, and test that the parsed value keeps it.
    - `planWrite` refuses a create into such a collection with `unwritable` and a message saying the id cannot be turned into a path. It reuses the code, so the 2.5c mapping does not change. Updates and deletes still work, since they come from bundle records. `file()` loaders are unaffected.
    - `sample-site` has no `generateId` (checked 2026-11-03), so the flag is not exercised end to end there. `integration.test.ts` gets a fixture collection with a custom `generateId`, and `plan-write.test.ts` gets the refusal case.
    - Done when: the contract test (flag accepted, absent flag still valid), the `integration.test.ts` cases, the `plan-write.test.ts` case, and the `sample-site` rebuild that refreshes the fixture, as already specified.
- **Result (2026-11-03):** `readOnly` (boolean) and `customId` (`true` only) are in the `schema.json` reader; `shapeSchemas` marks the read-only collections; the stub `glob()` sets `customId` when it gets a `generateId`; `build:done` warns for a `readOnlyCollections` name the build lacks; `planWrite` refuses a create into a read-only collection (`read-only`) or into a `customId` glob (`unwritable`). Tests: contract, `json-schema`, `stubs-flavor1` (new file), `integration` (fixture `test/fixtures/flags-site`, left out of typecheck like the other stub sites), `plan-write`. `sample-site` was built into `.build/sample-site-2-0j`, because the old `.build/sample-site` leftover makes the build refuse to run. The whole `cms-server/test/fixtures/bundle/` was refreshed from that build (`--bundle-id fixture-2026-11-03`, built at `4523c67`; `fixtures` is now `readOnly: true`). The tests that pinned the old one-document fixture were updated to the new documents, images and identity.

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

#### 2.1g Stryker over the new code — after 2.1f, 2.2c, 2.2d, 2.3b · [build] · DONE 2026-11-03 (codecs scope; the rest is 2.1h)

- **Scope narrowed (2026-11-02):** this task covers the code that saves and
  the code from waves 1 to 3; the wave 4b code (bundle reader, media,
  supervisor) is 2.1h, so that 2.5a is not held up by it.
- Run Stryker (`npx stryker run`, or `npm run check -- --mutation`; see QUALITY-TOOLING.md) once over the code
  written since the last full run: `cms-server/src/codecs` (now with `frontmatter.ts`
  and `file-entries.ts`), `src/git` (now with `repo.ts`), `src/log.ts`,
  `src/config`, `preview-contract/src/token.ts`, `preview-render-server/src/serve/`
  and `preview-config.ts`. Triage the survivors, codecs first: a save that
  rewrites a file wrong corrupts the site, so kill the survivors that a real
  round trip could notice. Add the missing tests; do not change the global
  `break` threshold here (2.13c).
- Runs before 2.5a, which is the first task to save through the codecs.
- **Done when (superseded by the 2026-11-03 split below):** the survivors are killed or each is written down as
  equivalent, and the Result block gives the score per folder.
- **Heads-up (2026-11-02, superseded by the 2026-11-03 split below):** `npm run check -- --all` is red on Stryker
  alone: 88.88% against the `break: 90` (found in 2.1f; no `src` file changed in that task).
  The drop comes from `cms-server` code from waves 1 to 3 (`server.ts` about 36%, `codecs`
  about 73%). Before the new-code triage above, read the per-file report, find where the
  score fell, and get `--all` back to green (kill survivors, or write each down as
  equivalent). `server.ts` is the bridge that 2.7a rewrites: do not add tests for it. If
  its survivors cannot be killed that way, say so in the Result and ask before touching
  `thresholds.break` (2.13c). 2.1f stays DONE with this open.
- Gaps settled (calls, 2026-11-02, supersede the heads-up above where they differ):
  - **`server.ts` is final.** 2.7a already made `toRequest` stream the body, so the
    "do not add tests for it" line is void: kill its survivors like any other file.
  - **Done when (replaces the one above):** every survivor in scope is killed or written
    down as equivalent, and the Result gives the score per folder plus one full-run
    score. Getting `npm run check -- --all` green moves to 2.1h, which already ends
    green or raises the `break` question with the user. 2.1g does not wait for 2.1h.
  - **Method:** triage with `npx stryker run --mutate "<files>"` (TESTING 7). `stryker.config.json`
    mutates all of `cms-server/src/**`, so a full run also covers the wave 4b files
    (2.1h's); they are not triaged here. Do one full run at the end for the score.
  - **Order:** `codecs` first, then `server.ts`, then `preview-contract/src/token.ts` (the
    preview-token code, weakest package at 83.1%), then `src/git`, `src/config`,
    `preview-render-server/src/serve/` and `preview-config.ts`, `src/log.ts`.
  - **After 2.3c merges,** re-run `--mutate "cms-server/src/git/**"` before closing, so the
    git scores include 2.3c's files. Do not touch `thresholds.break` (2.13c).
  - **Machine:** `[build]`, alone. 2.1i's code may be written meanwhile, but its e2e must
    not run during the Stryker run.

- **Scope split (2026-11-03, supersedes "Done when" and "Order" above):** the triage did not
  finish, and most of what is left does not touch 2.5a. 2.1g shrinks to what 2.5a writes
  through; the rest moves to 2.1h with a deadline each (below). Nothing leaves `mutate`:
  a file is only excluded with the user's approval.
  - **2.1g now covers:** `codecs/frontmatter.ts` and `codecs/file-entries.ts` (never mutated
    yet), and the 33 survivors in `codecs/yaml.ts`. Use the scoped config
    (`stryker.cms-server.config.mjs`, one run per file). For yaml, prefer round-trip tests
    (`write(original, parse(original))` returns `original`; parse after write gives the value)
    over one test per mutant. A property-test library (`fast-check`) is a new dev dependency:
    ask the user first.
  - **Done when (final):** every survivor in those three files is killed or written down as
    equivalent, and the Result gives their scores. The full-run score is read in 2.1h.
  - **Start (2026-11-03):** run `yaml.ts` alone first and record the survivor count before writing
    tests. The 33 predates `d0a4999`'s new tests, which may already have killed some of them.
  - **No new dependency:** `fast-check` is not added. Round-trip tests on the sample files and
    targeted cases cover the 33 survivors. Ask again only if the yaml score stalls.
  - **What gates what** (scores from the 2026-11-03 triage; "never mutated" means in no report):

    | File | State | Gates |
    |---|---|---|
    | `codecs/frontmatter.ts`, `file-entries.ts` | never mutated | **2.5a (this task)** |
    | `codecs/yaml.ts` | 90.8%, 33 survivors | **2.5a (this task)**: every YAML and frontmatter write |
    | `codecs/json.ts` | 98.3%, `setOp` fixed | done |
    | `server.ts` | 31.7% (18 survived, 10 uncovered) | 2.5c, the first saving route (2.1h) |
    | `git/repo.ts` | run blocked | 2.5b (2.1h) |
    | `config/load.ts` | 53.8% | startup only (2.1h) |
    | `gate.ts` L121, `static.ts` L84 | open | none, but security code (2.1h) |
    | git `ops`/`mutex`/`exec`, `config/schema`, `log`, `token.ts` | 96 to 100% | done |
- **Result, codecs (2026-11-03, 2.1g, scoped config):** `yaml.ts` 90.8 (33 survived, 1 no coverage) to 92.95 (26 survived, 0 no coverage); `frontmatter.ts` 99.41 (1 survived, no test added); `file-entries.ts` 98.75 (2 survived, no test added). Eight yaml mutants are now killed: three tests in `yaml.test.ts` (a root list's header stays on top when a commented item moves to the front; a string becomes a map or list and reads back; a binary value is replaced as a whole node), and one for line 134 (an inline comment is dropped when a scalar becomes a map). Line 134's comment said the comment moves to the new node, but the code moves it only to a new scalar, and a comment on a map prints inside the map; the comment now says it is dropped, and the test pins that. Equivalent, not tested on purpose (current line numbers): yaml L44, L78 (an empty schema name reads as core); L47 (eol matters only for CRLF or a missing final newline); L83-85 (linePos fallbacks; they rely on yaml setting linePos on every parse error, a library contract not proven here); L118 (3), L187, L193, L198, L237, L239, L241, L242, L244, L250, L253 (3), L256, L277 (2), L338, L343 (guards, loop bounds, or operand cases that never change output); frontmatter L180 (CodecError stores column undefined either way); file-entries L115 (2) (a removed key stays undefined; JSON drops it, YAML treats it as removal). Unresolved: none in scope. Config: `vitest.mutation.cms-server.config.ts` now also excludes `**/http/bundle-routes.test.ts`, which copies `sample-site` and fails the Stryker dry run in the sandbox (the same reason as `repo.test.ts`). Its tests no longer count toward kills in scoped runs, so 2.1h must check the scores of the files they cover. Checks: `cms-server/src/codecs` 6 files, 235 passed; biome and tsc clean. Thresholds unchanged. Nothing committed.
- **Result, serve scope (2026-11-03, scoped config, `--force`):** static.ts 80.0 to 88.7 (HEAD opens no file, a stream error ends the response, a malformed path is refused and a file named `.undefined` is not served); gate.ts 90.9 (unchanged in Stryker, see open); settings.ts 97.6; preview-config.ts 88.9 to 94.4 (only ENOENT is swallowed; EISDIR and errors without a code propagate). Equivalent, not tested on purpose:
  - `gate.ts` `eq !== -1` and its unary mutant (L104): a pair without `=` reaches the real verifier with the whole pair, which no signed token can be; the name check already needs `eq >= 13`.
  - `gate.ts` `url ?? '/'` as `''` (L116): `new URL('')` is `/`. The `catch` returning undefined (L123) and the `firstPair` fallback (L145) are unreachable or implicit undefined: splitQuery skips empty segments, and every non-empty segment yields a pair.
  - `gate.ts` `nowSeconds` emptied (L152): `preview-contract` defaults an undefined `now` to its own clock.
  - `static.ts` path guard (L66): the realpath check in `isInsideRoot` refuses the same paths, so the early exit only saves a stat.
  - `static.ts` `statSync` options (L92) and its catch (L93): `statOf` returns undefined for any error, so `throwIfNoEntry` is not observable. The realpath catch (L85-86) is unreachable after a successful stat.
  - `static.ts` `req.url ?? '/'` as `''` (L37): same URL, as for gate.
  - `settings.ts` split regex without `+` (L41): the empty items it adds are filtered out.
  - `preview-config.ts` default `'utf8'` as `''` (L26): `readFileSync` returns a Buffer that `JSON.parse` reads as UTF-8; `parseJson`'s catch returning undefined (L48) is implicit.
  - `exec.ts` L233 `<` to `<=` on 0x20: a space is already caught by `/\s/`.
- **Open (serve), logged 2026-11-03, not chased:** gate.ts L121 (`mark === -1 ? '' : ...`): a hand-applied `query: false` fails 37 gate tests, but Stryker still reports the mutant Survived although 54 tests cover it. The gate score (90.9%) may understate the tests. Re-check the sandbox run when the gate scope is next triaged. static.ts L84 (the realpath check) survives with an existing junction test; not analysed.

- **Result, git scope (2026-11-03, scoped config, 2.3c code):** ops.ts 96.5% (136 mutants), mutex.ts 97.1%. Added: a `showAt` refusal of a ref that starts with a dash (`invalid-argument`), and a site folder with a trailing slash. Equivalent, not tested on purpose: `worktreeAdd`'s `mkdir` (L104): `git worktree add` creates the folder, which the existing worktree test shows without it; `parseNameStatus`'s `?? ''` fallbacks (L151-152): git always outputs status and path pairs; the trailing-slash regex as `/\/$/` (L70): `posix.normalize` leaves at most one trailing slash; the `LockTimeoutError` and waiter-timeout bodies in mutex.ts are Stryker Timeouts, which count as detected. `repo.test.ts` is still outside the scoped config (it seeds from `sample-site`); the full Stryker run is still blocked by that.

#### 2.1h Stryker over the wave 4b code — after 2.1g · [build] · DONE 2026-11-05 (close-out below)

- Added 2026-11-02, split from 2.1g. Same method as 2.1g, over the code of
  2.4a, 2.7a, 2.9b and 2.11a: `cms-server/src/bundle/`, `src/media/`,
  `src/fs/`, `src/http/` (`body.ts`, `guard.ts` and the route files; not
  the bridge in `server.ts`, see 2.1g), `src/preview/supervisor.ts`, and the
  renderer's `preview-config.ts` change (`bundleId`, `protocolVersion`).
  Media and `fs/atomic.ts` first: a wrong cap or a lost `media.json` update
  is the costly survivor.
- Runs before 2.9c, which builds on the supervisor and the bundle reader.
- **Split and order (2026-11-03, review; where this block and the bullets below differ, this block wins):**
  - **Part 1 (wave 6, now), in this order:**
    1. `repo.ts`: seed `repo.test.ts` from a small fixture under `cms-server/test/fixtures/`. Give `seedRemote` (`cms-server/test/helpers/git.ts`) a source option: `repo.test.ts` uses the fixture, and the other tests keep `sample-site`. Remove `repo.test.ts` from the exclude list in `vitest.mutation.cms-server.config.ts`. Mutate `repo.ts` and kill its survivors.
    2. **The `core.hooksPath` leak, fixed in `src`.** `repo.ts` `setConfig` writes five keys (`user.name`, `user.email`, `core.hooksPath`, `commit.gpgsign`, `core.autocrlf`) with `cwd` at the clone. If the clone folder is not its own repo, git writes into a parent, the main checkout. Fix in `src`: before any write, check that `git rev-parse --show-toplevel` is `repoDir` (compare real paths), and fail as `failed` otherwise. Find which test wrote the main checkout's config, and add a test that a repo-less folder is refused and the parent's config is unchanged. `GIT_CEILING_DIRECTORIES` in the tests is an extra guard, not the fix. After every run, `git config --get core.hooksPath` must print `.githooks`.
    3. Mutate `codecs/by-format.ts`, `manifest/documents.ts` (`withRevisions`) and `preview-contract/src/revision.ts` (`revisionOfEntry`). 2.5b does not touch these.
    4. `documents/` (`read.ts`, `revision.ts`) after 2.5b's revision split has landed. `documents/plan-write.ts` is not mutated until 2.5b has closed, since 2.5b and 2.0j both change it.
  - **File ownership:** 2.1h edits `repo.ts`, its tests, the test helpers, the mutation configs and the test files of the modules it mutates. The one `src` change is the guard in step 2. It does not edit `ops.ts`, the `documents/` changeset code, `plan-write.ts` (until 2.5b closes), `http/` or anything else 2.5b owns. If it needs one of those, it reports it.
  - **Part 1 closes** with its Result block (scores per file, and the leak evidence). The task stays open for part 2 below, with the deadlines unchanged.
- **Result, part 1 (2026-11-04):** Stryker `--force` on 636a96e plus the tests added after it, measured in a scratch git repo outside the main checkout. Steps 1 to 4 are done. Scores per file: `git/repo.ts` 99.10% (2 survivors, equivalent: `Number()` ignores whitespace, an undefined name and email are the same either way); `codecs/by-format.ts` 100%; `documents/read.ts` 98.18% after a BOM test (2 survivors at L62, equivalent: fs errors are always `Error`s with a `code`; the `||` mutant of the L62 check fails the EISDIR test when applied by hand, so its survival is a Stryker per-test artifact); `documents/revision.ts` 100%; `preview-contract/src/revision.ts` 97.96% (1 survivor: the `<=` sort comparator, equivalent since keys in an object are unique); `preview-render-server/src/manifest/documents.ts` 97.08% (5 survivors, all equivalent: `readOnlyCollections` default, `schema: 'core'` against yaml's default, `contents === null` against `toJS()` of null, `item === null` for primitives, `file ?? ''` against `extname`). Earlier "100%" figures for `read.ts` came from incremental runs and were wrong; use `--force` when scoring.
  - **Leak evidence.** Cause: the Stryker sandbox lives inside the repo with no `.git`, so git climbs to the main checkout. Reproduced with the pre-fix code (33474b3) in a scratch repo: after a Stryker run on `repo.ts` the parent's config held `core.hooksPath` set to a sandbox path and the clone identity. Post-fix code (636a96e): vitest on `src/git` plus the documents tests, and three Stryker runs (`repo.ts`; `by-format.ts`, `read.ts`, `revision.ts`; the preview files) left the scratch parent's branches and config unchanged. `repo.test.ts` has the refusal test (an empty `.git` folder is refused, the parent's settings and branches stay). The cms Stryker config sets `GIT_CEILING_DIRECTORIES` inside `.stryker-tmp`.
  - **Open item.** At 12:57 on 2026-11-04 the main checkout switched to `cms/work` (a branch created from `origin/main` one second before) during a forced cms-server Stryker run. It was undone by hand (checkout back, branch deleted with `-d`). Most likely cause, not proven: a pre-fix scratch run (no ceiling, node_modules junctioned to the main checkout) overlapped it; no post-fix run leaked in five attempts. If it recurs, check `git reflog` first. After every Stryker run: `git config --get core.hooksPath` must print `.githooks`, and `git rev-parse --abbrev-ref HEAD` must print the working branch.
- **Part 2 (set 2026-11-04, replaces the lists that were here).** Three blocks, each with its own Result. Already scored in part 1 and the 2.1g serve Result, so not run again: `documents/read.ts`, `documents/revision.ts`, `codecs/by-format.ts`, `manifest/documents.ts`, `preview-contract/src/revision.ts`, `git/repo.ts` (part 1 Result); `serve/settings.ts` 97.6 and `preview-config.ts` 94.4 (2.1g serve Result). `mutex.ts` has no commit after its 2.1g score (last change `9c4875d`, 2026-11-02), so it is not stale.
  - **Rules for all of part 2.**
    - A **round** is one `--force` run of one file plus the tests written in response. A file is **done** when it scores 90 or more and every survivor is classified as killed, equivalent, tool artifact or real bug. A file still under 90 after two rounds stops: the agent reports the survivor list and the user decides.
    - Part 2 edits test files, helpers and mutation configs. A `src` fix is reported, or made only when a survivor shows a real bug, and then named in the Result.
    - Every score is a `--force` score. After every run: `git config --get core.hooksPath` prints `.githooks`, and `git rev-parse --abbrev-ref HEAD` prints the working branch.
    - The `plan-write.ts` restriction is lifted: 2.0j (`4523c67`) and 2.5b (`fbb4035`) have landed, and part 1 scored `repo.ts`.
    - **Only the script runs Stryker (action plan 4, 2026-11-04).** Every run is `node scripts/stryker-run.mjs <config> --mutate <files>`, by the lead or any agent. No raw `npx stryker run`. The script refuses a dirty tree and a run without `--mutate`, runs in an export of HEAD with no git repository above it, and copies nothing back if the main checkout's branch, HEAD, refs, local config or root `node_modules` changed. Results land in `reports/stryker-runs/<stamp>/`, not in the accumulated triage files.
    - **Builder brief line** (no brief file exists; copy this into every brief to an agent that may run Stryker): "Run Stryker only as `node scripts/stryker-run.mjs <config> --mutate <files>` from the repo root. Never `npx stryker run`. If the script refuses, stop and report its message."
  - **2a, before 2.5c starts and before 2.6a for `walk.ts`** · `[build]`, runs alone, so nobody else is in these files:
    1. `cms-server/src/schema/walk.ts` first (deadline: before 2.6a and 2.7b).
    2. `cms-server/src/documents/plan-write.ts` (43 tests written with the code; expect survivors in the path and error branches).
    3. `cms-server/src/server.ts` (31.7%, 18 survived, 10 uncovered). The likely file to stop at two rounds.
    - **Result 2a (2026-11-04, `--force`, one file per run; rows read from `reports/stryker-triage-cms-server.json`, because the clear-text report also lists cached mutants of other files):**
      - `schema/walk.ts`: 75.7% before (168 of 222 detected), **96.4%** after 2 rounds (211 killed, 3 timed out). Round 1 added 19 tests (19 to 38 in `walk.test.ts`, `d273209`); round 2 was the verification run, with no test change after it. Survivors: L215 `true` (the `$defs` lookup) and L278 `true` (integer): **tool artifacts**, the hand-applied mutant fails the `__proto__` test and the boolean, number and integer test. Equivalent, not tested on purpose: L244 (a dead guard, since `discriminatorOf` resolves every branch before `constOf` runs); L246 (a non-own key gives undefined or an inherited value with no `const`); L265 and L266 `null` (a null value never produces a hit, and the type only decides whether a `$ref` under it is followed, which throws only for a broken `$ref`); L279 (`default` without `return false` returns undefined, which `some` reads as false).
      - `documents/plan-write.ts`: 88.6% before (218 of 246, original tests), **95.1%** after 2 rounds (234 killed). Round 1 added 7 tests (49 to 56, `514104c`): the messages of refusals that checked only code and key, the `file` of an existing entry, a document with no file, the `.` segment, glob patterns with no writable format or no extension at the end, and a codec error that is not a `CodecError`, rethrown unchanged (a spy on the yaml codec's `write`). Survivors: L218 `format === undefined || codec === null` as `false` and the whole glob extension check at L266 as `false`: **tool artifacts** (the hand-applied L218 fails "a file() loader whose file has no codec"; the hand-applied L266 fails 5 tests). Equivalent, not tested on purpose: L155 op `''` (`changeEntry` treats any op but `add` and `remove` as replace); L217, L265 (codec ternaries) and L264 (extension ternary), since a missing format is refused by the next check either way and `formatOfExtension(undefined)` is undefined; L266 `ext === undefined` as `false`, and `&&` for the inner `||` (an undefined extension forces an undefined format, and the codec is null whenever the format is undefined); L266:28 `format === undefined` as `false` (same reason); L261 `?.` (the config is zod-parsed and `noUncheckedIndexedAccess` is on, so `?.` only covers the index type); L373 `brace[1]?.` (group 1 always participates when the regex matches); L288 with no coverage, `loader.base ?? '.'` as `''` (`posix.join` ignores the empty segment; no test uses a glob without `base`).
      - `server.ts`: **93.2%** (41 of 44 scored; 1 ignored) in round 1, with no test change, so one round. The 31.7% in the 2.1g triage does not match this run; the difference is not investigated. Survivors, all unreachable from a real HTTP request, so equivalent: L57 `value !== undefined` as `true` (Node never gives a header an undefined value); L61 `req.url ?? '/'` as `''` (no coverage: a server request always has a URL, and `''` and `/` give the same URL); L62 `req.method ?? 'GET'` as `''` (no coverage: a server request always has a method). No commit for this file.
      - Rounds: walk 2, plan-write 2, server 1. No file stopped under 90, so no survivor list goes to the user. The one `src` edit in this part is none: `walk.ts` and `plan-write.ts` are at HEAD. Hand-applied mutants were reverted with `git checkout`; during the walk check a second mutant was briefly in place by mistake, and it was restored before any run.
      - Checks after every Stryker run: `git config --get core.hooksPath` prints `.githooks`, `git rev-parse --abbrev-ref HEAD` prints `phase-2-wave-6`, no `cms/*` branch exists, and no `.stryker-tmp` sandbox is left. Targeted vitest runs pass (`walk.test.ts` 38 tests, `plan-write.test.ts` 56 tests), and Biome is clean on both test files (`npx biome` did not resolve in this shell, so `node_modules/.bin/biome` was used). The pre-commit hook passed for both commits (typecheck, lint, format, depcruise). Not pushed.
  - **2b, before 2.9c; `media/` and `fs/atomic.ts` also before 2.7b:**
    0. Step 0: seed `http/bundle-routes.test.ts` from `cms-server/test/fixtures/bundle/` (refreshed in `2fd60b8`) and remove it from the exclude list in `vitest.mutation.cms-server.config.ts`, as `repo.test.ts` was in part 1. Until then `bundle-routes.ts` and part of `bundle/` score falsely low.
    1. `media/` and `fs/atomic.ts` first: a wrong cap or a lost `media.json` update is the costly survivor.
    2. The rest of `fs/`, `bundle/`, `preview/supervisor.ts`.
    3. `http/` (`body.ts`, `guard.ts`, the route files) last, after 2.5c lands on `phase-2-wave-6`, so 2b and 2.5c never edit `http/` at the same time.
    - **Result 2b, steps 0 to 2 (2026-11-04, `--force`, scoped cms-server config; `http/` is step 3 and stays open until 2.5c lands on `phase-2-wave-6`):**
      - **Step 0:** `bundle-routes.test.ts` now reads a working copy made from `cms-server/test/fixtures/bundle-src/` (the 32 files the bundle fixture's documents point at, 159 KB), not from sample-site. `sampleWorkingCopy` in `test/helpers/working-copy.ts` points there, and the exclude is gone from `vitest.mutation.cms-server.config.ts`. Refresh `bundle-src` together with the bundle fixture. Commit `f3f7f68`.
      - **Scores:** `fs/atomic.ts` 76.5 to 91.2; `media/measure.ts` 70.4 to 92.6; `media/metadata.ts` 94.1 to 97.1; `media/staging.ts` 91.3 to 100; `bundle/read.ts` 90.5 (no test added); `bundle/source.ts` 100; `bundle/store.ts` 100; `preview/supervisor.ts` 82.7 to 95.5. Rounds: media and `atomic.ts` 2 (commit `46c957b`), `supervisor.ts` 2, `bundle/` 1.
      - **Tests added:** `errorCode` cases and a non-Error rename failure (`atomic.test.ts`); a new `measure.metadata.test.ts` that fakes sharp's metadata (HEIF that is not AV1, no size, the pixel limit passed to sharp); an EISDIR read in `metadata.test.ts` and `staging.test.ts`; 17 tests in `supervisor.test.ts` (starting/stopped states, the default poll, timeout and grace values, a non-200 answer, boundary of the readiness timeout, stop() during every wait of the loop, a replaced node is not restarted, the swap interrupted by stop(), the exit message, a probe error that is not EADDRINUSE, a node that floods stdout, and the 4000-character stderr limit). The fake start script now has the bundles `loud` and `noisy`.
      - **Survivors left, all classified equivalent unless noted:** `atomic.ts` L53 (`code === undefined` is also caught by the Set lookup) and L60 (`rm` with `force` only matters when the temp file is missing, and the error is swallowed anyway); `measure.ts` L38 (`Map.get(undefined)` is undefined) and L41 (an empty catch returns undefined too); `metadata.ts` L22 (an empty encoding gives a Buffer, which `JSON.parse` turns into the same text); `read.ts` L103, L105, L124, L125 (the same encoding case; the first operand of the ENOENT check is always true for fs errors; Zod gives at least one issue when it fails); `supervisor.ts`: the `kind: 'failed'` strings at L231, L244, L251 (`kind` is only compared with `'ready'`), L272 and L282 (undefined and false are both falsy), L314 (the same stop is caught again at L326 and L332), L342:51 and L426:61 (unreachable `??` fallbacks), L389 (`running` is never undefined when `previous` is set), L442 (`stdio: []` also pipes). **Not proven:** `supervisor.ts` L382 (`generation -= 1` in swap); no scenario brings the counter back to an old loop's value, but no test shows it.
      - **Post-run checks:** `core.hooksPath` is `.githooks`, the branch is `phase-2-wave-6`, and no sandbox was left, after each of the six Stryker runs.
      - **Closed 2026-11-05 (2.5c item 11):** `http/` was scored after 2.5c landed on `phase-2-wave-6`; see the 2.5c Result.
  - **2c, before 2.9c; the small files · RUN 2026-11-05 (every file at 90 or more, survivors classified; see Result 2c and the full-run Result below):** `config/load.ts`, `config/secrets.ts`, `git/exec.ts`, `log.ts`, `serve/static.ts`, `serve/gate.ts`. The remaining `ops.ts` survivors wait until 2.5c lands on `phase-2-wave-6` (2.5c changes `ops.ts`), then run fresh. `mutex.ts` has no commit after its 2.1g score and is not in 2c.
    - **Location (2026-11-04):** `serve/gate.ts` and `serve/static.ts` live in `preview-render-server/src/serve/`, not `cms-server`. Their tests are there too. Their Stryker config is `stryker.serve.config.mjs`, not the cms one. The 2c rule covers test edits in the package that owns the file.
    - **`gate.ts` L121 (corrected 2026-11-04):** the earlier note said a hand-applied mutant fails 37 tests. It does not. Coverage off gives 91.41% with 8 survivors, so L121 is not a per-test artifact. Hand-applied mutants: `mark === -1` to `false` and `-1` to `+1` both survived the 40 original tests. Two near-miss tests now kill them (commit `209ca4a`). The empty-string mutant is equivalent: the query is only read when a token is in it, and a token needs a `?`.
    - **`load.ts` (decided 2026-11-04):** the guard is dead. A dynamic `import()` always returns a namespace object, so the six L12 survivors are equivalent. The `src` fix (commit `ae704dc`) reads `.default` directly. The one caller passes a dynamic `import()`, so this is safe. A `src` change is allowed here only because a survivor proved the code dead. Any other case is a real bug, and that is reported, not fixed.
    - **Result 2c (closed 2026-11-05; the 2026-11-04 partial notes below are superseded by this):** every score is `--force`, through `scripts/stryker-run.mjs`, one file per run. Concurrency 8 (the base config has 4). RAM: the Stryker workers peaked at about 1.7 GB of node memory; free RAM stayed at 3.25 GB or more of 15.7 GB. No test change in this round; the workplan edit is uncommitted.
      - `config/secrets.ts`: 97.10% (67 killed, 2 survived, both equivalent: `readFile` with an empty encoding gives a Buffer that `JSON.parse` reads the same way; the `catch` body sets `raw` to undefined, which it already is).
      - `config/load.ts`: 100% (1 killed). The `src` fix (`ae704dc`) is in, as decided.
      - `git/exec.ts`: 99.47% (2026-11-04 20:47 run, step 3 above). The one survivor, `73:45`, is equivalent: `Buffer.isEncoding('')` is false.
      - `log.ts`: 100% (16 killed).
      - `serve/static.ts`: 90.14% (61 killed, 3 timeout, 5 survived, 2 no coverage), round 1. L66 is killed by the earlier junction test (`/..%2fclimb/app.js`). Survivors, all equivalent: 37:48 `''` for `'/'` (both resolve to `/`); 84:12 `false ||` on the equality (a file is never the root directory); 92:27 `{}` and 92:45 `throwIfNoEntry: true` (the ENOENT throw lands in the catch, which returns undefined either way); 93:11 empty catch (`return undefined` is already the same). NoCoverage: 85:11 and 86:12, the catch of `isInsideRoot`, reached only if `realpathSync` fails after `statSync` succeeds (a race); equivalent in practice, not formally. **Caveat, accepted 2026-11-05 (2.1h close-out):** no test covers that race, and the claim is not a proof.
      - `serve/gate.ts`: 92.56% (112 killed, 6 survived, 3 no coverage), round 1. All equivalent: 104:7 and 104:14 (a pair with no `=` only matches the name when it is 14 characters, which cannot be a token, so `verifies` refuses it); 116:25 `""` for `'/'` (both resolve to `/`); 123:11 empty catch (same as `return undefined`); 121:28 `"Stryker was here!"` (the query is read only in the token branch, which needs a `?`); 145:18, 145:19, 145:23 NoCoverage (a non-empty segment always yields one pair, so the fallback is dead); 152:31 empty `nowSeconds` (the `undefined` reaches `preview-contract`'s own default, `now = nowSeconds()`, so the clock is the same).
      - Left for later: the lead's full run after 2c (2.1h done-when), and a re-measure of `git/repo.ts` after `6040f03` (step 3 above says it was not re-measured; it is outside 2c).
      - The earlier batch on `cms/work` is invalid and was discarded.
      - **Stopped:** the main checkout switched to `cms/work` during a 2c Stryker run (17:12). The branch is restored, and `cms/work` is deleted (it had no commits of its own). The run's sandbox is removed. Cause unproven; the same symptom as 12:57. Stryker runs stay on hold until the isolation question is decided.
- **Done when:** 2a, 2b and 2c are closed under the rules above. Then the lead does one full run. If the overall score is still under 90, that is the `break` question for the user (2.13c); the `--all` outcome is owned here, not by 2.1g (call, 2026-11-02).
- **Result, full run and `repo.ts` (2026-11-05, `--force`, concurrency 10, uncommitted):** the whole-repo run is two runs by package, because one run stopped at the 2-hour background limit at 4,540 of 7,290 mutants (two attempts). Together they cover the same 96 files as `--full` (41 in `cms-server`, 55 in the other packages), with the base config's mutate list. Overall score **93.67%** (6,824 killed or timed out, 400 survived, 61 with no coverage, 5 errors excluded), above 90, so no `break` question. Per run: `cms-server` 94.46% (3,334 killed, 211 timeout, 176 survived, 32 no coverage, 5 errors; 95 min); the other packages 92.84% (3,259 killed, 20 timeout, 224 survived, 29 no coverage; 11 min). Files under 80%: `main.ts` and `memory-route.ts` (no covered mutant), `app.ts` 34.6%, `bundle.ts` 45.0%, `errors.ts` and `preview-contract` `schema.ts` 57.1%, `page.ts` 76.0%. The survivors are not triaged in this round; the score is the check. `git/repo.ts` re-measured: 99.10% (175 killed, 45 timeout, 2 survived, both equivalent: the `Number(count)` and the `?? ["Stryker was here"]` default). 2.1h is not closed: `http/` (2b step 3) waits for 2.5c.

- **Close-out (2026-11-05): 2.1h is done.** The three open items were decided by the user:
  - **Full run accepted at 93.67%, with a caveat.** The run (recorded in `702fba5`) predates the 2b step 3 tests (`d998d28`), the save code (`716a0ed`), and the later reruns of `ops.ts`, `walk.ts` and `paths.ts`. It was not rerun. The score is above 90, so no `break` question.
  - **`preview/supervisor.ts` L382 killed.** The surviving mutant (`generation -= 1` in `swap`) is killed by "does not restart the old bundle when its restart wait ends after swap() and stop() came" (`56a2a7e`). Hand-applied, the test fails with a third spawn of the old bundle. Rerun `reports/stryker-runs/2026-11-05T21-57-47-021Z/`: 95.88 (243 killed, 13 timeout, 9 survived, 2 no coverage, 5 errors). The nine survivors are the 2b classified set; L382 is not among them. The 5 errors are `OptionalChaining` mutants of the `notify?.(…)` calls in `supervise`. Stryker counts them as errors, not survivors, and the score excludes them, as in the full run.
  - **Deferred follow-up:** standing-risk step 6 (`runGit` gets `GIT_DIR` and `GIT_WORK_TREE`). See step 6 below.
  - **Caveat:** `serve/static.ts` L85:11 and L86:12 are equivalent in practice, not formally (see 2c).

**Standing risk under 2.1h (open 2026-11-04, not a task; no Stryker run in the main checkout until the isolation decision is made)**

A Stryker run can switch the main checkout to another branch. It has happened three times, and it is not fixed.

- **Trigger and context.** Stryker runs the tests of a mutant in `.stryker-tmp/sandbox-*`, inside the real checkout, and the sandbox has no `.git`. A git call whose folder is in the sandbox then finds the main repo. Incidents: 2026-11-03, recorded only in a comment in `vitest.mutation.config.ts`; 2026-11-04 12:57, during a forced cms-server run in the main checkout (`cms/work` created from `origin/main` at 12:57:39 and checked out, restored at 12:59); 2026-11-04 17:12, during the 2c `git/exec.ts` run (`cms/work` checked out, then checked out again at 17:15, restored by the 2c agent). `cms/work` was `d88efdf` each time and had no commits of its own.
- **Hypothesis.** (a) The guard `GIT_CEILING_DIRECTORIES` in both mutation configs is set to `process.cwd()`, the sandbox root itself. A ceiling only stops the search above it. Probe, 2026-11-04: with the ceiling set to the working folder, `git rev-parse --show-toplevel` still printed the main repo; with the ceiling set to its parent, git stopped. (b) `test/helpers/git.ts` line 13 overwrites the variable with `.test-tmp`, which sits inside the sandbox, so a git call made from the sandbox root or from `cms-server/` still climbs. (c) The 17:12 trigger is probably a mutant that changes the cwd of a git call in `exec.ts`, the case the config comment describes. Not verified: the log does not say which mutant ran. (d) **Most likely source of the branch creation:** the product's own `syncRepo` in `repo.ts`, run by a test inside the sandbox. When `cms/work` is missing it runs `branch cms/work origin/main`, then `checkout --force cms/work`. The 12:57 timing fits: the branch was created at 12:57:39 and the switch followed at 12:57:40. Not proven: no test has been identified as the caller. Ruled out as the source: the transcripts of the 2a and 2c subagents contain no branch-creating or `cms/work` checkout command. Their git calls were read-only checks, recovery steps and file restores. The 12:57 run was mine, a forced Stryker run in the main checkout, but I issued no branch command.
- **Subagent worktrees (checked 2026-11-04): not linked.** `git worktree list` shows only the main checkout, and no worktree branch exists. Both wave-6 subagents that ran Stryker (2a, 2c) were launched without `isolation: "worktree"`, so they ran in the main checkout. The 12:57 incident came before any wave-6 subagent and was the lead's own forced run. The 17:12 switch was the 2c run, also in the main checkout. Caveat: subagents from earlier segments are not visible from here. If one used a worktree whose folder was later removed, `git worktree prune` in `syncRepo` would have cleared its record.
- **Tried.** Part 1: `assertOwnRepo` in `repo.ts` refuses a folder whose top level is not itself; `setConfig` writes to the clone's own config; a refusal test; the ceiling in both configs. Part 1 post-fix: five runs did not leak. 2b: the branch and hooks checks after each of six runs.
- **Partly worked.** The config leak (`core.hooksPath` and identity written to the main checkout) has not come back since part 1. Post-fix runs of `repo.ts`, `by-format.ts`, the preview files, and 2b's media and supervisor runs did not switch the branch. The checks catch a switch only after the run, and the restore is by hand.
- **Still fails.** The 17:12 run switched the branch with the ceiling in place. The ceiling is set to the wrong folder, and the helper overwrites it. Causes of 12:57 and 17:12 are unproven.
- **Risks moving forward.** Any Stryker run in the main checkout can repeat it. The remaining plan is git-heavy: `ops.ts` (after 2.5c), `mutex.ts`, the 2.5c commit path, the repo tests. A switch during a run silently invalidates its scores (the 2c `exec.ts` result was lost this way). A forced checkout in the main checkout would also discard uncommitted edits there. That has not happened, but nothing stops it.
- **Recommendation.**
  1. Run Stryker from a separate clone outside the repo tree, for example `%TEMP%\stryker-clone`. Nothing above the sandbox is then a repo, so the climb finds nothing, and the main checkout is never touched. Preferred; do this before 2.5c.
  2. Until then, no Stryker run in the main checkout.
  3. Second layer, if the in-tree run is kept: set the ceiling to the parent of the sandbox root (`.stryker-tmp`), and make the helper append to the existing list instead of overwriting it. Check the list separator on Windows with two paths first.
  4. A guard test: run from the sandbox root, `git rev-parse --show-toplevel` must fail. Fail the run if it does not.

**Action plan (2026-11-04, review; where it differs from the Recommendation above, this plan wins)**

The aim is prevention, not the root cause. Every step works whatever the cause is.

- **Likely mechanism (read from the code, not proven, not to be chased).** `runGit` passes `cwd` to the child process (`exec.ts` L69, L112, L145). A Stryker mutant that empties that object or drops the `cwd` key runs git in the sandbox root, which is above the ceiling (`.test-tmp`), so git climbs to the main checkout. In `syncRepo` (`repo.ts` L106-145), that is `branch cms/work origin/main`, `checkout --force cms/work`, then `clean -fd`. This fits 12:57 (a `repo.ts` run) and 17:12 (an `exec.ts` run). It also fits why the config leak stopped: `setConfig` now writes to an explicit file path, while the branch calls still depend on `cwd`. The worst case is not a lost score: `clean -fd` in the main checkout deletes untracked files.
- **Docs check (Stryker configuration and parallel workers pages).** The sandbox is created inside the project (`tempDirName`, default `.stryker-tmp`) and never contains `.git`. It "does not isolate test runners": all workers share its files. Each worker gets `STRYKER_MUTATOR_WORKER`. Nothing in the docs covers git. The temp repos in `test/helpers/git.ts` are already unique per test (`mkdtemp`), so the shared-files warning is not the cause here.
- **Not linked: shared agent sessions.** The Cursor report (sessions share one checkout, so a switch in one moves all) is a different mechanism. The branch here is the product's `cms/work` at `d88efdf`, so the product code made it. The shared-checkout risk is still real for this project and is covered in step 5.

Steps, in order:

1. **Clean checkout before every run (now, rule).** Before any Stryker run, the main checkout has nothing uncommitted: commit a WIP or stash. A forced checkout then costs nothing. *Done when:* the rule is in the run script (step 3) and refuses a dirty tree.
2. **Tripwire hook (now, about an hour, no `src` change).** Add `.githooks/reference-transaction`: when `VITEST` or `STRYKER_MUTATOR_WORKER` is set, it exits non-zero in the `prepared` state, so no ref in the main checkout can change (branch creation, checkout, HEAD). Vitest sets `VITEST` in its workers and the child git processes inherit it. No test may change the main checkout's refs, so nothing legitimate is blocked. `syncRepo` then fails at `branch cms/work`, before `checkout --force` and `clean -fd`. First check that the installed git runs the hook for both the branch creation and the HEAD update. *Done when:* a manual `VITEST=1 git branch probe` in the main checkout is refused, and the same command without the variable works (delete the probe branch after).
3. **Run script, outside any repo (before 2.5c).** `scripts/stryker-run.mjs <config> --mutate <files>`. It refuses a dirty tree (step 1). It exports `HEAD` with `git archive` into `%TEMP%\avc-stryker\<timestamp>` (no `.git`; not a worktree or a clone, since both have their own `.git` and a worktree shares refs with the main checkout). It installs or links `node_modules`, and sets `GIT_CEILING_DIRECTORIES` to the parent of that folder. It checks that `git rev-parse --show-toplevel` fails there (the guard of Recommendation 4), runs Stryker, and copies `reports/` back. Before and after, it records the main checkout's branch, `HEAD`, the branch list and `core.hooksPath`, and fails the run if any changed. A climbing git call then finds no repo and fails, so the mutant is killed instead of doing harm. *Done when:* one scoped run of `exec.ts` and one of `repo.ts` through the script complete, the checks pass, and the scores land in `reports/`. Recommendation 3 above (ceiling in the in-tree configs) is no longer needed once this is in place; leave the existing ceiling settings as they are.
4. **Only the script runs Stryker.** No raw `npx stryker run`, by the lead or any agent. Add this to the 2.1h rules and the builder brief.
5. **Shared checkout (rule).** Builders that edit code run with `isolation: "worktree"`, so a switch in one session does not move the lead's working tree. A Stryker run still goes through step 3, whichever session starts it.
6. **Product hardening (deferred follow-up, 2026-11-05: the user chose to defer it).** Give the clone's `runGit` calls `GIT_DIR=<repoDir>/.git` and `GIT_WORK_TREE=<repoDir>`, as well as `cwd`, so the clone never relies on repo discovery. In production `.cms/` may sit inside the developer's site repo, where a lost `cwd` would run `checkout --force` and `clean -fd` on their work. This is a `src` change in `exec.ts`/`repo.ts`; ask the user first.

- **The hold ends** when steps 1 to 4 are in place. The 2c items left (`exec.ts`, `log.ts`, the `load.ts`, `static.ts` and `gate.ts` re-measures) then run through the script. If a switch still happens with steps 2 and 3 in place, stop and record it here with the run's mutant list; do not retry.
- **Result, steps 1 and 2 (2026-11-04, uncommitted):**
  - **Step 1:** adopted as the rule. The run script (step 3) does not exist yet, so nothing enforces it; no Stryker run has started since. The tree is dirty now (this workplan edit and the hook file), so commit or stash before the next run.
  - **Step 2:** `.githooks/reference-transaction` added (git 2.53.0 for Windows). With `VITEST=1` or `STRYKER_MUTATOR_WORKER=1`, `git branch` and `git checkout` in the main checkout are refused, and HEAD and the branch list do not change. Without the variables, the same commands work. A git call that climbs out of a folder inside the tree (the sandbox case) is refused. A new repo outside the tree with `VITEST=1` still works. Probe branches deleted. Only the main checkout runs the hook: the CMS clones use an empty hooks folder, and test repos have no `.githooks`.
- **Stop event (2026-11-04, first `exec.ts` run, 20:03 local per the export name).** The main checkout's post-run check reported a change in `refs`, and the scores were not copied. Cause: `refs/t3/…/ordinal/63`, a checkpoint written by the T3 Code app at 19:38, during the run. Branch, HEAD, local config and hooks path were unchanged. Fixed by leaving `refs/t3/` out of the check (`c5c3776`). The command chain also started `repo.ts` after that failure, against the stop rule; the harness ended that run at 164 of 222 mutants, its export was removed by hand, and `node_modules` was intact. Not a branch switch, so no retry was needed beyond the rerun below.
- **Result, step 3 done-when (2026-11-04, runs at 20:03 and 20:47 local, `--force`, uncommitted):** both runs went through `scripts/stryker-run.mjs`, passed the main-checkout check, and copied their reports to `reports/stryker-runs/2026-11-05T01-03-58-910Z/` and `reports/stryker-runs/2026-11-05T01-47-38-437Z/`.
  - `exec.ts`: **99.47%** (167 killed, 22 timeout, 1 survived). The survivor, `exec.ts:73:45` (`'buffer'` becomes `""`), is equivalent: `Buffer.isEncoding('')` is false, so `execFile` sets no encoding either way.
  - `repo.ts`: **96.85%** (208 killed, 7 timeout, 7 survived). Part 1 measured 99.10% with 2 survivors on the same test file (no commit since `636a96e` touches it), so the gap is not explained yet. Survivors: `215:19` (`Number(count)`) and `250:57` (the default array) are equivalent, as in part 1. `269:5` (`() => undefined` in `isRepo`) is equivalent: its only caller uses the result as a truth test. Not yet classified: `250:39` (`AUTHOR.exec(author)` without `trim`), and `260:28` and `261:9` (×2) in `refExists`, where a git error that is not `failed` should be rethrown. No test here covers that path. Checked by hand (2026-11-04, in the main checkout, `repo.test.ts`, 27 tests): all three `refExists` mutants pass every test (`if (true) return false`, `||` for `&&`, and an emptied catch block). So the export's survivors are real gaps, not an artifact of the export. Reverted with `git checkout`. Two tests added in `repo.test.ts` (uncommitted, 29 tests pass on HEAD, tsc and biome clean). "rethrows a timed-out ref lookup…" makes `refExists` see a timeout and expects the start to reject; each of the three `refExists` mutants fails it alone. 250:39 (`AUTHOR.exec(author)` without `trim`) is a real gap, not an equivalent mutant: a `git.author` with a trailing space is refused. "trims the spaces around git.author…" kills it. Survivors left in `repo.ts` after these tests: 215:19 and 250:57 (equivalent), 269:5 (equivalent). Not re-measured by Stryker yet.

#### 2.1i Start code — after 2.3b, 2.4a, 2.7a, 2.9b, 2.11a · DONE 2026-11-03

- Added 2026-11-02. Wave 4 left every part injectable and nothing that
  builds the real server: `startServer(deps)` exists, but no code makes
  `deps`. Add the composition root, `cms-server/src/main.ts`, and a
  `start` script:
  1. `loadConfig(path)` (path from the command line, default
     `cms.config.ts` in the working folder), then `loadSecrets`.
  2. `ensureRepo` (2.3b) with the `.cms` root next to the config,
     including crash recovery, before the server listens.
  3. The media deps from the config (`.cms/<site>/staging/`,
     `.cms/<site>/media.json`, `origins.cms`) (2.7a open item 2).
  4. `loadEditorPage()` passed into `createApp` (2.11a open item).
  5. A `BundleSource`: `directoryBundleSource(dir)` from a `--bundle <dir>`
     argument until 2.9c replaces it; without one, the data routes answer
     `503 no-bundle` and `/api/status` answers `bundle: null`.
  6. The supervisor started on the bundle when there is one, and
     `stop()` on `SIGINT`, `SIGTERM` and server close (2.9b open item).
  7. The logger (2.3b) everywhere; one line at start with the origins and
     the port.
- No new behaviour: only wiring. Keep `main.ts` small; anything with a
  branch worth testing goes into a function with its own test file.
- **Done when:** a test builds the full deps and asserts every route group
  is registered (the wiring test agreed for 2.4a to 2.11a); an e2e test
  starts `main.ts` against a harness repo and a built bundle, gets
  `/api/status`, `/api/schema` and `/`, then stops it and finds no child
  process left. A manual `npm start -w cms-server` opens the editor page.
- Gaps settled (calls, 2026-11-02):
  - **Shape:** `src/main.ts` is thin: it calls `run(argv, env, deps?)` and wires signals.
    `run` (own file, own test) returns `{ server, supervisor, stop() }`; `stop()` closes the
    server and calls `supervisor.stop()`. Killing a process on Windows never runs a `SIGTERM`
    handler, so the e2e calls `run` in-process (the preview node is still a real child) and
    asserts the preview port is free after `stop()`. A unit test covers the signal wiring with
    an injected emitter.
  - **No orphan node:** the preview node exits when its stdin closes (a few lines in the
    renderer's `start.ts`, with a test), and the supervisor keeps stdin open as a pipe. A
    hard-killed cms-server then leaves no node behind on Windows. If this grows, move it to
    2.9c and say so in the Result.
  - **Ports:** the CMS listens on the port of `origins.cms`, the node on the port of
    `origins.preview`, both bound to `127.0.0.1` (design 5.1). A missing or non-numeric port
    fails at start with a plain message. Known limit for the Result: a proxied deployment
    (phase 4) needs separate listen fields.
  - **Paths:** `cmsDir` is `dirname(configPath)/.cms`; the config sits inside the workspace
    (`.cms/` is gitignored there, and builds need the workspace packages, design section 3).
    `previewSiteConfig` is a workspace path, resolved against the config's folder (the
    design's example is `preview-render-server/sites/...`). Change the schema message
    (`config/schema.ts`, `previewSiteConfig`) from "inside the repo" to "inside the workspace"
    and its test. Confirm the resolution against `start.ts` (2.0e).
  - **Bundle types:** the supervisor's `BundleRef` is `{ bundleId, dir }`, the bundle
    source's is `{ dir, identity }`; `main` maps one to the other. Without `--bundle`, the source
    returns `null` (the 503 `no-bundle` and `bundle: null` behaviour exists).
  - **Failures:** `ensureRepo` fails: nothing listens, a plain message, exit code 1. The node
    fails to start: log it and keep listening (2.9c reports it in `/api/status`).
  - **Order:** config, secrets, `ensureRepo`, media deps, editor page, bundle source, listen,
    then the supervisor on the bundle. One log line at start with origins and ports.
  - **`start` script:** `"start": "node src/main.ts"` in `cms-server/package.json` (type
    stripping, no build).
  - **Manual run (user call):** a local bare repo, not GitHub. A script
    (`cms-server/scripts/dev-remote.ts`, run through an npm script) seeds a bare repo from
    `sample-site` into `.dev/remote.git` (gitignored, outside `.cms/`, which is the CMS's own
    state) and writes a gitignored `cms.config.ts` with that `file://` remote, built from a
    committed `cms.config.example.ts`. Add `.dev/` and `cms.config.ts` to `.gitignore`. The e2e
    reuses the harness seeding, not this script. A real GitHub remote is a manual smoke check
    in 2.10a and 2.10d.
  - **E2e:** reuse the bundle `supervisor.e2e` builds; only this e2e run is `[build]`. Run it
    after 2.1g's Stryker run.
- **Result (2026-11-03, Haiku agent, reviewed by the lead):** done; not committed.
  - **Files added:** `cms-server/src/run.ts` (+ `run.test.ts`, 21 tests), `signals.ts` (+
    test), `main.ts` (thin), `scripts/dev-remote.ts` (+ `test/dev-remote.test.ts`),
    `cms.config.example.ts`, `preview-render-server/src/stdin-exit.ts` (+ test),
    `cms-server/test/e2e/start.e2e.test.ts`.
  - **Files changed:** `cms-server/package.json` (`start`, `dev:remote`), `.gitignore`
    (`.dev/`, `cms.config.ts`), `config/schema.ts` and its test (message "inside the
    workspace"), `preview/supervisor.ts` (node's stdin is a pipe), `preview-render-server/src/start.ts`
    (exits when stdin closes), and the renderer test spawns that had `stdin: 'ignore'`, now `'pipe'`
    (with `'ignore'` the node would exit at once).
  - **Deviations:**
    - `--bundle <dir>` is the renderer's build folder. The bundle source reads `<dir>/manifest`;
      the supervisor gets `<dir>`.
    - The start script is `node src/main.ts ../cms.config.ts`, so `npm start -w cms-server`
      finds the repo-root config (npm runs scripts from `cms-server/`). Run with another config:
      `node src/main.ts <path>`. Without an argument, the default is `cms.config.ts` in the
      working folder, as the spec says.
    - The e2e injects `loadConfig`. The real loader rejects the `..` in `previewSiteConfig`.
      Only that path differs.
  - **Evidence:** `tsc -p cms-server` and `tsc -p preview-render-server` clean. Biome clean on
    the changed files (import order fixed in `run.ts`, `run.test.ts` and `start.ts`). Unit:
    run, signals, dev-remote, schema, supervisor (136 passed) and stdin-exit (3). E2e
    `start.e2e` (`run` in-process, a real preview child): 1 passed, run alone with no Stryker.
    Manual: `npm run dev:remote -w cms-server`, then `npm start -w cms-server`: `/` answers
    200 `text/html`, `/api/status` answers `{"bundle":null}`, `/api/schema` answers 503. Killed;
    the port is free afterwards.
  - **Known limits:** a proxied deployment (phase 4) needs separate listen fields. On Windows a
    hard kill sends no SIGTERM, so the preview node ends through its stdin pipe. The e2e checks
    the ports, not the process table. The bundle is read once at start (2.9c replaces the
    source). A node that fails to start is logged, not reported in `/api/status` (2.9c). A hard
    kill makes npm print "Lifecycle script `start` failed"; that is expected.
  - **Left on disk (gitignored, from the manual run):** `.dev/`, `cms.config.ts`, `.cms/` at the
    repo root.

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
  - **Known limit (found in 2.1g, accepted by the user 2026-11-03):** the inline
    comment moves to a replacement node only when both the old and the new node
    are scalars. Replacing a scalar that has an inline comment with a map or a
    sequence drops that comment. Not pinned by a test (a test would fix the
    behaviour in place); `yaml.ts` lines 134-137 survive Stryker for that reason.
    Revisit if a real site needs it.
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

#### 2.3c Mutex, commits, diffs, worktrees — after 2.3b · DONE 2026-11-03

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
- Gaps settled (calls, 2026-11-02): files in `cms-server/src/git/` (`mutex.ts` and the repo
  operations file), one test file each.
  - **Lock API:** `repo.locked(holder, tx => ...)`. The mutating methods (`commitSave`,
    `worktreeAdd`, `worktreeRemove`) exist only on `tx`, so they cannot re-lock and deadlock;
    the lock is not re-entrant. 2.5c takes the revision check, the writes and the commit inside
    one `locked` call. Keep `tx` open to extension: 2.10a and 2.10b add `fetch` and the
    re-apply as further `tx` methods. `showAt` and `changedPaths` work outside the lock: they
    compare commits and do not touch the index.
  - **Timeout:** only waiters time out, with a typed error that names the holder; the holder
    is never killed. The timeout is a parameter, default about 30 s, sized for saves and syncs.
    Publish must not hold the lock for minutes: 2.10d and 2.10e take it, note the commit,
    release it, build on a worktree, then take it again and push only if `cms/work` has not
    moved. This task only provides the lock; that design belongs to them.
  - **`changedPaths`:** the plan text's `origin/<branch>..cms/work` is wrong for a diff.
    After a fetch it would list upstream's changes as reversed edits. Use the merge-base form,
    `git diff --name-status -z --no-renames origin/<branch>...cms/work`, limited to `siteDir`.
    Returns `{ path, status }` with `status` created, modified or deleted; a type change (`T`)
    maps to modified.
  - **Paths:** callers pass site-relative paths and get them back site-relative. `siteDir` is
    joined and stripped only here. `assertRelativePath` runs on every path.
  - **`commitSave(paths, message)`:** the message is passed unchanged (2.10b adds trailers).
    Stage with `add -A -- <paths>` (covers deletions) and commit those paths only. Assert HEAD
    is on `cms/work`. Returns the new sha, or `null` when nothing changed. Hooks and signing
    are already off in the repo config (2.3b).
  - **`showAt(ref, path)`:** text, or `null` when the path is missing in that ref. Binary files
    (images) are 2.7b's concern.
  - **Worktrees:** in `.cms/<site>/worktrees/`; the directory must resolve inside that folder
    (checked). `worktree add --detach`. `worktreeRemove` uses `--force`, then `worktree prune`.
    Leftovers from a crash are pruned inside `ensureRepo`'s recovery (`repo.ts`), so it
    happens in one place.
  - **Tests:** two operations racing, FIFO order, a waiter timeout with an injected clock
    (the error names the holder), release when the callback throws, a `siteDir` variant,
    deleted and type-changed paths, a ref missing in `showAt`, a traversal path refused, and
    a worktree added, removed and a crashed one pruned.
- **Result (2026-11-03, closed out after the fact):** `cms-server/src/git/mutex.ts`, `ops.ts` and `repo.ts`, one test file each (first committed as WIP in `9c4875d`, reviewed with wave 5). Stryker (2.1g, git scope): `ops.ts` 96.5%, `mutex.ts` 97.1%; `repo.ts` has not been mutated (blocked, moved to 2.1h, before 2.5b). Re-checked 2026-11-03 on `phase-2-wave-5`: `cms-server/src/git` tests pass with the rest of the wave 5 scope (595 passed, 1 skipped, 21 files).

### 2.4 Bundle reader and read API — after 2.0b, 2.0c, 2.0d, 2.1c · ∥ 2.2, 2.3

#### 2.4a Bundle reader and list routes — after 2.0b, 2.0c, 2.0d, 2.1c · DONE 2026-11-02

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
- Gaps settled (calls, 2026-11-02):
  - **No config field for the bundle directory.** `createApp` takes a `BundleSource`
    dep; a `directoryBundleSource(dir)` helper serves tests until 2.9c. Code in
    `cms-server/src/bundle/`, routes in `http/bundle-routes.ts`.
  - **`imagesJsonSchema` goes in `preview-contract`** (an array of `imageRecordSchema`),
    exported from the index; the renderer's writer may use it. The other four files use
    the existing contract schemas.
  - **Cache by `bundleId`.** Parsed bundles are cached; the new bundle is swapped in only
    after all five files parse, never half of one.
  - **Status codes.** `GET /api/status` answers `200` with `bundle: null` when there is
    no bundle. The data routes answer `503 { error: 'no-bundle' }`. A corrupt file is
    `500 { error: 'bundle-invalid', message }` naming file and field. Errors use the
    `{ error, message }` shape of design 5.9.
  - **Query rules.** `GET /api/documents` with neither `collection` nor `key` is `400`;
    an unknown collection is `404`; a collection with no documents (D15) is `200` with
    an empty list; `key` answers `501` until 2.4b.
  - **Fixture.** `cms-server/test/fixtures/bundle/`: the real `schema.json` and
    `routes.json` of `sample-site` (2.4c needs them), trimmed `documents.json` and
    `images.json`.
  - **Unit tests only here.** The real-bundle e2e and an assertion that the fixture's
    collection names equal the real build's wait for the `cms-server` e2e project
    (created by 2.9b); the orchestrator adds them after both land.
  - **Wiring.** `AppDeps` becomes an interface with one optional field per route group;
    `createApp` registers a group only when its dep is present. A test builds the app
    with every dep and asserts each group's routes exist. When the last group lands
    (2.9c), the fields become required.
- **Result (2026-11-02):** the bundle reader and the three routes.
  - **Built:** `preview-contract/src/manifest.ts` gets `imagesJsonSchema` (`z.array(imageRecordSchema)`),
    tested in `manifest.test.ts` and `index.test.ts`. `cms-server/src/bundle/`: `read.ts`
    (`readBundle`, `BundleError`, `Bundle`, `DocumentEntry`), `source.ts` (`BundleSource`,
    `BundleRef`, `directoryBundleSource(dir)`), `store.ts` (`createBundleStore`), each with its
    `*.test.ts`. `cms-server/src/http/bundle-routes.ts` (`registerBundleRoutes`) and its test.
    `http/app.ts`: `AppDeps.bundle?: BundleSource` and one registration line; the editor and media
    fields that other agents added are untouched. `test/helpers/bundle.ts` (`FIXTURE_BUNDLE`,
    `bundleFolder`, `removeBundleFolders`): temp copies under `.test-tmp/`.
  - **Calls, beyond the gaps block:** `GET /api/schema` answers `{ collections: [{ name, loader?,
    schema?, error? }] }` in schema.json order (a list, not an object keyed by name).
    `GET /api/documents?collection=` items are `key`, `file?`, `revision`, `format`, `editable`
    (always a boolean), `buildTime`, `buildTimeFields?`; `entryKey` and `title` are left out.
    Check order for `/api/documents`: bundle (503 or 500), then `key` (501), then a missing
    collection (400), then an unknown one (404). `GET /api/status` loads the whole bundle, so a
    corrupt file answers 500 there too. A document's collection is the part before its first
    slash, and a key with no slash is in none. An error reads `<file> at <field>: <message>`
    (`documents.json at [2].revision: ...`), built from the Zod path. A duplicate document key is
    a BundleError. `bundle.json` is read on every request; the other four files are read only
    when its `bundleId` changes, and a new bundle that fails to parse leaves the cached one in place.
    The wiring test is in `bundle-routes.test.ts`, not `app.test.ts`, which another agent is editing.
  - **Biome:** its organize-imports rule moved `imagesJsonSchema` into the sorted `./manifest.ts`
    export block of `index.ts`, so the export is not a bare append line.
  - **Fixture caveat:** `schema.json` and `routes.json` are copies of
    `preview-render-server/.build/sample-site-manifest/` from the 2026-10-31 build, which predates
    2.0c and 2.0d. No build ran, as this task forbids. The tests parse both with the current contract
    schemas. `documents.json` has 6 of the 37 records, with revisions from `revisionOf` and
    `canonicalEntryText` over the real sample-site files. `images.json` has 3 of the src images.
    `bundle.json` is hand-written.
  - **Evidence:** `npx vitest run --project cms-server cms-server/src/bundle cms-server/src/http/bundle-routes.test.ts`:
    4 files, 45 tests pass. `npx vitest run --project preview-contract preview-contract/src/manifest.test.ts preview-contract/src/index.test.ts`:
    2 files, 28 pass. `npm run typecheck -w preview-contract` is clean. `npm run typecheck -w cms-server`
    has no error in the new files; the errors left are in other agents' files (`body.ts`, `media.ts`,
    `server.ts` and their tests). Biome is clean on every file I touched.
  - **Open:** Stryker not run on the new files (TESTING 7). `npm run check` (knip, dependency-cruiser)
    not run, as instructed. `server.ts` passes whatever deps its caller gives, so the running server
    has no bundle routes until a bundle source is wired (2.9c). The list has no `title` (design 5.9,
    "if the data has one"). Replace the fixture's `schema.json` and `routes.json` with a fresh
    sample-site build once a build is allowed.

- **Review fix (2026-11-02):** the build wrote `schema.json` only when the site had a content config, so a site without one gave a bundle the reader refused. The build now writes an empty `{}` in that case (`integration.ts`, test updated).

#### 2.4b Read one document — after 2.4a, 2.2 · DONE 2026-11-03

- `GET /api/documents?key=` (design 5.3): `{ key, value, revision, file,
  format, editable, buildTime, buildTimeFields }`. Reads from the working
  copy through the codecs; Markdown and MDX answer `{ data, body }` (D2);
  `file()` entries by `entryKey`. The revision is computed from the
  working copy, never copied from the manifest, **with the same rule the
  build uses (2.0c; corrected 2026-11-03)**: a document that is one file
  is `revisionOf(file bytes)`; a `file()` entry is
  `revisionOfEntry(raw entry)` (preview-contract), where the raw entry is
  read from the file with the codec's Astro options (dates are `Date`) and
  is not the store's schema-applied data. Without the same options every
  entry looks changed. The 2.4b done-when test checks this against the
  fixture. Put the rule in one function
  (`revisionOfDocument`) that 2.5b and 2.5c reuse. Read-only formats answer
  their flags without a `value`, as the stopgap route does. `404` for an
  unknown key.
- The list route also fills `title` when the data has `title` or `name`.
- **Done when:** the cases of `dev/documents.test.ts` pass against the new
  route (copy them; that file is removed in 2.12a), including ids with
  slashes (D10) and hostile keys; and, for every document of the real
  bundle fixture with its file unchanged, the route's revision equals the
  manifest's (JSON, YAML, Markdown, MDX and `file()` entries of both
  formats).
- Gaps settled (calls, 2026-11-03):
  - **Before the agent:** the orchestrator adds `cms-server/src/codecs/by-format.ts` (`json`, `yaml`,
    `md`, `mdx` to their codecs, `null` for `toml` and `other`, with its own test; the YAML codec must
    give `Date` for unquoted dates, as Astro does) and refreshes the bundle fixture (see 2.4c).
  - **`revisionOfDocument`** lives in `cms-server/src/documents/`; only `revisionOf` and
    `revisionOfEntry` stay in `preview-contract`. The working-copy root is the repo path that
    2.1i's `run.ts` builds, joined with `siteDir`, passed in as an injected dep (no second way to find it).
  - **Read once.** Read a file's bytes once, hash them, and decode the same buffer for the parse.
  - **Unknown or missing.** A key not in the bundle is `404 unknown-document`; a bundle document whose
    file is gone is `404 document-missing`. A document created by a save is not in the bundle: 2.5c
    makes `?key=` check the changeset (2.5b may also report a missing file as deleted).
  - **Codec error on read.** Answer `200` with `editable: false` forced (a `.md` with TOML frontmatter
    has format `md`, which the manifest does not mark read-only), no `value`, and
    `error: { code, message, line?, column? }` from `CodecError`. Keep `revision` when it can be
    computed: a one-file document hashes its bytes even if they do not parse; a `file()` entry in a
    broken shared file gets `revision: null` (so the list item's `revision` is nullable).
  - **List route.** `revision` comes from `revisionOfDocument` over the working copy, so the list and
    `?key=` agree. `title` from `title` or `name`. A parse error in one file never fails the list: that
    document has no `title` and carries the error flag. Read each shared `file()` file once per
    request; skip `editable: false` documents. No cache across requests.
  - **Tests.** Edit the `key` branch of `http/bundle-routes.ts` (it answers `501` today). The
    revision-equality test compares the refreshed fixture `documents.json` to today's `sample-site` files.
- **Result (2026-11-03):** `GET /api/documents?key=` and the list route's revisions, from one function.
  - **Built:** `cms-server/src/documents/revision.ts` (`revisionOfDocument`, used by the list and `?key=`
    routes, and reused by 2.5b and 2.5c) and `read.ts` (the document reader), each with its test. The
    working-copy dep is `RepoState.siteFolder` (repo path joined with `siteDir`), wired in `run.ts` as
    `workingCopy`. `bundle-routes.ts` registers the document routes only when the bundle and the working
    copy are both given. `test/helpers/working-copy.ts` is a temp-copy helper.
  - **Decisions beyond the text:**
    - A document with no file lists `revision: null` and the error flag; `?key=` answers
      `404 document-missing`. Three existing list expectations changed for this.
    - A codec error on read uses the error code `parse-error`, answered `200` with `editable: false`
      forced and no `value`.
    - A missing entry is `404 document-missing`. Only `ENOENT` counts as a missing file. A path that
      leaves the working copy counts as missing.
    - Read-only documents get their revision hashed but are never parsed.
    - `?key=` with an empty value is `404 unknown-document`.
  - **Evidence:** 225 tests pass across 14 files (`cms-server` documents, http, bundle, run, codecs, schema),
    including the revision-equality test against the six fixture documents. Biome and `tsc` clean on the
    touched files. The subagent's own count was 126 across 8 files.

#### 2.4c Schema walker — after 2.4a · DONE 2026-11-03

- `walkMarkers(collectionSchema, value, visit)` yields `{ path, marker }`
  for `cms: 'reference'` and `cms: 'image'` fields through objects, arrays,
  `oneOf` and `anyOf`, and `$ref` into `$defs` (guard against cycles). Used
  by 2.6a and 2.7b.
- **First (2026-11-02):** 2.4a's fixture `schema.json` and `routes.json`
  come from the 2026-10-31 build. Rebuild `sample-site` once (`[build]`,
  alone) and refresh `cms-server/test/fixtures/bundle/` from it, so these
  tests run on today's schema; the e2e drift check keeps it current after.
- **Done when:** tests on the sample's real `schema.json`: the landing
  blocks' `discriminatedUnion` with testimonial references, `authors`
  avatars, nested arrays.
- Gaps settled (calls, 2026-11-03):
  - **Fixture refresh is the orchestrator's**, run alone in the main checkout before 2.4b and 2.4c
    start; 2.4a's tests must still pass on the new fixture. The agent runs no build.
  - **Visit.** `visit({ path: (string | number)[], marker, value })`, read-only. The value is passed
    untouched (2.6a parses string or `{ id }`). A reference array yields one result per item, at the
    item's path.
  - **`oneOf` / `anyOf`.** If the union has a `const` discriminator, walk only the branch whose `const`
    matches the value; if none matches, yield nothing (validation reports it, and 2.6a must not see
    phantom references). With no discriminator, walk every branch whose `type` fits, after resolving
    `$ref`, and accept `type` as an array (`[X, 'null']`). Deduplicate on path plus marker.
  - **Not in the real schema.** The sample's `schema.json` has no `$ref`, `$defs` or `anyOf`: test them
    with synthetic schemas, including a cyclic `$ref`. Also `additionalProperties` (records) and
    `prefixItems` (tuples), if the walker supports them.
  - **Location.** A new file under `cms-server/src/schema/` (the agent names it); no existing file edited.
- **Result (2026-11-03):** `cms-server/src/schema/walk.ts` (`walkMarkers`, `CmsMarker`, `MarkerHit`,
  `MarkerVisitor`, `SchemaNode`, `PathSegment`) and `walk.test.ts` (19 tests). Real-schema tests use the
  landing testimonials union (4 references) and the authors avatar image. Verified by the orchestrator:
  19 walker tests and the 2.4a bundle tests pass; `tsc` and Biome clean.
  - **Choices beyond the text:** the cycle guard is per value position, so a `$ref` cycle that consumes
    no value stops, and a recursive `$ref` through data (a tree) walks the data. A missing or null value
    is not reported. A schema with no `type` fits any value. An unresolved `$ref`, or one not of the form
    `#/$defs/<name>`, throws. A marker on an array reports each item.

### 2.5 Saving — after 2.2, 2.3c, 2.4 · ∥ 2.6a, 2.7a, 2.8, 2.9a

#### 2.5a Write planner — after 2.2, 2.4a, 2.1g · DONE 2026-11-03

- **Scope of the 2.1g gate (2026-11-03):** "after 2.1g" means 2.1g's final done-when: the Stryker
  triage of `frontmatter.ts`, `file-entries.ts` and `yaml.ts`, the files this planner writes through.
  It does not wait for `server.ts` (2.5c), `repo.ts` (2.5b) or the other items moved to 2.1h.
  See "What gates what" in 2.1g.

- **Gaps settled (calls, 2026-11-03).** These supersede the shape and error text below where they differ.
  - **Shape.** `planWrite(changes, ctx)` takes the whole save. `changes` is a list of
    `{ op: 'update' | 'delete', key, value }` or `{ op: 'create', collection, id, value }`.
    `ctx` gives `readText(path)` (the working copy, relative to `siteDir`), the loader data from
    `schema.json`, and `newEntryFormat` from the config. The planner keeps a map of path to running
    text and returns one `FileOp` per path (`{ op: 'write', path, text }` or `{ op: 'delete', path }`).
    Paths are relative to `siteDir`; 2.5c joins them to the repo root. Pure: no file access.
  - **Create in a `file()` collection.** The loader pattern is the file itself (for example
    `src/content/testimonials.json`, with no `base`). The new entry goes into that file through
    `changeEntry` with `op: 'add'`. A missing file is refused with `file-missing`; the planner never
    creates a shared file.
  - **Create in a glob collection.** The path is `base/id.ext`. `ext` is `newEntryFormat`, or else the
    first extension of the pattern. The path, relative to `base`, must match the pattern (`path.matchesGlob`,
    which is Node's built-in). A mismatch is refused with `pattern-mismatch`. The homepage pattern
    `**/-*.{md,mdx}` is checked: `-index.md` matches and `index.md` does not. The existing ids carry the
    dash, so valid creates keep it.
  - **Matcher.** `path.matchesGlob` is used, with no new dependency. `picomatch` is in `node_modules`
    only through Astro and tinyglobby, so a direct import would need your approval. Node 26 prints no
    warning for it.
  - **Refusals.** `..` segments, absolute paths, backslashes and a leading `/` in an id are refused.
    A create whose file already exists is `exists`. A path outside `siteDir` is `outside-site`. Two
    changes to the same key in one save, or a delete and a create of the same key, are `duplicate-key`.
    Several changes to one file are applied in order on the running text.
  - **Delete.** A `file()` entry is removed with `changeEntry` `remove`; the file stays and may become
    `[]` or `{}` (2.2d). Only a glob document that is a file of its own produces `{ op: 'delete' }`
    for its file.
  - **Format.** `codecFor(format)` supplies the codec. `toml` and `other` are refused with `unwritable`.
    Read-only documents (`editable: false`, including documents in `readOnlyCollections`) are refused
    with `read-only`.
  - **Markdown create.** `markdownCodec.write('', { data, body })` writes the frontmatter and the body
    (checked 2026-11-03: `---\ntitle: Hi\n---\nText\n`), and with empty data it writes only the body.
  - **Errors.** One `WritePlanError` with `code` (`read-only`, `unreadable`, `outside-site`,
    `pattern-mismatch`, `exists`, `file-missing`, `duplicate-key`, `unwritable`), the document `key`, and
    `file`, `line` and `column` when a `CodecError` caused it. The planner converts `CodecError`, so 2.5c
    maps one error type to `422`.
  - **Done when (added):** tests for each code above; an `add` to `testimonials.json` and to
    `stats.yaml`; a homepage create that matches and one that does not; a Markdown create from an empty
    file; and two changes to one shared file in one save.
  - **Resolved (2026-11-03):** the planner uses Node's `path.matchesGlob`, with no new dependency
    (approved by the user).

- A pure function from a change (`update`, `create` or `delete`, with its
  value) and the document's record to file operations (write text, delete
  file). Creation derives the path from the collection's loader in
  `schema.json` (`base`, `pattern`) and the id, and the format from
  `collections.<name>.newEntryFormat` or the first extension of the pattern
  (D13). Deleting a `file()` entry removes it from the shared file, and
  the file stays even when it was the last entry (it becomes `[]` or `{}`,
  2.2d); only a document that is a file of its own (glob loader) removes
  the file.
- Refuses read-only documents (`editable: false`) and a path that would
  leave `siteDir`.
- **Done when:** tests for each operation on JSON, YAML, Markdown, MDX and
  `file()` documents, a new entry in a mixed JSON and YAML collection, and
  an id with slashes.

- **Result (2026-11-03, 2.5a):** `cms-server/src/documents/plan-write.ts` and `plan-write.test.ts` (43 tests). Scoped runs over `documents` and `codecs`: 9 files, 310 passed; biome and tsc clean. Nothing committed. Choices where the gaps block was silent: `ctx` also carries `documents` (the bundle's records by key, for file, format and entryKey), `collections` (schema.json loaders) and `config` (`collections`, for `newEntryFormat`); `readText` is async, so `planWrite` is async; every CodecError becomes `unwritable` with file, line and column; an update or delete of a key the bundle lacks is `unwritable`; a `..`, absolute, backslash, or empty or `.` segment is `outside-site`; a `file()` create checks for an existing entry first, so a duplicate is `exists`; `yml` maps to yaml; a delete takes no value.
  - **Open (for 2.5c):** a create into a read-only collection is not refused. The list is `readOnlyCollections` in the preview site config; `documents.json` carries it only per existing document, and a new key has no record. Options: a read-only flag per collection in `schema.json` (a small preview-render-server change), or cms-server reads the site config. Recommended: the `schema.json` flag, since the fixtures collection can be empty.

#### 2.5b Changeset state from git — after 2.0j, 2.3c, 2.4b · DONE 2026-11-04

- **Also (2026-11-03, from 2.5a):** expose the changeset's created documents in the shape of a bundle document record (key, file, format, `entryKey`), so 2.5c can add them to `planWrite`'s `ctx.documents`. Without them, a second save that edits a document the first save created is refused. Add a test for it.

- **Decisions (2026-11-03, review; they override the bullets below where they differ):**
  - **Base is the merge-base.** The base of each document is its revision at `git merge-base origin/<branch> cms/work`, the same baseline `changedPaths` uses (2.3b). A new `Repo.mergeBase()` reads it without the lock, like `showAt`. After a sync, `cms/work` sits on the new `origin/<branch>` and the merge-base moves forward by itself, so there is no second baseline.
  - **Bytes first.** Add `showAtBytes(ref, path): Buffer | null` to `ops.ts`, and let `showAt` decode from it. A base revision hashes the bytes, so a BOM or invalid UTF-8 cannot change a hash.
  - **Revision split, in `cms-server`.** Extract the pure part of `documents/revision.ts` so it takes bytes (or text) and the parsed value, and let `revisionOfDocument` reuse it. Do not edit `preview-contract/src/revision.ts`. This lands before 2.1h mutates `documents/` (2.1h part 1, step 4).
  - **Document from a path.**
    - A glob document is its own file. For an existing document the key comes from the bundle record. For a created one, the key follows Astro's glob id rule (checked 2026-11-03 in `node_modules/astro/dist/content/utils.js`, `getContentEntryIdAndSlug`, and `generateIdDefault` in `loaders/glob.js`): the id is `data.slug` (as `String()`) when the frontmatter sets it; otherwise the path under `base` with only its last extension stripped, split on `/`, each segment through `github-slugger`, and a trailing `/index` removed (`blog/index.md` is `blog`). Test: a created document's key equals the key a `sample-site` build gives it, with a mixed-case and spaced file name (`My Post.md` is `my-post`) among the cases.
    - **Custom `generateId`:** decided in 2.0j (`customId` on the loader record). A create into such a collection is refused there, so the rule below never sees one.
    - **Create path and round trip (decided 2026-11-03).** One pure function in `documents/` gives the key from a path and the frontmatter `slug` (the rule above). `planWrite` builds `base/id.ext` as now, computes the key back from that path and the value's `slug`, and refuses the create with `pattern-mismatch` when it differs from the requested id. The message names both. `planWrite` does not slug the id itself, so a caller asking for `My Post` gets that refusal, not a silent `my-post`. `pattern-mismatch` is my choice of code (no new code, no 2.5c mapping change). The round-trip refusal stays in place.
    - A `file()` path is parsed on both sides, and entries are compared by `entryKey` (array item `id` or `slug`, or the object key, as `manifest/documents.ts` does around line 189). A file that holds no document is ignored.
  - **Output.** `{ documents: [{ key, status: 'created' | 'modified' | 'deleted', baseRevision (null when created), value (absent when deleted), overwritten? }], createdRecords }`. `createdRecords` are bundle-shaped (key, file, format, `entryKey`) for 2.5c's `ctx.documents`.
  - **Starts after 2.0j merges.** Both change `documents/plan-write.ts`, and 2.0j runs first and alone. The round-trip refusal is written on top of the merged 2.0j code (its `read-only` and `customId` checks), and its message names both ids. The `pattern-mismatch` code does not change the 2.5c mapping.
  - **Slugger dependency (approved 2026-11-03).** Add `github-slugger` to `cms-server`'s dependencies at exact `2.0.0`: the version Astro 7.4.2 resolves (`node_modules/github-slugger`; Astro's own range is `^2.0.0`). `cms-server` is ESM (`"type": "module"`), so the import needs no change. Check that knip and the dependency checks accept it.
  - **Test source.** The `sample-site` build for the comparison runs alone (`[build]`). The test compares the shared function with the keys that build gives, including `My Post`, a `slug` frontmatter case and an `index.md` case (with a pattern that matches it).
  - **Trailers are read now.** `Repo.overwrittenSince()` runs `git log` over `origin/<branch>..cms/work` with `%(trailers:key=CMS-Overwrote,valueonly)`, and a pure parser reads the values. Split each value at its last space (a `file()` id may contain spaces). When a key repeats, the newest commit wins. Tests use hand-made commits (`git commit --trailer`). This makes the trailer format a tested contract that 2.10b must write.
  - **Route.** `GET /api/changes` lives in `http/` and always answers `200`. A broken document is reported with its own `error` (`code`, `message`, `line?`, `column?`), not with a `409`: `409` is `PUT`'s answer (2.5c). A `file()` entry that is new at base is `created`. The earlier "key missing at base but marked modified" case is dropped, since the diff cannot produce it.
  - **Errors are reported, not refused.** An unparseable shared file on either side: that document carries `error`. A read-only, `toml` or `other` document changed by hand: reported, not refused (refusing is 2.5c's `PUT`).
  - **File ownership.** 2.5b owns `ops.ts`, the `documents/` changeset and revision code, and the `http/` route. 2.1h does not edit them.
  - **Stryker.** 2.5b runs no Stryker. It closes only after 2.1h part 1 has scored `repo.ts`.
  - **Done when, added:** the cases above; a `file()` entry added and another edited in one save; an upstream push to another entry of the same shared file is not a change; a second save to a created document; the created key matches the built key (the shared function against a real `sample-site` build, with `My Post`, `slug` and `index.md` cases); the round-trip refusal; the trailer parser cases; `GET /api/changes` answers `200` with a per-document `error`.
- `GET /api/changes`: the documents that differ between `origin/<branch>`
  and `cms/work`, each with its saved value (or deleted) and its **base
  revision**, which is its revision at `origin/<branch>` (superseded by the merge-base decision above). No side file:
  state lives in git so a crash can't desync it **(call)**.
- Commit messages carry trailers (`CMS-Overwrote: <key> <upstream-sha>`);
  2.10b writes them and this task reads them to fill `overwritten`.
- **Done when:** after two simulated saves to the same document the
  changeset has one entry with the original base revision; a deleted
  document and a created one appear.
- **Result (2026-11-03):** `cms-server/src/documents/changeset.ts` (`changesetOf`), `documents/paths.ts` (the glob id rule as Astro 7 gives it, `formatOfExtension`, `formatOfPath`, `relativeToBase`, `collectionOf`, `slugOf`), `http/changes-routes.ts` (`GET /api/changes`, registered by `createApp` with `repo`), `git/ops.ts` (`showAtBytes`, `mergeBase`, `overwrittenSince`, `parseOverwrote`), `git/exec.ts` (`runGit` with `binary`), `documents/read.ts` (`entriesOf`, `fileRead`), `documents/revision.ts` (`entryRevision`, `errorOf`, `DocumentError`). `planWrite` refuses a create whose id the build would not give (`pattern-mismatch`, both ids named). `github-slugger` 2.0.0 is a `cms-server` dependency. `run.ts` makes one `openRepo` per start. Departures from the bullets above: (a) `GET /api/changes` answers 503 with no bundle and 500 for a bundle that does not parse, as the other bundle routes do; a document that cannot be read answers 200 with its `error`. (b) `createdRecords` are full bundle records (`buildTime: false`, `revision`); a created document in a format with no codec is reported with its `error` and not listed. (c) `overwritten` is the upstream sha of the newest trailer. (d) Bytes come from `git cat-file blob`, which does no textconv. (e) No `sample-site` build runs in the tests: the Decisions' "Test source" and the "created key matches the built key" check compare against fixed ids. `paths.test.ts` hard-codes the ids Astro 7's `getContentEntryIdAndSlug` gives for `My Post`, `slug` and `index.md` (checked 2026-11-03), and checks each glob document of the fixture bundle (a sample-site build) against its file path. Checks: `src/git`, `src/documents`, `src/http`, `src/bundle`, `src/run.test.ts` (467 passed, 1 skipped, the skip pre-existing), cms-server e2e (7 passed), Biome, typecheck, depcruise clean. Knip reports unused exports that predate this work. No Stryker run (2.5b runs none). 2.1h part 1 step 4 is no longer blocked by the revision split, and `plan-write.ts` is free for 2.1h now that 2.5b has closed.

#### 2.5c `PUT /api/changes` — after 2.5a, 2.5b, 2.0h, 2.0j, 2.10a (merged; both edit `git/ops.ts`) · DONE 2026-11-05 (Stryker run; see Result)

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
- Note (2026-11-03): `GET /api/documents?key=` (2.4b) only knows documents in the bundle. This task
  makes it also answer for documents created by a save, by checking the changeset (2.5b).
- **Done when:** tests for a good save, two documents in one save, a stale
  revision (`409`), a `422`, a refinement that threw, a failed rename
  restoring the tree, and a build-time field.
- **From 2.5a (2026-11-03), to settle before the agent runs:**
  - `planWrite` takes the bundle's documents in `ctx.documents` and refuses an update or delete of a key it lacks (`unwritable`). A second save that edits a document the first save created would be refused. 2.5c must add the changeset's created documents (2.5b) to `ctx.documents`, with a test.
  - A create into a read-only collection is not refused: settled by 2.0j (flag per collection in `schema.json`, approved 2026-11-03). 2.5c passes it to `planWrite`.
- **Gaps settled (calls, 2026-11-04, review).** Wave 6, after 2.10a merges. Files: `http/changes-routes.ts` (the route), a new `save/` folder (the stages), `git/ops.ts` (`tx.restore`), `http/app.ts`, `run.ts`.
  1. **Restore.** `tx.restore(paths)` in `ops.ts`: `git checkout HEAD -- <paths that exist in HEAD>`, then `git clean -f -- <paths>` for created files. It runs inside the same `locked` call as the writes. A crash mid-save is already covered by `syncRepo`'s `checkout --force` and `clean` at start.
  2. **Pipeline.** A stage is `(ctx: SaveContext) => Promise<SaveStop | undefined>`: it returns a response to stop, or `undefined` to continue. The pipeline is an ordered array with named slots (the delete guard, images and warnings). 2.6b, 2.7b and 2.7c add stages at their slots without editing each other's files. `SaveContext` also carries `afterCommit`, a list of hooks (see item 9).
  3. **Lock and conflict.** Body parsing (Zod, `Content-Type`, `Sec-Fetch-Site`, 4 MiB cap) runs before the lock. Everything from the revision check to the commit, validation included, runs in one `locked('save')` call. The `409 conflict` value comes from `documents/read.ts` and `revisionOfDocument`. `PreviewClient.validate` has a 10 s timeout, well below `DEFAULT_LOCK_TIMEOUT_MS` (30 s). On a timeout nothing is written and the answer is `503 preview-unavailable`. A slow validate delays sync and publish; that is accepted. 2.9d implements the client against this timeout.
  4. **Validation payload.** The new value of every created or updated document (deletes skipped) plus `cms-server`'s own media map (D12). The design's "scratch copy" is `planWrite`'s in-memory output: nothing touches disk before validation passes.
  5. **Statuses and bodies.** An empty `changes` list is `400 invalid-body` (`min(1)` in Zod). `planWrite` stops at its first refusal, so the body is one error: `{ error: <code>, key, message, file?, line?, column? }`, the last three copied from `WritePlanError`.
     | `planWrite` code | Status |
     | --- | --- |
     | `duplicate-key`, `outside-site`, `pattern-mismatch` | `400` |
     | `exists`, `file-missing` | `409` |
     | `read-only`, `unwritable`, `unreadable` | `422` |
     Validation errors: `422 { error: 'invalid', errors: [{ key, path, message }] }`. Clients tell `409`s apart by `error`: `conflict`, `referenced-by` (2.6b), `exists`, `file-missing`.
  6. **`GET /api/documents?key=`.** The handler checks the bundle, then the changeset's `createdRecords`, computed per request with no cache. The same records go into `planWrite`'s `ctx.documents`. Tests: create a document then GET it; create it then update it in a second save.
  7. **`rebuild`.** True when, for some document, the value at a `buildTimeFields` path differs between the stored and the new value (canonical JSON), or when a document that has `buildTimeFields` is deleted. A create never sets it: its record has `buildTime: false` (`changeset.ts`), and the design's trigger table has no "created" row.
  8. **Commit message.** Subject `CMS save: <n> document(s)`, body one `<status> <key>` line per document. No trailers (2.10b writes them).
  9. **After the commit.** `ctx.afterCommit` is a list of hooks (2.6b registers the reference index update). They run inside the lock, right after the commit, so a sync's `rebuild()` cannot interleave. A failing hook does not fail the save: it logs and marks the index for a full `rebuild()` on the next read.
  10. **Response.** `200 { revisions: { [key]: revision }, warnings: [], rebuild: boolean }`. `revisions` lists created and updated documents, not deleted ones. `warnings` and `rebuild` are always present (`warnings` is empty until 2.7c).
  11. **Stryker.** 2.5c runs none. After it lands on `phase-2-wave-6`, through the script and one file at a time: `save/`, `http/changes-routes.ts`, the rest of `http/` (2.1h 2b step 3), `git/ops.ts` with `restore`, `schema/walk.ts` (after 2.6a) and `documents/paths.ts`.
- **Result (2026-11-05, Haiku agent, reviewed by the lead).** Done: the pipeline in `save/` (`body`, `conflicts`, `plan`, `validate`, `rebuild`, `write`, `pipeline`, `context`), `tx.restore` in `git/ops.ts`, `PUT` in `http/changes-routes.ts`, `GET /api/documents?key=` finds created documents, `run.ts` registers the save route. 16 test files, 279 tests pass (`src/save`, `src/http`, `git/ops`, `run`); typecheck, lint and format clean. Not run: Stryker (item 11), the full suite, e2e. Calls the agent made where the plan was open:
  - Body `{ changes: [{ document, baseRevision, data?, deleted? }] }` (design 4). A create is `baseRevision: null` on a key neither the bundle nor the changeset holds; a key with no collection is `400 invalid-body`. An update or delete of a missing document is `409 conflict` with `revision: null`.
  - The bundle is read inside the lock (`saveChanges` takes a `BundleStore`); its `503 no-bundle` and `500 bundle-invalid` are copied from `withBundle`, not shared.
  - `restore` runs `git reset`, then `checkout HEAD` for paths HEAD has, then `clean -f` for the rest (the plan said checkout and clean; the reset unstages added files).
  - The media map for validate is every entry of `media.json` (see 2.7b).
  - **Review fixes (2026-11-06, `05301ef`, a review of the 65 commits since `d88efdf`):** a failed binary git call kept a Buffer as stderr, so `GitError` threw a TypeError (`git/exec.ts`; test: a real failing `cat-file` in a non-repo folder). `GET /api/documents?key=` answers 500 `changes-unavailable` when the changes of an unknown key cannot be read, instead of a 404 that says the key is absent. A changed `file()` file that does not parse and holds no bundle document is listed in `fileErrors` (`GET /api/changes`). A failed restore no longer hides the save's error. A failed revisions read after the commit answers 500 `save-committed` (the save is in git; the client reloads). Comments corrected in `git/ops.ts` (three-dot diff) and `git/repo.ts` (case is not folded).
  - **Left open** (each is noted in the task that takes it): a failing after-commit hook is logged, not marked for rebuild (2.6b); `refinement-threw` keys are not stored (2.10e); the 10 s validate timeout is not in the pipeline (2.9d); every real save answers `503` until 2.9d. Also open, assigned to 2.6b (2026-11-06, wave 6 close-out): if `tx.restore` throws during a failed save, or `revisionsAfter` throws after the commit, the route answered a bare 500 instead of the JSON body (fixed in `05301ef`, see Review fixes); the "failed rename" test injects a failing write call, not a real rename failure.
  - **Stryker, first run (2026-11-05, `save/` plus `http/changes-routes.ts` and `git/ops.ts`, concurrency 8, 12 min):** 93.62% overall. Per file: `conflicts.ts` 100, `validate.ts` 100, `plan.ts` 97.87, `pipeline.ts` 96.77, `changes-routes.ts` 96.43, `write.ts` 95.31, `ops.ts` 93.75 (13 survived, not yet classified), `body.ts` 90.24, `rebuild.ts` 76.36 (below 90: fixed below). `reports/stryker-runs/2026-11-05T16-11-02-718Z/`.
  - **Stryker, `rebuild.ts` (2026-11-05, commit `bd93270`):** 76.36% → 94.55%. Four tests added (a field added or removed; a field missing on both sides; a path through null, a string, or an array; an own `__proto__` key). The 3 survivors left are equivalent: `canonicalEntryText(undefined)` is `undefined` (`JSON.stringify(undefined)`), so the guard on lines 30–31 of `rebuild.ts` gives the same answer as the plain comparison in every case. `reports/stryker-runs/2026-11-05T17-00-38-811Z/`.
  - **Stryker, `git/ops.ts` (2026-11-05, commit `749dab4`, after four restore, sync and worktree tests were added):** 98.53% (257 killed, 11 timeout, 2 survived, 2 no coverage). `reports/stryker-runs/2026-11-05T17-25-48-155Z/`. Classification of the first run's 13 survivors and the new run's leftovers:
    - **Killed by the new tests:** the empty-list guard of `restore` (57); `clean -f` with no paths removing an unrelated untracked file (90, 92); a bundle-store error that is not a `BundleError` (193); the `GitError` branch of `syncErrorOf` (196, and its plain-error branch, 200, 201); the `assertRef` call in `worktreeAdd` (138).
    - **Equivalent:** the `''` filter in `restore`'s `inHead` set (70, 73, 76), since no repo path is `''`; `created = full` (79), since `git clean -f -- <tracked path>` removes nothing (checked); the `tracked.length >= 0` and `> 0` guards (82, 84), since `git checkout HEAD --` with no paths keeps the branch and the working copy (checked); the `recursive` option of the worktrees `mkdir` (139, 140), since the clone lives in `<cmsDir>/<site>/repo`, so `<cmsDir>/<site>` exists before any worktree is added; the `''` fallbacks in `parseNameStatus` (237, 239), since `git diff -z --name-status --no-renames` always gives status and path pairs.
    - **Timeouts, not assertions:** 15, 41, 45 are timeouts in both runs. 154 and 210 were killed in the first run and timed out in this one, so the timeout bucket is not stable. Stryker counts timeouts as detected, but none of them is a clean kill. The assertion-only score is 257 of 272 = 94.5%, which still clears 90 without them.
    - **Stryker, `schema/walk.ts` (2026-11-05):** 96.40% in the first run (8 survived), 98.20% after the tests of `2ac7def` and `70d4a01` and the rerun `reports/stryker-runs/2026-11-05T18-12-27-880Z/`: 215 killed, 3 timeout, 4 survived. Run before 2.6a, as 2a step 1 asks; item 11 says after 2.6a, and 2.6a has no commit yet, so 2.6a may change this file and the scores need a rerun then.
      - **Killed by the new tests:** a `$ref` to `#/$defs/__proto__` throws (no mutant was killed by this one; it guards the own-property lookup); a `$ref` outside `$defs` throws even when `$defs` has a key named `undefined` (125); a `null`-typed branch is walked for `null` and not for a string, shown by a bad `$ref` inside it (168, 169, 171).
      - **Equivalent:** 150, the `undefined` check in `constOf`, is unreachable (`discriminatorOf` only calls `constOf` on branches it already resolved); 154, the `hasOwn` check in `constOf`, gives the same result (an inherited key is a function or `Object.prototype`, and its `.const` is undefined); 200, `Number.isInteger` is false for any non-number; 203, the `default` clause of `matchesType`, is only read by `names.some`, which treats undefined as false.
      - **Timeouts:** 115, 117, 118 are the cycle detection in `resolved`. Under those mutants the existing cyclic-`$ref` test loops forever, so the hang is deterministic.
    - **Stryker, `documents/paths.ts` (2026-11-05):** 98.39% in the first run, with one survivor: `isRecord` treats `null` as a record (mutant 78), so `slugOf(null)` would throw. Added an assertion for `null` (`paths.test.ts`). Rerun `reports/stryker-runs/2026-11-05T18-08-53-277Z/`: 100%, 62 killed, nothing survived.
  - **Stryker, `save/` and `http/changes-routes.ts` survivors (2026-11-05, commit `8488314`, one file per run):** the first run's unclassified survivors.
    - `write.ts` 95.31 to 100. Survivors 660, 662 and the message 665 are killed by two new tests: a document whose file is gone after the commit, and a shared file that no longer parses after it. Both throw, naming the document.
    - `plan.ts` 97.87. Survivor 47 is equivalent: the `'update'` literal in `writeOf` becomes `''`, and `planExisting` takes the same branch for any op other than `create` or `delete`.
    - `pipeline.ts` 93.55. Survivors 29 and 30 are equivalent: the initial `plan: []` and `refinements: []` are overwritten before any read (`planChanges` at `plan.ts:45`, `validateChanges` at `validate.ts:45`; nothing else reads `refinements`). A bundle error that is not a `BundleError` is now rethrown, with a test.
    - `changes-routes.ts` 96.43 to 100. Survivor 303 (`instanceof BodyTooLargeError` made `true`) is killed by a body that fails while it is read: it answers 500, not 413.
    - `body.ts`. Survivor 356 and no-coverage 358 to 360 are in the `issue === undefined` guard of `parseSaveBody`. zod's failed parse always has at least one issue (checked), so nothing reaches the guard. Equivalent, no test.
    - `conflicts.ts` and `validate.ts` have no survivors.
    - Reports: `reports/stryker-runs/2026-11-05T20-32-10-615Z/` (write), `20-34-15-862Z` (plan), `20-36-15-509Z` (pipeline), `20-38-13-082Z` (changes-routes).
  - **Stryker, rest of `http/` (2026-11-05, item 11; one file per run; commit `d998d28` for the tests of `body.ts` and `bundle-routes.ts`):** first runs, then reruns of the two files that got tests.
    - `app.ts` 100 (26 killed). `editor-routes.ts` 100 (29 killed, 4 timeouts). The timeouts are CSP strings: applied by hand, the change fails the three header assertions at once, so they are killed by assertions.
    - `guard.ts` 94.74. The survivor (`?? ''` made a sentinel) is equivalent: the sentinel matches neither `JSON_TYPE` nor `/^image\//`.
    - `media.ts` 94.92. No coverage 27 and survivors 58 and 63 are equivalent. A missing content type is already a 404 from `rejectUnlessContentType` before line 51. For an unknown format, `bytes` is `undefined` too (the ternary), so line 95 answers 404 whichever operand is tested, and `readStaged` returns `undefined` for an unknown format.
    - `body.ts` 93.75 to 100 (2 killed, `d998d28`): a declared length of exactly the cap is accepted; an over-cap declared length is refused with no body to cancel. `reports/stryker-runs/2026-11-05T21-18-05-836Z/`.
    - `bundle-routes.ts` 92.68 to 98.78 (the first run's 12 survivors, then the rerun). Killed by new tests (`d998d28`): the created-record lookup (103), the MDX title from data (141, 143), a non-string `name` (151), and the null value (146 and the `isRecord` group). Survivors left, equivalent: 120 (`title: undefined` is dropped by JSON) and 161 (`typeof value === 'object'` made `true`: a primitive has no `title` or `name`, so `titleOf` gives the same result). Timeouts 84, 85, 89 and 99: applied by hand, each fails its assertions (99 throws a `TypeError`), so they are killed. `reports/stryker-runs/2026-11-05T21-19-43-348Z/`.

### 2.6 Delete guard — after 2.2, 2.4c, 2.5c · ∥ 2.7, 2.8, 2.9

#### 2.6a Reference index — after 2.2, 2.4c · DONE 2026-11-05 (Stryker on walk, paths and reference-index; see Result)

- For each document, the documents that point at it, built by walking every
  document's value with 2.4c. A reference is a string id or `{ id }`; the
  collection comes from the marker. API: `referrersOf(key)`,
  `update(key, value)`, `remove(key)`, `rebuild()` (startup, after a sync).
  No site code runs.
- **Done when:** tests on the sample's data: authors to posts, testimonial
  entries to landing blocks (inside the union), a self-reference.
- **Gaps settled (calls, 2026-11-04, review).** Files: `cms-server/src/references/` (new), `schema/walk.ts` (small edit), `documents/paths.ts` (`documentKey`).
  - **Collection.** Each reference field node in `schema.json` carries `"cms": "reference", "collection": "<name>"`, and `walkMarkers` did not pass it on. The hit gains an optional `collection`, set only for a `reference` marker whose `collection` is a string (each keyword is checked before use). A reference with no collection is reported without one; 2.6a skips it with a `log.warn`. This edits `walk.ts`, so it is scored again through the script after 2.6a merges (counted in the wave plan).
  - **Key.** `cms-server` has no key builder (the renderer writes `` `${collection}/${id}` `` inline in `manifest/documents.ts` and `overlay/keys.ts`; `cms-server` only has `collectionOf(key)` in `documents/paths.ts`). Add `documentKey(collection, id)` next to `collectionOf`, with a test that rebuilds every key in the bundle fixture's `documents.json` from its collection and id, so drift from the renderer shows. Moving it to `preview-contract` would edit the renderer and is out of scope.
  - **Values.** A reference is a string or `{ id }`. Anything else is skipped without throwing. A reference to a document that does not exist is still indexed.
  - **Scope of the index.** Built over the bundle's documents plus the changeset's `createdRecords` (2.5b), with values read from the working copy. Otherwise a document created in an unpublished save would have referrers the index does not know.

- **Result (2026-11-05; Haiku agent, reviewed by the lead; `a4d1064`, `f6d5654`, `4dc0430` on `phase-2-wave-6`, rebased from an older base).** `documentKey(collection, id)` is next to `collectionOf` in `documents/paths.ts`, with a drift test over the fixture bundle's keys. `walk.ts` gives a reference hit an optional `collection` (only for a string keyword). `references/reference-index.ts` has `referrersOf`, `update`, `remove` and `rebuild`, with `schemaOf` injected and no I/O. The "Done when" cases have tests: authors to posts (a string or `{ id }`), testimonials inside the landing blocks union (a banner's `items` is the near-miss), and a self-reference on a synthetic schema, since the sample has none. Calls where the plan was open: no `splitDocumentKey` (keys are split with `collectionOf`; a `data:` key reads as collection `data:<folder>`, which has no schema); a `rebuild` takes the documents, so 2.6b or startup must read them; a `$ref` that does not resolve throws from `update` and `rebuild`, as `walk.ts` does.
  - **Stryker, `schema/walk.ts` (the rescore that 2.6a asks for):** 97.46 after the 2.6a tests (`reports/stryker-runs/2026-11-05T23-09-04-727Z/`), 6 survived. Four are the 2.1h survivors, moved 17 lines: 261, 263, 295 and 296. They keep their 2.1h classification (equivalent, or tool artifacts). L181 (`typeof node.collection` in the reference branch) is killed by "gives a reference hit no collection when its collection keyword is not a string" (`f6d5654`). L206 (`collection === undefined` as `false`) is equivalent: the hit gets an own `collection: undefined`, which every reader treats as absent. Rerun after `f6d5654`: **97.88** (228 killed, 3 timeout, 5 survived), `reports/stryker-runs/2026-11-05T23-11-09-304Z/`.
  - **Stryker, `documents/paths.ts`:** 100 (64 killed), `reports/stryker-runs/2026-11-05T23-13-22-869Z/`. The first dry run failed on a test that Stryker did not name, and the rerun passed. Not reproduced. The dry run runs every `src` test, including `build-commit.real.test.ts`, so a flake there would be the first suspect.
  - **Stryker, `references/reference-index.ts` (new code, not in the plan):** 76.32 first, then **80.26** after the edge tests (`4dc0430`), `reports/stryker-runs/2026-11-05T23-18-25-283Z/`: 61 killed, 15 survived. All 15 are equivalent for the values the index reads (JSON values; `walkMarkers` never passes null): 41 (the empty fallback never matches a document key), 43 (a dead guard under the index invariant), 45 (two) and 47, 53, 69 (they change only the internal maps, not `referrersOf`), 101 (`&&` for `||`, and the `false` branch of the guard, since a JSON value has no own `id` outside a record), and 107 (six; `isRecord` only turns a primitive or an array into a record with no own `id`). This is below the 90 bar. **Resolved (2026-11-05, the user chose the refactor):** `bcc4b67` removed the dead branches (the `set === undefined` guard, the empty-set deletion, the `targets.size === 0` return, the `?? []` fallback) and the `isRecord` guard (`idOfReference` now reads `Object(value).id`). Rescore: **95.74** (45 killed, 2 survived, 0 no coverage), `reports/stryker-runs/2026-11-05T23-27-10-544Z/`. The 2 survivors are equivalent: `pointsAt.delete` in `unlink` (45:5) and `pointsAt.clear` in `rebuild` (62:7) change only the internal maps' memory, never `referrersOf`.

#### 2.6b The guard in `PUT /api/changes` — after 2.5c, 2.6a

- Fills the stage-3 slot (design 4.3). A deletion with referrers answers
  `409 { error: 'referenced-by', document, referrers }`, unless the same
  changeset changes or deletes every referrer so it no longer points at the
  document. A referrer that is `editable: false` adds
  `needsDeveloper: true`. No force delete.
- **From 2.5c (2026-11-05):** the slot is in `save/pipeline.ts`, `SAVE_STAGES`, between `checkRevisions` and `planChanges`. `ctx.afterCommit` is the hook list; register the index update there. A failing hook is only logged and the save still answers `200`: **2.6b must also mark the index for a full `rebuild()` on the next read** (2.5c item 9; 2.5c did not do it). Hooks run inside the lock, after the commit and before the revisions are read.
- **Done when (design R5):** delete an author alone: `409` listing the
  posts; delete it and clear the field in the posts: `200`; delete the
  author and the posts: `200`; a read-only referrer: `409` with
  `needsDeveloper`.
- **From wave 6 close-out (2026-11-06):** a failing `tx.restore` during a failed save, or a failing `revisionsAfter` after the commit, answers a bare 500 instead of the JSON body (2.5c). Done in `05301ef`: both answer JSON, with tests. The "failed rename" test still injects a failing write, not a real rename failure.
- **Review round 2 (2026-11-06):** `GET` and `PUT /api/changes` answer 500 `changes-unavailable` when git fails, as `GET /api/documents?key=` does (`changes-routes.ts`). A failed save of a new file at a gitignored path removes the file: `restore` runs `git clean -x` (`ops.ts`). A `customId` glob file outside the bundle gets no key from its path (`changeset.ts`). A document key with a control character is refused, since the key is a commit-message line (`body.ts`). `siteCommit` goes through `assertRef` before `git diff`; the bundle schema already refuses such a value, so this is defence in depth.

### 2.7 Media — after 2.1c · ∥ everything

#### 2.7a `POST /api/media` — after 2.1c · DONE 2026-11-02

- Raw image body with an `image/*` content type (multipart dropped
  2026-11-02, design 5.9), 10 MB cap, only image types, measured once with `sharp`
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
- Gaps settled (calls, 2026-11-02):
  - **Raw body, not multipart.** The body is the image, `Content-Type: image/*`, as the
    stopgap and the test editor do. No new dependency; the cap is a byte count; and
    `image/*` is not a CORS-safelisted type, so a cross-site form cannot send it without
    a preflight (multipart would be). Design 5.9 is amended. A test: `OPTIONS /api/media`
    answers no CORS headers.
  - **Streaming bridge.** `server.ts` passes the Node stream as the `Request` body
    (`duplex: 'half'`) for every route. `readBody(request, maxBytes)` is the only way
    any route reads a body (`PUT /api/changes` later uses it with its 4 MiB cap). It
    checks `Content-Length`, then counts bytes and rejects at the cap with `413`. Up to
    10 MB may be held in memory; nothing is written until the body is complete and
    measured, so a disconnect leaves no file. The `413` test accepts a clean `413` or a
    connection reset.
  - **Names and types.** `id` is the sha256 hex; the file is `<64 hex>.<ext>` (the
    stopgap used 16 hex, so the near-miss tests change; the stopgap's own tests stay until
    2.12a). The extension comes from sharp's measured format (`jpg` for jpeg), never the
    declared type. Only png, jpg, webp, avif and gif; SVG and TIFF are `415`.
  - **Absolute URL.** `url` is built from `origins.cms`
    (`http://cms.localhost:4400/media/staging/<sha>.<ext>`), because a relative URL
    resolves against the preview origin inside the iframe. The renderer looks the media
    map up by the exact `ref` first, so no renderer change is expected; this task adds a
    `content-api.test.ts` case with a URL-shaped key, and the orchestrator adds a
    `d12-media` e2e case. 2.7b recognises staging URLs by that prefix.
  - **GET is not guarded against cross-site** (the preview iframe is cross-site by
    design). It answers `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy:
    cross-origin` and `Cache-Control: public, max-age=31536000, immutable`. Write routes
    use the shared guard `http/guard.ts` (content type and `Sec-Fetch-Site: cross-site`
    refused).
  - **Bomb test.** A hand-built PNG (huge IHDR, deflated zeros) streamed in the test;
    `limitInputPixels` stays on, as an explicit constant.
  - **`media.json`.** Writes go through one in-process queue (two uploads cannot lose an
    update), via `cms-server/src/fs/atomic.ts` (temp file plus rename; 2.9c reuses it).
    On Windows a rename over an existing file can fail with `EPERM` or `EBUSY` while an
    indexer holds it: retry a few times with a short delay. Directories are injected as
    `{ stagingDir, mediaFile }`.
- **Result (2026-11-02):**
  - **Built.** `http/media.ts` (`mediaRoutes`: `POST /api/media`, `GET /media/staging/:file`);
    `http/body.ts` (`readBody`, `BodyTooLargeError`, the only body reader); `http/guard.ts`
    (`rejectCrossSite`, `rejectUnlessContentType`); `fs/atomic.ts` (`writeFileAtomic` with
    `EPERM`/`EBUSY` retry, `errorCode`); `media/measure.ts` (sharp, `limitInputPixels`
    fixed at 0x3fff squared, five formats); `media/staging.ts` (hashed names, atomic
    write, `stagedFormat`); `media/metadata.ts` (`media.json` with a per-file queue).
    `server.ts` streams the body (`Readable.toWeb`, `duplex: 'half'`). `app.ts` gets
    `AppDeps.media` and one registration. Every new source file has its own test file.
    `test/helpers/png.ts` builds the bomb header. The content-api case is added.
  - **Calls and deviations.** Declared type is checked against the stopgap's five types
    (415 otherwise), and the measured format must also be one of the five. The extension
    comes from the bytes only, so PNG bytes declared `image/jpeg` are stored `.png`.
    Guard statuses are the stopgap's (404 wrong type, 403 cross-site). AVIF arrives from
    sharp as `heif` with `av1` compression and is named `avif`. `media.json` is keyed by
    the sha256 id. The `413` stream test accepts `413` or a reset, as settled.
    `server.test.ts` now calls `closeAllConnections()` in its close helper: without it a
    refused upload kept the test waiting about 5 s. The disconnect test at server level waits
    50 ms, so it is time-based; the deterministic check is in `http/media.test.ts`.
    `test/helpers/app-deps.ts` (another agent's shared fixture) gets a placeholder `media`
    field, because `AppDeps.media` is required. The stopgap files are untouched.
  - **Evidence.** `npx vitest run --project cms-server` on `src/fs`, `src/http`,
    `src/media` and `src/server.test.ts`: 11 files, 157 tests pass. `npx vitest run
    --project preview-render-server .../content-api.test.ts`: 79 pass (new case included).
    `npm run typecheck -w cms-server`: clean. `npx biome check` on the touched files:
    clean. Not run, as instructed: the whole suite, `npm run check`, e2e, builds, Stryker,
    depcruise, knip.
  - **Open items.** (1) `d12-media` e2e case, orchestrator. (2) Nothing builds
    `MediaRouteDeps` from `cms.config.ts` yet (`.cms/<site>/staging`, `media.json`, and
    `origins.cms`). (3) depcruise and knip rules for the new `fs/` and `media/` folders,
    and a Stryker re-run on the changed files. (4) A damaged `media.json` makes every
    upload fail with a named error until it is fixed; it is not reset silently. (5) The
    rename retry is proved with an injected rename, not with a file that an indexer holds.
    (6) The bomb test uses a header-only PNG, so it proves the pixel limit and not a real
    decode. (7) 2.7b recognises staging URLs by the prefix `${origins.cms}/media/staging/`.

#### 2.7b Images at save time — after 2.5c, 2.7a, 2.4c

- A stage in the save pipeline. For every `image` marker whose value is a
  staging URL: copy the file into `media.folder` (named by hash, reusing an
  existing file with the same hash), write the value as a path relative to
  **the file that holds the document** (D5), and record the metadata in
  `media.json`. The media map passed to validate is `cms-server`'s own,
  never the editor's (D12).
- **From 2.5c (2026-11-05):** the slot is in `save/pipeline.ts`, `SAVE_STAGES`, after `validateChanges` and before `writeChanges`. Today `validateChanges` builds the media map from **all** of `media.json`, with URLs `${cmsOrigin}/media/staging/<id>.<format>` (`mediaMapOf` in `save/validate.ts`); confirm it here once images move into place. The body has no `media` field yet (`save/body.ts`): add it here if the editor must send one.
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
  Review fix: `serveStatic` now resolves the served file with `realpathSync` and
  refuses it unless its real path is inside the real client folder, so a symlink
  that points outside (file or folder) is not served.

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
    lines 67, 145, 160 and 310, `DOCS/Guidelines/QUALITY-TOOLING.md:355`, and
    `DOCS/Designs/PHASE-2-DESIGN.md:510` (describes the removal, so it is current).
    `DOCS/Designs/SYSTEM-DESIGN.md:1334` and `DOCS/Workplans/WORKPLAN-PHASE-0-1.md` are history.
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

#### 2.8e End-to-end proof — after 2.8c, 2.8d, 2.8a · DONE 2026-11-02

- Against a real build: the frame-ancestors header on a prerendered static
  page, `401` without the cookie, the token exchange and redirect, the
  internal bearer on `/__preview/validate`, an expired token.
- **Done when:** these tests are in the end-to-end suite and pass. The
  "never `'*'`" rule of the bridge stays. [build]
- Gaps settled (calls, 2026-11-02):
  - **A second, gated node.** The e2e global setup runs with `PREVIEW_INSECURE=1`. The new
    test file starts a second node in its `beforeAll` from the already built `buildDir`
    (`start.ts --out`, a free port) with `PREVIEW_TOKEN_SECRET`,
    `PREVIEW_INTERNAL_SECRET` (32+ characters each), `PREVIEW_SITE` and
    `PREVIEW_EDITOR_ORIGINS`. No rebuild. Never runs beside 2.9b.
  - **Cases.** CSP on a prerendered page (never contains `*`); `401` with `no-store` and
    no cookie on a page, on `/_astro/*` and on `/__preview/config`; the `303` exchange
    with the exact `Set-Cookie` string (including `Partitioned`) and a relative
    `Location` without the token; a request with the cookie sent by hand (Node `fetch`
    keeps no jar); the bearer on `/__preview/validate` with a real body; expired,
    wrong-site and tampered tokens; the node refusing to start with equal secrets.
  - **Not covered here:** the cookie inside a Chromium iframe (2.12b).
- **Done at review (2026-11-02):** `readGate` refuses `PREVIEW_TOKEN_SECRET`
  equal to `PREVIEW_INTERNAL_SECRET` (with a test), and depcruise's
  `client-stays-browser-safe` now also forbids `client/` importing
  `preview-contract` (proved with a throwaway file). `cms-server` has no
  internal secret yet: 2.9b, which adds it, must generate it distinct from
  `previewTokenSecret` and test that.
- **Result (2026-11-02):** new `preview-render-server/test/e2e/gated-node.e2e.test.ts`
  (13 tests) starts a second node by hand from the built `sample-site` folder
  (`--out`, no rebuild, `PREVIEW_INSECURE` left out) through the new helper
  `startBuiltNode` in `test/support/preview-server.ts` (existing exports unchanged).
  Covers every case in the gaps block: the exact frame-ancestors header on
  `/faq` (no `*`); `401` with `no-store`, the exact body and the header on a page,
  on `/_astro/<file>` and on `/__preview/config`; the `303` exchange with the exact
  `Set-Cookie` (`Partitioned`, `Max-Age=43200`) whose value verifies for this site
  with an expiry about 12 h out, and a `Location` of `/faq?lang=en` with the token
  removed (a token as the only parameter gives `/faq`); the cookie
  sent by hand opens the page, an asset and the config route; expired, other-site,
  internal-secret-signed and tampered tokens give `401`, `no-store` and no cookie,
  even beside a valid cookie; the internal bearer works on `/__preview/validate`
  with a real body and on a page, and the token secret does not work as a bearer;
  equal secrets make the node exit 1 with the "must differ" message.
  Calls: the second node is spawned as `start.ts sites/sample-site.config.ts --out
  <buildDir>/sample-site` with `PREVIEW_SITE=sample-site` and the same two editor
  origins as the global node. The cookie is checked with `verifyPreviewToken`, not
  by string, because the server mints it at its own time.
  Deviations: none. No production code changed.
  Evidence: `npm run test:e2e -w preview-render-server -- test/e2e/gated-node.e2e.test.ts`,
  13 of 13 passed (twice). `biome check` on the two files and `tsc` for
  preview-render-server are clean. Not run: the full e2e suite, `npm run check`.
  Open: the cookie inside a Chromium iframe is still 2.12b.

### 2.9 Node supervision, builds and the overlay — after 2.8, 2.3c, 2.5c · ∥ 2.6, 2.7, 2.10a

Design 4.4, 5.6.

#### 2.9a Build runner — after 2.0e, 2.3c · [build] · DONE 2026-11-06 (Stryker 96.39 / 100 / 100; see Result)

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
- **Failed builds and `--out` (review, 2026-11-02):** `build.ts` now refuses a
  non-empty `--out` folder that has no `manifest/bundle.json`
  (`assertOutDirIsSafe`, so `--out .` cannot delete a repo). A build that fails
  before it writes `bundle.json` leaves such a folder behind. Each build here
  uses a fresh `bundles/<bundleId>/`, so this never blocks a rebuild, but the
  runner must remove the folder of a failed build itself, or the garbage
  collection must (a failed folder is never "the last good one"). If any build
  ever has to reuse a folder, write a marker file before `clearBundle` in
  `integration.ts` first.
- **Done when:** a build of a worktree of the seeded remote succeeds; a
  commit with a broken component fails with its `firstError`; a leaked
  secret in the parent environment is absent in the child (test); queue
  merging with a fake build function.
- **Gaps settled (calls, 2026-11-04, review).** `[build]` covers only the heavy runs (below). Files: `cms-server/src/build/` (new, the runner), `preview/child-env.ts` (new), `preview/supervisor.ts` (uses it), `config/schema.ts`, the sample's `cms.config.ts`, and `preview-render-server/src/build.ts`.
  1. **`node_modules` (approved 2026-11-04, option A).** A worktree has no `node_modules`, and Astro resolves upward from `--root`. New config key `build.nodeModules`, **required** in the Zod schema, so a missing key fails when the config loads. At load: the path must be absolute and outside the clone (a path inside is refused, since `git clean -fd` would delete it). At build time: the folder must exist, or the build fails with `dependencies-missing`, naming the key and the path. The runner makes a junction at `<worktree>/<siteDir>/node_modules` to it. `sample-site`'s config and the tests point the key at the workspace root's `node_modules`. Known limit: an upstream lockfile change is `code` and rebuilds against the old dependencies; the owner reinstalls. A CMS-managed `npm ci` into `.cms/<site>/deps/<lockfile-hash>/` is phase 3 or 5, with sandboxed workers. Adding a required key breaks every existing config fixture and test: update them in this task.
  2. **Junction removal is link-safe.** The `finally` first removes the junction with a non-recursive `rmdir`, checks it is gone, and only then calls `tx.worktreeRemove` (git's `--force` removal on Windows could follow the link into the real `node_modules`). The worktree folder is `build-<bundleId>`. At startup the runner sweeps leftover `build-*` folders the same way (`syncRepo`'s `worktree prune` only drops records whose folder is gone). Tests: the target `node_modules` survives a normal build, a failed build and the startup sweep.
  3. **Bundle id and last good.** The runner generates `bundleId` as `<UTC timestamp>-<short sha>`. "Last good" is the newest folder with a valid `bundle.json`, ordered by its `builtAt`. A failed build's folder is deleted at once.
  4. **Garbage collection** keeps the last two, the last good one, and a `keep` set of bundle ids from the caller (the one the node is serving).
  5. **Environment.** Move `INHERITED` out of `supervisor.ts` into `preview/child-env.ts`. The build uses that set plus `NODE_OPTIONS`; the supervisor keeps the set without it. Set `ASTRO_TELEMETRY_DISABLED=1` explicitly (`HOME` and `USERPROFILE` are not passed).
  6. **Timeout and errors.** 5 minutes, then the whole process tree is killed (`taskkill /T /F` on win32; `child.kill()` leaves grandchildren). `firstError` is not parsed from Astro's text: `build.ts` writes a structured error (file and message) to a known file in `--out`; the fallback is the last 20 lines of the log. The code that writes that file lives in a small module, because `build.ts` is excluded from Stryker's `mutate` and its branches would go unscored.
  7. **Root.** The child gets `--root <worktree>/<siteDir>`.
  8. **What `[build]` means here.** While 2.9a's real-build tests run: no other `[build]` task, no Stryker run, no e2e, no `sample-site` build (low-memory machine). Writing the code and running targeted unit tests may happen alongside 2.10a or 2.5c; 2.9a does not edit `ops.ts`.

- **Result (2026-11-05; Haiku agent, reviewed by the lead; `a4f7d4d` on `phase-2-wave-6`, rebased from an older base).** `preview/build-commit.ts` builds one commit in a worktree (env allowlist, timeout 10 min with SIGKILL, log file); `preview/build-runner.ts` is the queue (one build at a time, one queued, requests made during a build merge into the newest commit); `preview/bundles.ts` is the GC (keeps the two newest complete bundles; removes a folder with no `bundle.json`). The "Done when" cases are covered: a build of a worktree of the seeded remote (`build-commit.real.test.ts`, real, passes); a broken page fails with `firstError` (`src/pages/broken.astro`, a page and not a component, since a component no page imports is never compiled); no token, SSH setting or `GIT_*` variable reaches the child (unit test); queue merging (unit test). The real tests take about 60 s and run alone. Unit tests: 78 pass with the supervisor tests. `tsc` is clean.
  - Calls where the plan was open: the runner lives in `preview/`, because depcruise allows `child_process` only in `git/` and `preview/`; a request takes a commit sha; `dir` is returned even on failure, and a failed folder is removed, so check `ok` first; the log is `.cms/<site>/logs/<bundleId>.log` and is not collected.
  - **Windows long paths (fixed 2026-11-06, `9bff015`):** `git worktree remove --force` failed with "Filename too long", because Astro writes `node_modules/.astro` inside the worktree. `worktreeRemove` in `git/ops.ts` now runs `git -c core.longpaths=true worktree remove`, and the real build test asserts that the builder logs no warning, so git removes the worktree itself. The Node delete stays as the fallback. No change to `build.ts`.
  - **For 2.9c:** GC does not know which bundle the node serves. After a rollback the served bundle can be older than the two that GC keeps, so 2.9c must pin it (also listed under 2.9c).
  - **Stryker (2026-11-06; user approved the config change).** `vitest.mutation.cms-server.config.ts` now excludes `*.real.test.ts` (`9bff015`); the real tests run alone with `npx vitest run`. Round 1 (`reports/stryker-runs/2026-11-06T00-32-59-707Z/`): `build-commit.ts` 68.67 (34 uncovered, 18 survived: the real `defaultSpawn` and the log parsing had no unit test), `build-runner.ts` 100, `bundles.ts` 93.10. Tests added (`1de9acb`; `defaultSpawn` is exported and tested with small real children). Round 2 (`reports/stryker-runs/2026-11-06T00-37-03-901Z/`): **`build-commit.ts` 96.39, `build-runner.ts` 100, `bundles.ts` 100.** The 6 survivors of `build-commit.ts` are equivalent: 262:25 (the default of regex group 1, which always matches), 257:57 (`path.join` leaves at most one trailing slash), 268:9 (`sameLine` is already trimmed), 302:18 (`windowsHide`, not observable), 308:27 and 309:27 (`setEncoding('')` means utf8).
  - **Not done:** the wiring into `run.ts` and `state.json` (2.9c).

#### 2.9b Node supervisor — after 2.8c, 2.0e · DONE 2026-11-02

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
- Gaps settled (calls, 2026-11-02):
  - **Identity in `GET /__preview/config`.** The answer gains `bundleId` and
    `protocolVersion` (null when `manifest/bundle.json` is missing; read once, cached).
    `previewConfigSchema` (non-strict) goes in `preview-contract`; the bridge keeps its
    own check and tolerates the extra keys. This task changes `preview-config.ts`, its
    test, `config-route.e2e` and design 5.7. Readiness requires the `bundleId` the
    supervisor started, so a stale process on the port never counts as ready; the swap
    e2e checks the real `bundleId`.
  - **Secrets.** `loadSecrets` refuses equal token and internal secrets (test); the
    supervisor test checks the child gets distinct ones. (The earlier note that
    cms-server has no internal secret is stale: `loadSecrets` generates it.)
  - **Environment.** An allowlist (`PATH`, temp folders, and `SystemRoot` and `windir`
    on Windows) plus `PREVIEW_EDITOR_ORIGINS` (the CMS origin), `PREVIEW_TOKEN_SECRET`,
    `PREVIEW_INTERNAL_SECRET`, `PREVIEW_SITE`, `PORT`, `HOST=127.0.0.1`. Design 5.6 omits
    `PREVIEW_SITE`; fix it there.
  - **Spawn** `process.execPath <start.ts> …` directly, never through `npm` (on Windows
    the `cmd.exe` shim would take the kill and leave the node holding the port). The
    `start.ts` path is an injected option (default: the sibling workspace folder).
    Check whether `start.ts --out` still needs a site-config argument and pass the one
    the build used.
  - **Shape.** `cms-server/src/preview/supervisor.ts`; spawn, clock and timers injected;
    `start(bundle)`, `swap(bundle)`, `stop()`, `status()`; no HTTP routes (2.9c wires
    `/api/status`).
  - **Failures.** The counter resets after the node has stayed up 60 s since ready; five
    crashes or failed readiness checks before that is `failed`. A port in use is probed
    at start for a friendly error naming the port, and an `EADDRINUSE` exit of the child
    gives the same error. In a swap the new node waits for the old child's `exit`.
  - **Swap.** The new node gets one attempt (start plus readiness timeout). On failure the
    supervisor restarts the previous bundle as an ordinary start (normal backoff) and
    returns `{ ok: false, rolledBack: true }`; `rolledBack: false` if that failed too.
    2.9a's "keep the last two" keeps the folder. On Windows `child.kill()` is a hard
    kill: grace-then-kill is tested with the fake child only.
  - **E2E project.** `cms-server` has none: this task adds `cms-server/vitest.e2e.config.ts`,
    a `test:e2e` script and a step in `scripts/check.ts` (steps run one at a time). Its
    global setup builds `sample-site` once; the swap test copies the bundle and rewrites
    `bundle.json` in the copy.
  - Runs after 2.8e, never beside it.
- **Result (2026-11-02):** built `cms-server/src/preview/supervisor.ts`
  (`createSupervisor` with `start`, `swap`, `stop`, `status`; `restartDelayMs`,
  `childEnvironment`, `portInUseMessage`) and `supervisor.test.ts` (26 tests, fake
  spawn, fetch, clock and sleep). `loadSecrets` refuses equal secrets (env, file,
  generated; checked before a new file is written; 4 tests in `secrets.test.ts`).
  `preview-contract/src/preview-config.ts` (`previewConfigSchema`, `PreviewConfig`,
  non-strict) with its test, exported from the index. `GET /__preview/config` answers
  `bundleId` and `protocolVersion`: `bundleIdentity(manifestDir)` in
  `preview-config.ts` (missing `bundle.json` gives nulls, an invalid one gives 500),
  `previewConfigResponse(env, identity)`, and `preview-config-route.ts` reads the
  identity once through the virtual module's `manifestDir`. The bridge's `isConfig`
  already accepts extra keys, so `bridge.ts` is unchanged. Design 5.6 (PREVIEW_SITE)
  and 5.7 (the answer) already carried this text; no design edit. cms-server e2e:
  `cms-server/vitest.e2e.config.ts`, `test/e2e/global-setup.ts` (builds sample-site
  once into `cms-server/.build/supervisor-e2e-*`, removed in teardown),
  `test/e2e/supervisor.e2e.test.ts`, the `test:e2e` script, `cms-server/.gitignore`
  (`.build/`), `vitest.projects.ts` excludes `test/e2e/**` from the unit project, and
  `scripts/check.ts` has a "cms-server e2e" step before the renderer's e2e.
  - Calls: spawn is `process.execPath <start.ts> <siteConfig> --out <bundle.dir>` with
    cwd preview-render-server. The site config is still needed (start.ts takes the
    site root from it), so the supervisor is given the config the build used.
    Environment: an allowlist (PATH, TEMP, TMP, TMPDIR, SYSTEMROOT, WINDIR, matched
    without case) plus PREVIEW_EDITOR_ORIGINS, PREVIEW_TOKEN_SECRET,
    PREVIEW_INTERNAL_SECRET, PREVIEW_SITE, PORT and HOST=127.0.0.1. Readiness: GET
    `/__preview/config` with the internal bearer, parsed by `previewConfigSchema`,
    and its bundleId must equal the one started (20 s timeout, 200 ms polls).
    Backoff: `min(30 s, 1 s × 2^(n-1))`, so 1, 2, 4, 8, 16 s, then 30 s at most.
    Five failures in a row give `failed`; the count resets when the node was up 60 s
    (60 000 ms resets, 59 999 does not). A port in use before start, or EADDRINUSE from
    the child, gives an error naming the port, with no retry. Swap: SIGTERM, a 5 s
    grace, SIGKILL, and the old exit awaited; then one attempt for the new node. On
    failure the new node is stopped and the previous bundle starts as an ordinary
    start: `{ ok: false, rolledBack: true }`, or `false` if that failed too. Swap with
    nothing running starts. `stop()` kills the node and cancels a backoff or readiness
    wait; a pending start resolves with `ok: false`. Injected: spawn, fetch, portInUse
    (the default is a real probe), parentEnv, now, sleep (the default is an unref'd
    timer), readyTimeoutMs, pollMs, graceMs.
  - Deviations: SYSTEMROOT and WINDIR go to the node on every OS, not only Windows
    (harmless). "Then up to 30 s" is read as doubling capped at 30 s. `status()` is a
    plain function, with no route (2.9c). Found while testing: a failed swap killed the
    new node a second time during the rollback; fixed by clearing the reference.
  - Evidence: `npx vitest run --project cms-server` on `supervisor.test.ts` and
    `secrets.test.ts`: 55 passed, 1 skipped (the POSIX-only mode test). `npm run
    test:e2e -w cms-server`: 4 of 4 passed (about 20 s; it builds sample-site, runs the
    real node, swaps to a copy whose bundle.json names `e2e-swapped`, checks the served
    bundleId against each bundle.json, and checks that stop frees the port).
    `npm run test:e2e -w preview-render-server -- test/e2e/config-route.e2e.test.ts`:
    2 of 2. Unit: `preview-config.test.ts` passes in preview-contract (10) and in
    preview-render-server (9). `tsc` exits 0 for cms-server, preview-contract and
    preview-render-server. Biome is clean on my files.
  - Other edit: `preview-render-server/test/e2e/gated-node.e2e.test.ts` expected the
    old exact body of `/__preview/config`; it now expects bundleId and protocolVersion.
    It is not run (not my file).
  - Open: stop() is not wired to cms-server's exit yet (2.9c, with server.ts, which
    I did not touch). `preview-contract/src/index.ts` fails biome's organizeImports:
    the export block mixes the other agent's `imagesJsonSchema` lines with mine (mine
    are in sorted position); run `biome check --write` on that file once that agent is
    done. `preview-contract/src/index.test.ts` does not yet assert the new export.
    gated-node.e2e needs a run: `npm run test:e2e -w preview-render-server -- test/e2e/gated-node.e2e.test.ts`.
    Not run: `npm run check`, knip, depcruise, Stryker. The grace-then-kill path is
    proven with a fake child only (Windows `kill` is hard). The config route imports
    `virtual:preview-site`, as media-route does, so a dev run without a bundle fails there.

- **Review fix (2026-11-02):** `start()` took its generation after the port check, so a `stop()` during the check could not end it and the node launched after `stop()` returned. The generation is now taken first and re-checked after the check (regression test).

#### 2.9c State, triggers and status — after 2.9a, 2.9b, 2.4a, 2.1h, 2.1i

- `.cms/<site>/state.json`, written atomically: current and last-good
  bundle, protocol-rebuild attempts per `bundleId`.
- The real `BundleSource`, replacing 2.1i's `--bundle` directory in
  `main.ts`. The start-up sequence: load the state, start the
  current bundle's node, or build if there is none.
- Triggers from design 4.4 that are known here: no bundle, a save with
  `rebuild: true`, a protocol mismatch (compare `bundle.json`'s
  `protocolVersion` with the server's `PROTOCOL_VERSION`, at most once per
  `bundleId`), and a publish. The sync trigger arrives in 2.10a.
- `GET /api/status` in full (design 5.6): bundle id and commit, build state,
  node state, last sync, changeset size, and errors (`protocolMismatch`,
  `upstreamBuildFailed`).
- **From 2.9a (2026-11-06):** `collectBundles` (`preview/bundles.ts`) keeps the two newest complete bundles and does not know which bundle the node serves. After a rollback the served bundle can be older than those two. Give `collectBundles` a set of bundle ids to keep (the served one, and last-good from `state.json`), and call it with that set from the build runner. Test: a served bundle older than the two newest survives a build.
- **Done when:** a test per trigger with fakes; the mismatch rebuild happens
  once and then reports the error. A bundle built before this phase (no
  `bundle.json`) counts as a mismatch.

#### 2.9d Preview client — after 2.9b, 2.5c

- The real `PreviewClient`: `validate` and `warm` over HTTP to `127.0.0.1`
  with the internal bearer, timeouts, and Zod-parsed responses (`kind`
  defaults to `invalid`). If the node isn't ready, saves answer `503
  preview-unavailable` with a plain message.
- **From 2.5c (2026-11-05):** `run.ts` registers `save: { config, preview: previewNotReady }` (`save/validate.ts`), so a real start answers `503 preview-unavailable` to every save until this task replaces it. Replace it in `run.ts`. The save stage treats any rejection of `validate` as `503`, and does **not** apply a timeout itself: the 10 s timeout of 2.5c item 3 belongs in this client. Without it a hung node holds the repo lock (30 s) and delays sync and publish.
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

#### 2.10a Sync — after 2.3c, 2.4a · DONE 2026-11-04

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
- **Gaps settled (calls, 2026-11-04, review).** Wave 6, runs first: 2.5c starts from the merged 2.10a, since both edit `git/ops.ts`.
  1. **Base of the comparison is the bundle's commit.** Classify with `git diff --name-status siteCommit...origin/<branch>` (three dots, so the CMS's own saves on `cms/work` do not count), where `siteCommit` is from the current `bundle.json`. This is design 4.4's trigger, "code changed upstream since the current bundle", and it survives a crash between fetch and rebuild. Whether to re-apply (2.10b) is a separate answer: `mergeBase()` differs from `origin/<branch>`.
  2. **Result.** `{ ok: true, upstream: sha, reapply: boolean, change: 'none' | 'content-only' | 'code', paths }` or `{ ok: false, syncError }`. It never throws. Messages are redacted. Auth errors keep `ensureRepo`'s `RepoError` kinds. A fetch timeout (the 60 s default of `runGit`) is a `syncError`.
  3. **Where.** `tx.fetch` in `ops.ts`, inside `locked`. The classifier is a pure function in its own file with its own test file.
  4. **Content-only is strict.** Every changed path must be a modification (`M`) of the file of a current, non-build-time document in `documents.json`. Everything else is `code`: added, deleted or renamed files, images (an upstream `src/assets` image is optimized at build time), anything outside `siteDir`, the lockfile. This goes further than "content or image extension", in the direction the task asks for ("erring toward a rebuild"), so there are no extension lists. The "adds a new document" case in Done-when expects `code` (a new document changes `routes.json`).
  5. **Always `code`:** `siteCommit` is `null`, the commit no longer exists (pruned by `git gc` after a re-apply), the diff fails, or there is no bundle yet.
  6. **Not a bug:** after a publish the squash commit is new, so a document the CMS created shows as `A` and counts as `code`. Design 4.4 rebuilds after every publish anyway.
- **Result (2026-11-04):** `tx.fetch` in `cms-server/src/git/ops.ts` (inside `locked`, `runGit`'s 60 s default) and the pure classifier `cms-server/src/git/sync.ts`. Added: `git/sync.ts`, `git/sync.test.ts` (31 tests). Changed: `git/ops.ts`; `git/repo.ts` (exports `RepoError`, `RepoErrorKind`, `repoErrorOf`); `git/ops.test.ts` (new `openRepo: fetch` block, 16 harness tests, and an optional `extra` seed argument on `fixtureIn`). Targeted run of `ops.test.ts`, `sync.test.ts`, `repo.test.ts`: 116 passed, 0 failed. Biome and tsc clean on the touched files. Stryker not run (out of scope). Deviations from the Gaps settled block: (a) `paths` are repo-relative, since a path outside `siteDir` has no site-relative form; (b) the diff covers the whole repo and the classifier applies the `siteDir` filter; (c) an unreadable bundle (`BundleError`) counts as no bundle, so the result is `ok: true, change: 'code'`, not a `syncError`; (d) `tx.fetch(bundles)` takes the `BundleStore` as an argument, since `openRepo` has none; (e) a type change (`T`) counts as modified, per the existing status rule in `ops.ts`; (f) a missing commit has no separate `cat-file` check, because the diff failure gives `code`. Open: no sync trigger yet (2.10b, 2.10g); `editable: false` documents are classified as content like any other.

#### 2.10b Re-apply the saved documents — after 2.5a, 2.5b

- Rebuild `cms/work` as the new `origin/<branch>` plus the saved changeset,
  per document (design 4.2). **Crash-safe:** build `cms/work-next` first,
  commit, then move `cms/work` to it, keeping `cms/work-prev` until the move
  succeeds; start-up finishes or discards a leftover.
- For each saved document, write its saved value into the **upstream**
  text with its codec (a `file()` entry changes only itself). If upstream's
  revision differs from the base the save started from, record it as
  overwritten with the upstream commit in a commit trailer, carrying over
  the trailers of earlier syncs. The re-apply commit must repeat the older `CMS-Overwrote` lines, because 2.5b's parser reads the newest value per key. Saved images (paths under `media.folder`)
  are restored from the old branch.
- **Scenarios, one test each:** the developer edits another document; edits
  another field of the same document (the CMS version wins whole); edits
  another entry of the same `file()` file (both survive); deletes a document
  the CMS edited (recreated); edits a document the CMS deleted (stays
  deleted); reformats the file (the codec writes into the new formatting);
  pushes nothing relevant (no-op); a crash after `cms/work-next` is made;
  two syncs in a row keep the first sync's `CMS-Overwrote` trailer.
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
- **From 2.5c (2026-11-05):** a save keeps the keys whose validation hit `refinement-threw` in `ctx.refinements` (`save/validate.ts`), and **nothing stores them**: they are lost when the request ends. Settle where they live (in memory per start, or in `.cms/<site>/`) before this task can use the trigger; add it to the save pipeline's `writeChanges` or an `afterCommit` hook. "Build-time field changed" is the `rebuild` flag the save already answers (`save/rebuild.ts`), which is not stored either.
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

#### 2.11a Copy and serve — after 2.1c · DONE 2026-11-02

- Copy `preview-render-server/test-editor/` into `cms-server/editor/` (the
  original is removed in 2.12a; the duplication lasts only until then).
  Serve it at `/` with security headers (`X-Content-Type-Options`, a CSP
  that allows frames only from the preview origin, no framing of the editor).
- The editor's script is browser TypeScript: bundle it at server start with
  rolldown (already in the workspace) and keep it in memory **(call; phase 3
  replaces all of this)**.
- **Done when:** the page loads from `createApp`, the script is served, and
  the headers are asserted in a test.
- Gaps settled (calls, 2026-11-02):
  - **Plain HTML.** `editor.astro` becomes `index.html` (cms-server cannot render Astro).
    Routes `/`, `/editor.js`, `/editor.css`; no inline script or style.
  - **Type import.** `editor.ts` imports `DevDocument` from the renderer, which the
    `cms-server-never-imports-renderer` rule forbids. The copy gets a local
    `EditorDocument`; 2.11b reshapes it.
  - **Headers.** `nosniff`, `Referrer-Policy: no-referrer`, and a CSP: `default-src 'none'`,
    `script-src 'self'`, `style-src 'self'`, `connect-src 'self'`, `img-src 'self'`,
    `frame-src <origins.preview>`, `frame-ancestors 'none'`. (Thumbnails served by the
    preview origin need the gate cookie and will not show top-level: phase 3.)
  - **Bundling.** `createApp` stays synchronous and takes the built script as a dep; an
    async `buildEditorScript()` runs rolldown once at start. Add `rolldown` to
    `cms-server/package.json` (same version as the renderer's). Add `happy-dom` for the
    copied tests, which run in the `cms-server` project.
  - **Config.** `editor/` is added to `tsconfig`, the vitest include and `knip.json`; it
    stays out of Stryker and coverage. The page loads but does not work as an editor
    until 2.11b (it still calls `/__dev/documents`).

- **Result (2026-11-02):** `cms-server/editor/` holds `index.html`, `editor.css`,
  `editor.ts` and `editor.test.ts`, copied from `preview-render-server/test-editor/`
  (originals untouched). `src/editor/page.ts` `loadEditorPage()` reads the HTML and
  CSS and bundles `editor.ts` with rolldown in memory. `src/http/editor-routes.ts`
  serves `/`, `/editor.css`, `/editor.js`; `app.ts` has `AppDeps { editor }` and one
  `app.route` registration.
  Calls and deviations:
  - `AppDeps.editor` is `{ page: { html, css, script }, previewOrigin }`. The gap
    text named only the script as a dep; the HTML and CSS are loaded at start too,
    and `previewOrigin` feeds `frame-src`.
  - The security headers go on every app response (a sub-app `use('*')`), not only
    the three editor routes, so the JSON 404 and `/api` answers carry them too.
  - `index.html` loads the script with a module tag in `<head>` (no body change); the
    `h2` has a biome-ignore (editor.ts fills it in).
  - `editor.ts` has a local `EditorDocument` (`format` is `string`), replacing the
    renderer import.
  - Tests: `src/http/editor-routes.test.ts` (exact CSP, types, bodies), and
    `src/editor/page.test.ts` (default folder, `ENOENT` for a missing file). The copied
    `editor.test.ts` reads `index.html` now. `test/helpers/app-deps.ts` `fakeAppDeps()`
    gives `app.test.ts` and `server.test.ts` their deps.
  - Config: `package.json` gets `rolldown ^1.2.15` (dependencies) and `happy-dom
    ^21.0.4` (devDependencies). `npm install` ran once; the lockfile diff is those
    two entries only. `tsconfig` includes `editor`, `vitest.projects.ts` includes
    `editor/**/*.test.ts`, and `knip.json` has the editor entries; `preview-protocol`
    left the cms-server `ignoreDependencies`. Coverage and Stryker do not include
    `editor/`.
  Evidence: `npx vitest run --project cms-server` on the five files (`editor.test.ts`,
  `page.test.ts`, `app.test.ts`, `editor-routes.test.ts`, `server.test.ts`): 5 files,
  48 tests pass. `tsc`: no errors in these files. Biome clean on the changed files.
  Knip: nothing in the new files.
  Open:
  - Nothing calls `loadEditorPage()` yet (no start code); the start code must call it
    and pass the result into `createApp`.
  - The page loads but does not work as an editor until 2.11b (it still calls
    `/__dev/documents`, `/__preview/warm` and `/__preview-media/new`).
  - Thumbnails from the preview origin need the gate cookie: phase 3.
  - Other agents' files, not 2.11a: `tsc` fails in `src/http/body.test.ts` (`duplex`);
    knip lists `src/media/measure.ts`, `src/bundle/read.ts`, `src/media/metadata.ts`
    and `fs/atomic.ts` as unused, and suggests dropping the `sharp` ignore.
  - `npx biome` failed here ("could not determine executable"); the checks used
    `./node_modules/.bin/biome`.

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
- **From 2.5c (2026-11-05):** the body is `{ changes: [{ document, baseRevision, data?, deleted? }] }`. A create sends `baseRevision: null` and a key `collection/id`; a key with no collection answers `400 invalid-body`. An update or delete of a missing document answers `409 conflict` with `revision: null`. `409` bodies: `conflict` is `{ error, documents: [{ key, revision, value? }] }`; `exists` and `file-missing` are `{ error, key, message }`. `500 save-failed` means nothing was kept (restored from git); `503 preview-unavailable` means nothing was written.
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
  iframe on `preview.localhost` through the token and cookie (the iframe's
  `fetch` succeeds; the same preview opened top-level answers `401`); a draft
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
  the first full run (not guessed), as for the renderer (superseded: the coverage floors are decided, see below). Per-file Stryker
  floors only if the user wants them.
- **Coverage floors are decided (user, 2026-11-02):** 80 lines, 90 functions, 80 branches,
  80 statements for every package, until a further assessment (QUALITY-TOOLING). Only the
  Stryker threshold is open here.
- **Stryker thresholds are decided (user, 2026-11-03):** `high` 90, `low` 80, `break` 75 in
  `stryker.config.json` (were 80, 60, 90). This closes the Stryker `break` question here, and the
  "do not touch `thresholds.break`" notes in 2.1g, 2.1h and the handoffs that cite 90. The
  per-package question in the remark below is still open: it asks whether to add gates per
  package, not what the global break is.
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

- Revisions of `file()` entries hash the raw value of the entry, without its
  id, not the store's schema-applied data nor the codec's serialization (2.0c,
  corrected 2026-11-03; refines design 5.3).
- The contract package is a new `preview-contract`, so `preview-protocol`
  stays free of Zod (2.0a).
- `collections.<name>.newEntryFormat` lives in `cms.config.ts` (2.1c).
- Changeset state lives in git (base revisions derived, overwrites in
  commit trailers), with no side file (2.5b).
- The front server refuses to start without secrets unless
  `PREVIEW_INSECURE=1` (2.8b).
