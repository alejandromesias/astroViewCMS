# Quality tooling plan

Written 2026-10-28. Goal: keep the codebase reliable as it grows toward the
multi-tenant shape in [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md). Each step is small,
lands on its own, and leaves the typecheck and the targeted tests green.

| #   | Step                      | Tool                                                                                                         | When           | Status   |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- | -------- |
| 1   | Stricter TypeScript flags | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | now            | done     |
| 2   | Lint and format           | Biome                                                                                                        | now            | done     |
| 3   | Boundary validation       | Zod from `astro/zod` (already a dependency)                                                                  | after 2        | done     |
| 4   | Architecture map          | Skott (graph, cycles)                                                                                        | after 3        | done     |
| 5   | Vulnerable dependencies   | osv-scanner (Dependabot once there is a remote)                                                              | after 2        | done     |
| 6   | Dead code                 | Knip, run on demand                                                                                          | after 4        | done     |
| 7a  | Bridge size budget        | unit test, rolldown + gzip                                                                                   | after 2        | done     |
| 7b  | Render time budget        | e2e `performance` test                                                                                       | after 7a       | done     |
| 7c  | Memory budget             | e2e, dev-only memory route                                                                                   | after 7b       | done     |
| 8   | Manual and check script   | `DOCS/QUALITY-TOOLING.md`, root `npm run check` (CI groundwork)                                              | after 7c       | done     |
| 9   | Architecture rules        | dependency-cruiser                                                                                           | once CI exists | deferred |

## 1. TypeScript flags

- Scope: `preview-render-server` and `preview-protocol` (which got its first
  tsconfig and a `typecheck` script). `sample-site` is left alone: it is a
  third-party template.
- Done 2026-10-28. The flags surfaced 131 errors in `preview-render-server`
  (41 in production code, 90 in tests), all fixed without changing behavior.
  Where a value is known to exist (regex capture groups, `split(...)[0]`, an
  index the test just checked) the code uses a non-null assertion; optional
  properties that held `undefined` are now omitted instead. Worth revisiting
  those assertions once Biome is on (step 2).

## 2. Biome

- One root `biome.json`: LF, the repo's quote and indent style, recommended
  rules, plus the rules for unused imports and floating promises.
- First run in report mode; fix or silence by rule, never by file. Format in a
  single commit so the diff of the rest stays readable.
- Add `lint` and `format:check` scripts at the root.
- Done 2026-10-28 (Biome 2.6.3, pinned). Scope: `preview-render-server` and
  `preview-protocol`; test fixtures are excluded. Formatting and import order
  were applied in one pass (87 files, uncommitted). No lint errors remain; 252
  warnings are left visible, mostly `noNonNullAssertion` (208, the assertions
  from step 1) and `noExplicitAny` (39). Two floating promises in `patch.ts`
  are marked `void` because Idiomorph returns the node synchronously.
- Follow-up, same day: trivial warnings fixed; `noNonNullAssertion` and
  `noExplicitAny` are off for `*.test.ts` (an override). `noExplicitAny` is now
  an `error`: the loose Astro content types in `content-api.ts` and
  `virtual.d.ts` sit behind one `biome-ignore` alias each. 43 production
  `noNonNullAssertion` warnings remain; revisit after step 3.

## 3. Zod at trust boundaries

- Server side only: the render and validate request envelope (replaces the
  hand-written 400 checks in `parseEnvelope`, `src/render/envelope.ts`, called
  from `readEnvelope` in `src/render/handlers.ts`), and optionally site config.
- Keep the error messages naming the failing field, as the contract requires.
- Not in the bridge or `preview-protocol`: the bridge ships in every previewed
  page (D14), so its size counts.
- **Messages stay byte-identical.** `envelope.test.ts` and `handlers.test.ts`
  assert the 400 bodies. Set per-field messages in the schema and add one small
  formatter that turns the first Zod issue (with its path) into today's string.
  Done = those tests pass unchanged.
- **First failure only on 400.** The contract names one part; listing every
  field is the 422's job, which comes from the schema pass, not this step.
- **Don't validate document contents.** `documents` stays
  `z.record(z.string(), z.unknown())`; values are checked by the shim's 422
  pass (SYSTEM-DESIGN section 7).
- **Keep today's edge cases:** unknown keys are stripped (`z.object`, not
  `z.strictObject`); a media ref named `__proto__` stays an ordinary key (keep
  that test); an empty `url` is rejected.
- **One type, not two.** `MediaMap` lives in `overlay/context.ts`: derive it
  with `z.infer`, or check the schema against it with `satisfies`.
- **Import from `astro/zod` only** (Astro 7, Zod 4 API: `error:`, not
  `message:`). `envelope.ts` runs in the built server bundle, which already
  ships Astro's Zod; a bare `zod` import could add a second copy.
- **Site config, optional.** `loadSiteConfig` (`src/site-config.ts`) casts a
  dynamic import to `SiteConfig`. A schema there catches a missing default
  export or a wrong field; the error names the config file and the field. Do it
  only if it stays small; it matters once tenant configs come from storage.
- **Optional:** the `?path=` check in `handleRender` can use the same
  formatter if it reads cleanly. `dev/documents.ts` (dev only) stays out.
- **Out of scope:** `PUT /api/changes`. It's a CMS-app route (the preview node
  has no write routes); add Zod there when that route is built.
- **Close the step 2 follow-up:** re-count the 43 production
  `noNonNullAssertion` warnings afterwards and record the number here.
- Done 2026-10-28. `parseEnvelope` now uses a Zod schema from `astro/zod`; the
  envelope and handler tests pass unchanged (53). Two deviations: `documents`
  and `media` are checked as plain objects (`z.custom`) and media entries are
  parsed one by one, because `z.record` silently drops a `__proto__` key. Site
  config was skipped (its `RegionConfig` is not small); the `?path=` check is
  unchanged. The 43 production `noNonNullAssertion` warnings are still 43, as
  `envelope.ts` had none; they remain for a later pass.
- **Verify:** `typecheck` and `lint` clean; run `src/render/envelope.test.ts`
  and `src/render/handlers.test.ts` (plus the `site-config` tests if done),
  with no test edits except new cases.

## 4. Skott

- Generate the module graph and the list of cycles for `preview-render-server`
  and `preview-protocol`. The point is to see the real shape first.
- Output: a short section in this folder with the graph and any cycles found.
  No rule enforcement yet.
- **One run from the `astroViewCMS` root**, so both packages land in one graph.
  Ignore `sample-site/**`, `sampleAstroProject/**`, `reports/**` and
  `node_modules/**`; `--fileExtensions=.ts`. There is no root tsconfig and no
  path aliases, so none is needed; if Skott insists, point it at
  `preview-render-server/tsconfig.json`.
- **Run it with `npx skott@<version>`, pinned**, not as a dependency: this step
  only looks, and step 9's dependency-cruiser takes over the rules. Record the
  version and the exact command in the output so it can be re-run.
- **Incremental mode is on by default** and writes `.skott/cache.json`: turn it
  off, or add `.skott/` to `.gitignore`.
- **Production graph first:** ignore `**/*.test.ts` and `**/test/fixtures/**`
  (tests are about half of `src/` and bury the shape). Then one run with tests
  included, read for a single thing: no production file imports a fixture (a
  step 9 rule).
- **Cycles, two lists.** Skott follows `import type` by default; a type-only
  cycle does nothing at runtime. Run with type-only tracking on and off and
  record both.
- **Check `client/` by hand** with builtin tracking on: `bridge.ts` and
  `patch.ts` must not reach `node:*` or server modules (a step 9 rule, and the
  bridge size of D14 depends on it).
- **Known blind spots, to write down, not fix:**
  - route files look isolated but aren't dead: `render-route.ts`,
    `validate-route.ts`, `media-route.ts`, the warmup route and
    `dev/documents-route.ts` are wired by URL strings in `injectRoute`
    (`src/integration.ts`), not imports;
  - `virtual:preview-site` and `virtual:astro:*` don't resolve;
  - `preview-protocol` is imported by package name, so the edge between the two
    packages only shows with third-party tracking on (or if Skott follows the
    workspace link); confirm which and say so.
- **Output file:** `DOCS/MODULE-GRAPH.md`, using the text modes (file-tree or
  raw). The webapp view is interactive and can't be stored.
- Done 2026-10-28 with Skott 0.35.12; see `DOCS/MODULE-GRAPH.md`. No cycles
  (types followed or not), no production file imports a fixture, and `client/`
  reaches no `node:*` or server module. Two deviations: the CLI's raw and
  file-tree modes print no edges, so the edge list came from Skott's API in a
  scratch folder (the cycle check works from the CLI); incremental mode is off
  by default in this version, so no `.skott/` ignore was needed. Review
  corrections: `preview-protocol` is imported by `bridge.ts` and (types only)
  `render/handlers.ts`, though Skott shows only the first; `.astro` files are
  outside the graph (two `injectRoute` entry points).

## 5. osv-scanner

- Scan `package-lock.json`. Keep an ignore file where every entry has a reason
  and an expiry date.
- **One lockfile, four workspaces.** The root `package-lock.json` covers
  `preview-render-server`, `preview-protocol`, `sample-site` (a third-party
  template), `sampleAstroProject` and the root dev tools (Biome, Stryker). Scan
  it once from the root; don't scan per package.
- **Triage by who pulls it in**, with `npm ls <package>`: the preview node's
  runtime dependencies (`astro`, `@astrojs/node`, `sharp`, `rolldown`,
  `devalue`, `es-module-lexer`, `idiomorph`, `yaml`) are what ship and get
  fixed first; dev tools and the two sample sites are fixed or ignored with a
  reason. Record the source in each ignore entry's reason.
- **Baseline today** (`npm audit`, 2026-10-28): 4 moderate, none in shipping
  code. `qs` and `typed-rest-client` come from `@stryker-mutator/core`;
  `@tailwindcss/typography` and `postcss-selector-parser` from `sample-site`.
  osv-scanner should find at least these; write down what it finds beyond them.
- **Install:** osv-scanner is not on this machine and there is no Go. Use a
  pinned release binary (or `scoop`/`winget`), not `go install`. Record the
  version and the exact command in this section, as step 4 did.
- **Command and ignore file:** `osv-scanner scan source -L package-lock.json`
  (v2 syntax) with `osv-scanner.toml` at the root. Each ignore is an
  `[[IgnoredVulns]]` entry with `id`, `ignoreUntil` (at most three months out)
  and `reason`. An expired entry makes the scan fail again; that's the point.
- **Add a root `audit` script** that runs the scan, so step 8's `check` can call
  it. Exit code non-zero on any finding not ignored.
- **Don't fix by upgrading in this step** unless it's a patch bump of a
  shipping dependency. Larger upgrades (Astro, Stryker) go in their own commit
  with the targeted tests; the `legacy-peer-deps` in `.npmrc` hides peer
  conflicts, so check `sample-site` still builds after any bump that touches it.
- **Dependabot waits for a remote.** The repo has none yet, so step 8 enables
  it: npm, weekly, `astro*`, `@astrojs/*`, `sharp` and `rolldown` in one
  group. `sharp` is pinned exactly in `preview-render-server` and `sample-site`;
  bump both together.
- **Verify:** the scan runs from the root with the pinned version; the result
  is clean or every finding has an ignore entry with reason and expiry; the
  `audit` script exits 0.

- Done 2026-10-28 with osv-scanner 2.7.0, installed by `winget install -e --id Google.OSVScanner --version 2.7.0` (new shell needed for PATH). `npm run audit` runs `osv-scanner scan source -L package-lock.json --config osv-scanner.toml` and exits 0. First scan: 688 packages, 5 medium findings, none in shipping code: 4 `qs` advisories (via `@stryker-mutator/core > typed-rest-client`) and 1 `postcss-selector-parser` (via `sample-site > @tailwindcss/typography`). All five are ignored in `osv-scanner.toml` until 2027-01-28 with the source as reason. Nothing beyond the `npm audit` baseline, except that osv does not flag `typed-rest-client` or `@tailwindcss/typography` themselves. Nothing was upgraded.

## 6. Knip

- Entry points: `src/build.ts`, `src/start.ts`, `sites/*.config.ts`, the virtual
  modules, the `injectRoute` entrypoints in `src/integration.ts` (render,
  validate, media, warmup and dev documents routes, plus
  `render/renderers-anchor.astro` and `test-editor/editor.astro`),
  `overlay/data-proxy.ts` (loaded by URL in `integration.ts`) and the client
  bridge (`client/bridge.ts`); without these, Knip reports them as unused. Run on demand and read the output; do not gate on it until the
  false positives are tuned out.
- **Complete the entry list.** `integration.ts` also loads
  `overlay/content-shim.ts` and `overlay/image-service.ts` by URL; add them.
  Grep `new URL(` in `integration.ts` to be sure nothing else is loaded that
  way.
- **Install and scope.** Knip is a pinned root devDependency, run with
  `npx knip` from the root (like Skott, step 4). A `knip.json` at the root with
  `workspaces` for `preview-render-server` and `preview-protocol` only.
  `sample-site` (third-party template) and `sampleAstroProject` (test site) are
  left out. Record the version and the command here.
- **Known false positives to configure, not to "fix":**
  - `virtual:preview-site`, `virtual:astro:*` and `astro:*` imports are not
    packages. Ignore them as unresolved imports or dependencies.
  - Tests, the two Vitest configs, `test/e2e` and `test/fixtures` should be
    picked up by Knip's Vitest plugin. Check that they are.
  - `preview-protocol`'s `exports` are its public API for the future CMS app.
    Unused exports there are expected; don't delete them.
  - Knip parses the code itself. Check that it runs with TypeScript 7 in the
    repo; if it can't, write down the error and stop.
- **Act on what's left, in separate commits:** unused files, unused exports,
  unused dependencies. Delete only what a grep confirms is unused (including
  string references and `new URL(` loads). Run typecheck, lint and the targeted
  tests of each touched folder. A removed dependency means `npm install` and a
  lockfile change, so run `npm run audit` too. If an item is unclear, list it
  in the done note instead of deleting it.
- **Add a root `knip` script**, but don't put it in step 8's `check` yet.
- **Non-null assertions, a commit of their own.** This is the follow-up from
  steps 2 and 3. Go through the 43 production `noNonNullAssertion` warnings
  (`npx biome lint --only=style/noNonNullAssertion`, production files). Replace
  each with a check or a narrower type, or keep it with a `biome-ignore` that
  says why the value exists. Behavior must not change: a new check that throws
  where the code used to crash anyway is fine; a new silent fallback is not.
  Record the count after.
- **Verify:** `npx knip` reports nothing, or only items listed with a reason in
  the done note; the typecheck, lint and targeted tests are green; the
  `noNonNullAssertion` count in production code is recorded.

- Done 2026-10-28 with Knip 6.43.0 (pinned root devDependency); `npm run knip` runs `knip` with the root `knip.json`. Config: `sample-site` and `sampleAstroProject` are in `ignoreWorkspaces`; `preview-render-server` lists the `injectRoute` and URL-loaded files as entries (routes, bridge, `content-shim`, `image-service`, `data-proxy`, the two `.astro` entries, `sites/*.config.ts`) and ignores `test/fixtures/**` (fixture sites, not code); `preview-protocol` adds `src/index.test.ts` as an entry (it has no Vitest config of its own). `osv-scanner`, `tsc` and `vitest` are in `ignoreBinaries` (winget tool; hoisted from the root). Knip runs fine with TypeScript 7. First run, with the config tuned: 1 unused export (`jsonRequest` in `test/helpers.ts`, deleted) and 6 exported types used only in their own file (`export` dropped: `PatchSummary`, `StoreEntry`, `DraftInfo`, `RealContent`, `StaticPath`, `RegionConfig`). No unused files or dependencies; `preview-protocol`'s API showed nothing. `npx knip` now reports nothing. `knip` is not in step 8's `check` yet.
- Non-null assertions in production code: 43 warnings before, 0 now; 24 sites keep a `!` with a `biome-ignore` that says why (regex capture groups, DOM lookups in `test-editor/editor.ts` and `client/patch.ts`, `CONTENT_TYPES` lookup, `splitKey`). The rest were rewritten with the same behavior: `split('?')[0]!` became `.replace(/\?.*/s, '')` (7 sites) and `split(';')[0]!` became `.replace(/;.*/s, '')`; `queue.pop()!`, `lines[i]!`, `first!`, the `hasOwn` lookups in `languages.ts` and `islands.ts` use a `for` loop or an `undefined` check. Typecheck, lint and 1037 targeted tests are green.

## 7. Budget tests

They protect the capacity estimate in the design (SYSTEM-DESIGN section 6:
about 80 MB per preview node, about 1 ms per render). Loose thresholds, so they
flag regressions and not noise. Done one at a time, each with its own commit
and done note, in the order below (cheapest first).

Note: the earlier reference to `media-route.measure.test.ts` was wrong; that
file tests `measureImage` (image metadata), not speed. The precedent is the
`performance` block at the end of `test/e2e/preview-server.e2e.test.ts`: 100
edits of `/landing/home-v2`, median and p95 logged, `median < 100 ms`.

### 7a. Bridge size

- A unit test bundles `src/client/bridge.ts` with `rolldown` (already a
  dependency, used in `schema/config-bundle.ts`): browser platform, minified,
  every import bundled (`preview-protocol`, `patch.ts`, `idiomorph`). Measure
  the gzipped bytes with `node:zlib`.
- Budget: today's size plus about 20%, rounded; write both numbers in the test
  and here. On failure, the message gives the size and the budget.
- It is fast, so step 8's `check` runs it.
- **Verify:** the test passes; the done note records the size and the budget.
- Done 2026-10-28 in `src/client/bridge-size.test.ts` (picked up by the normal `vitest run`, about 1 s). Measured 5318 bytes gzipped (minified, browser platform, `idiomorph` and `preview-protocol` bundled); budget 6400 (+20%). Both numbers are constants in the test; the failure message gives the size and the budget.

### 7b. Render time

- Extend the existing e2e `performance` test; don't add a second one. Keep the
  100-edit loop and its `console.log` of the numbers.
- Add a p95 bound, and a second page with Markdown (Markdown and Shiki cost
  much more; SYSTEM-DESIGN section 10).
- Set the bounds from a few runs on this machine: about 10x the measured
  median, so only a real regression fails.
- Needs the e2e build (minutes), so it stays in `npm run test:e2e`, not in
  step 8's `check`.
- **Verify:** `npm run test:e2e` passes; the done note records the medians,
  p95s and bounds.
- Done 2026-10-28 in `test/e2e/preview-server.e2e.test.ts`: the `performance` block now has a shared `hundredEdits` helper and two tests, `/landing/home-v2` and a Markdown post (`/blog/perf-draft`, css fence). Three runs, server render time: home median 2.2-3.0 ms, p95 3.5-5.3 ms; Markdown median 2.6-3.2 ms, p95 3.7-4.6 ms. Bounds (about 10x): median < 30 ms, p95 < 50 ms. Run with `--disableConsoleIntercept` to see the logged numbers.

### 7c. Memory

- The e2e server is a separate process (`global-setup.ts` spawns it with
  `PREVIEW_DEV=1`), so the test can't read its memory directly. Add a dev
  route next to `dev/documents-route.ts` (`devRoutes()`, `PREVIEW_DEV` only,
  never in a production build) that returns `process.memoryUsage()` after
  `globalThis.gc?.()`, and spawn the server with `--expose-gc`.
- Check two things:
  - the RSS after warmup is under a loose bound (the design measured about
    150 to 250 MB for `sample-site` with overlay routes and Markdown loaded;
    the 80 MB figure is a static site);
  - the RSS after 500 more renders has not grown by more than a small margin
    (a leak check, worth more than the absolute number).
- Stays in `npm run test:e2e`, not in step 8's `check`.
- **Verify:** `npm run test:e2e` passes; the done note records the RSS numbers
  and bounds.
- Done 2026-10-28: `src/dev/memory-route.ts` (`/__dev/memory`, added to `devRoutes()`; the `devRoutes` unit test now lists both routes), `global-setup.ts` starts the server with `--expose-gc`, and a third test in the e2e `performance` block runs after the two timing tests (so the server is warm) and renders `/landing/home-v2` 500 times. First version (RSS-growth check) was reworked after review, see the fixes below.
- **Fixes before commit (review 2026-10-28).** A measurement with the full
  `memoryUsage()` breakdown showed three problems with the test above:
  - *Order-dependent.* Run alone (`-t "keeps memory"`) it fails: the "before"
    reading is a cold server (RSS 99 MB), so module and Shiki loading reads as
    +150 MB of growth. It only passes because the timing tests warm it first.
  - *RSS is a noisy leak signal.* In a full-suite run RSS grew +36 MB
    (282 to 318 MB) while `heapUsed` after GC grew +2 MB (68 to 70 MB). The
    growth is V8 reserving heap (`heapTotal` 162 to 190 MB), not retained
    objects. +36 MB against a 50 MB bound will flake.
  - *The done note's explanation is wrong.* Live heap is 68 MB; most of the gap
    to the design's 218 MB is reserved-but-empty heap (`heapTotal` 162 MB vs
    `heapUsed` 68 MB) left by the suite's render churn, not the dev routes.

  Changes:
  - The test warms up itself before the first reading: render
    `/landing/home-v2` and the Markdown post (`/blog/perf-draft`, css fence)
    about 50 times each, reusing the documents the timing tests use. It must
    pass both alone (`-t "keeps memory"`) and in the full e2e run.
  - Read the whole `/__dev/memory` body (`rss`, `heapTotal`, `heapUsed`,
    `external`), not only `rss`.
  - Leak check on `heapUsed` after the forced GC: growth over the 500 renders
    `< 10 MB` (measured +2 MB). Drop the RSS-growth assertion.
  - Keep `rss < 400 MB` as the loose absolute bound, checked after warmup.
  - Log `rss`, `heapTotal` and `heapUsed` before and after, in MB.
  - Rewrite the done note: numbers from three runs, both alone and in the full
    run (RSS, heapTotal, heapUsed, heapUsed growth), the new bounds, and the
    explanation above in place of the dev-routes guess.
  - **Verify:** `npx vitest run --config vitest.e2e.config.ts -t "keeps memory"
    --disableConsoleIntercept` passes, and `npm run test:e2e` passes.
  - Fixes done 2026-10-28. The test warms up itself (50 renders each of
    `/landing/home-v2` and `/blog/perf-draft`; the Markdown document is now the
    shared `perfDraft(i)` helper), logs `rss`, `heapTotal` and `heapUsed` before
    and after, and asserts `rss < 400 MB` after warmup and `heapUsed` growth
    over 500 renders `< 10 MB`. The RSS-growth assertion is gone. Three runs
    each, MB (after warmup, then after 500 renders):
    - Alone: rss 240-245 then 264-267; heapTotal 123-136 then 125-132;
      heapUsed 63 then 59-65; heapUsed growth -3.9 to +2.0.
    - Full e2e run (40 tests pass): rss 267-297 then 273-328; heapTotal
      144-175 then 139-196; heapUsed 69 then 64-70; heapUsed growth -4.8 to
      +1.4.
    - heapUsed is flat (live heap 63-70 MB); rss and heapTotal move by tens of
      MB between runs because V8 reserves heap, which is why only heapUsed is
      the leak check. The gap to the design's 150-250 MB figure (rss 240-330
      here) is reserved-but-empty heap, not retained objects or the dev routes.

## 8. Tooling manual and check script (CI groundwork)

There is no remote yet, so this step prepares CI rather than setting it up.
It has two outputs.

### 8a. `DOCS/QUALITY-TOOLING.md`, the manual

This plan records how each tool was chosen and set up. The manual is the
reference you use day to day, and it replaces this plan as the entry point.

- **Overview:** one short section per tool covering what it guards in this
  project, where its config lives, and whether it gates (fails the run) or only
  reports. Tools: the strict `tsc` flags, Biome, Zod at the boundaries (a code
  pattern, not a command), Skott, osv-scanner, Knip, the budget tests (7a to
  7c), and Stryker.
- **Guide:** for each tool that runs as a command, give the exact command, its
  rough runtime, and how to read its output here. For example:
  - an osv-scanner failure caused by an expired ignore entry means re-check
    that entry, not upgrade;
  - Knip should report nothing, and any new finding is either dead code or a
    missing entry in `knip.json`;
  - a budget failure prints the measured value next to its bound;
  - the memory test checks heapUsed growth, not RSS (see 7c);
  - a Skott cycle means a real cycle, and its edge list needs the API
    workaround from step 4.
- **Stryker section:**
  - what the score means and the 60/80 thresholds in `stryker.config.json`;
  - that `break` is `null`, so the score is a report, not a gate;
  - how to open the HTML report under `reports/mutation/`;
  - how to triage survivors: equivalent mutants and constants come last, as
    [MUTATION-WEAK-SPOTS.md](MUTATION-WEAK-SPOTS.md) notes;
  - how to run it on one file with `--mutate`.
- **Incremental mode:**
  - the baseline is `reports/stryker-incremental.json`, which is gitignored and
    therefore local;
  - deleting that file forces a full run;
  - a change to a test or to the config re-runs every mutant those tests cover;
  - `--force` re-runs everything.
- Link MUTATION-WEAK-SPOTS.md as the last full-run snapshot, with its date.
  Don't copy its table into the manual.
- Keep the manual concise: a reference, not a history. Link this plan for the
  reasoning behind each tool.

- Done 2026-10-28: `DOCS/QUALITY-TOOLING.md` written (overview table, command table with runtimes, "how to read failures", Stryker and incremental sections). Measured runtimes: tsc, biome lint, biome format, knip and osv-scanner about 1-2 s each, the bridge test about 1.7 s; the e2e run, Skott and a full Stryker run are given as rough figures and 8b should measure them. Skott is listed as a report, not a gate, because the documented command passes `--exitCodeOnCircularDependencies=0`. The last full Stryker run is dated 2026-10-28 from the report files' timestamps (MUTATION-WEAK-SPOTS.md itself carries no date).

### 8b. A root `check` script

One command runs everything by hand, and later it becomes the body of the CI
job.

- **Form:** a Node script, `scripts/check.ts`, run with `node` like
  `src/build.ts`. Add a root npm script, `"check": "node scripts/check.ts"`.
  Use Node, not bash or PowerShell, so it runs the same on Windows and in a
  Linux CI. It must not add dependencies.
- **Sets**, selected by flag:

  | Flag | Contents | Rough time |
  | --- | --- | --- |
  | `--fast` (default) | `tsc`, `biome lint`, `biome format`, unit tests (`vitest run`), `knip`, `npm run audit` | about 1 min |
  | `--e2e` | the fast set, then `npm run test:e2e` (builds and spawns the server; includes the 7b and 7c budgets) | a few min |
  | `--mutation` | `npx stryker run` (incremental) | depends on what changed |
  | `--all` | all of the above, then the Skott cycle check | long |

  Flags combine, for example `--fast --mutation`. The builder measures the
  times and records them in the manual.
- **Behavior:**
  - run the tools one after another, never in parallel, because memory is low;
  - keep going after a failure, so one run reports every problem;
  - finish with a summary table: tool, pass/fail/report, duration;
  - exit non-zero if any gate failed;
  - Stryker and Knip's output never fail the run in `--mutation`; Stryker's
    score is printed as a report;
  - stream each tool's output as it runs, without capturing and replaying it.
- **Skott:** use the pinned `npx skott@0.35.12` cycle check from step 4, and
  only in `--all`, because `npx` fetches it over the network.
- **osv-scanner** is a winget install, not an npm package. If it isn't on PATH,
  report "skipped" with the install command and don't fail the run. CI will
  install it.
- **The "targeted tests only" rule** in `CLAUDE.md` applies to agent sessions.
  This script is the one place where the full unit suite runs, started by a
  person. Say so in the manual. Agents don't run `npm run check` unless asked.
- **Done:**
  - `npm run check` and `npm run check -- --e2e` pass on a clean tree;
  - a deliberately broken file (a type error) fails `--fast` with a non-zero
    exit, and the summary still lists every tool;
  - a second `--mutation` run after a one-line change finishes in minutes and
    reports the reused mutants.

- Done 2026-10-28: `scripts/check.ts` plus root `"check"` script (no new dependencies; spawns each command with `shell: true`; `"type": "module"` added to the root `package.json` to silence Node's typeless-package warning). Measured: fast set about 14 s (993 unit tests), `--e2e` adds about 22 s, `--all` about 79 s end to end. A deliberate type error fails `--fast` with exit 1 and the summary still lists all six tools; an unknown flag exits 2. Mutation: the stored baseline was stale (tests had changed since the last full run), so the first `--mutation` run took 9 min and reused only 281 of 2684 mutants; the next run reused 2684 of 2684 and took 26 s. The manual documents this.

### Later, once there is a remote

- A CI workflow runs `npm run check -- --e2e` on every push. The mutation run
  stays manual or nightly, with the incremental file cached between runs.
- Turn on the dependency bot from step 5.
- Step 9 depends on this CI workflow.

## 9. dependency-cruiser (deferred)

Added once CI exists, with the rules the design implies:

- `client/**` must not import `node:*` or server modules.
- `preview-protocol` must not import from the server.
- The preview node is read-only (decision 4): no write or git helpers in the
  render, overlay and request paths.
- No cycles, and no production code importing test fixtures.
