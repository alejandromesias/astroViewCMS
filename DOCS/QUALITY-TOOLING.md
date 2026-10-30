# Quality tooling: manual

Day-to-day reference for the automated checks in this repo: what each one
guards, how to run it, and how to read what it says. It is meant to be read on
its own. The reasoning behind each choice and the history of how each tool was
set up is in [QUALITY-TOOLING-PLAN.md](QUALITY-TOOLING-PLAN.md).

## The project in one paragraph

`astroViewCMS` is the preview side of a CMS built on Astro. A visual editor
sends a page's draft content to the **preview render server**, which renders
the real site with that draft in memory (nothing is written to disk) and
returns HTML. A small client script, the **bridge**, runs inside the previewed
page and patches the DOM as drafts change. The code is a set of npm workspaces:

| Workspace | What it is | Checked by the tools below |
| --- | --- | --- |
| `preview-render-server` | The server, the Astro integration, the overlay that swaps in draft content, and the bridge (`src/client/`). All the production logic. | yes |
| `preview-protocol` | Shared types for the messages between editor, server and bridge. | yes |
| `sample-site`, `sampleAstroProject` | Sample Astro sites the server renders in tests and demos. | no (fixtures, not our code) |

Because the server will later handle many sites and untrusted editor input, the
tooling aims at four risks: type holes, bad input at the edges, dead or tangled
code, and regressions in size, speed and memory. A fifth tool, Stryker, checks
whether the tests themselves are good enough.

## How to use this document

Run everything from the repo root `astroViewCMS/` unless a command says
otherwise. Times are measured on the dev machine. To run every check at once,
use `npm run check` (see [Running everything](#running-everything)). If an
`npx` or `npm run` wrapper garbles output, call the binary directly
(`node_modules/.bin/...`). Agents working on a feature run only the targeted
tests for it; the full unit suite is for a person running the checks.

## Overview

| Tool | What it guards | Config | Gate? |
| --- | --- | --- | --- |
| Strict `tsc` flags | type holes | `preview-render-server/tsconfig.json` | gate |
| Biome | code style and common mistakes | `biome.json` | gate |
| Zod at the boundaries | untrusted input | code pattern | gate (tested at runtime) |
| Skott | circular imports | none (CLI flags) | report (read the printed cycles) |
| osv-scanner | known vulnerabilities in dependencies | `osv-scanner.toml` | gate |
| Knip | dead code, unused exports and dependencies | `knip.json` | gate (should print nothing) |
| dependency-cruiser | import rules: client stays browser-safe, protocol is a leaf, read-only request path, cycles, tests | `.dependency-cruiser.cjs` | gate |
| Module graph (dependency-cruiser) | nothing: diagrams for people, an edge list for agents | `.dependency-cruiser-graph.cjs`, `scripts/graph.ts` | neither (a view) |
| Budget tests | bridge size, render latency, memory growth | tests | gate |
| Browser tests | the preview in a real Chromium: hydration, morphing, styles, editor origins | `preview-render-server/vitest.browser.config.ts` | gate |
| Memory metric | rss and private memory of one preview process, idle, after warm-up, after renders | `scripts/measure-memory.mjs` | neither (a number to record) |
| Stryker | whether the tests catch changes to the code | `stryker.config.json` | gate in `--mutation` (score floor) |

"Gate" means a failure should stop a change from landing (and, once there is
CI, fail the build). "Report" means the output needs a human reading it.

### How each tool is applied here

- **Strict `tsc` flags.** `preview-render-server` is type-checked only (no
  emit: Node runs the `.ts` files directly). On top of `strict` it turns on
  `noUncheckedIndexedAccess` (an array or record read may be `undefined`),
  `exactOptionalPropertyTypes` (`{ a?: string }` does not accept an explicit
  `undefined`), `noImplicitOverride` and `noFallthroughCasesInSwitch`. When one
  fails, fix the code rather than relaxing the flag.
- **Biome** lints and formats `preview-render-server` and `preview-protocol`
  (test fixtures are excluded). Rules are the recommended set plus three
  stricter ones: unused imports are errors, a promise nobody awaits is an error
  (`noFloatingPromises`), and `any` is an error. Test files may use `any` and
  non-null assertions. Style: 2-space indent, single quotes, LF line endings.
- **Zod** (imported from `astro/zod`, the copy Astro already ships) parses
  everything that crosses a trust boundary instead of casting it: the render
  request envelope (`src/render/envelope.ts`), the query checks in
  `src/render/handlers.ts`, and the site config (`src/site-config.ts`). The
  parsed type is what the rest of the code sees, and the 400 messages the
  server returns stay byte-identical because tests assert them. Document
  *contents* are not checked here; that is a separate schema pass later. This
  one is a code pattern, so there is no command: its protection is the unit
  tests of those files.
- **Skott** builds the import graph of the production code and finds cycles
  (file A imports B imports A), which make code hard to test and to move. It
  also backs the architecture notes in [MODULE-GRAPH.md](MODULE-GRAPH.md),
  including the rules that the bridge (`client/`) imports no Node or server
  module and that no production file imports a test fixture. It is not a
  project dependency; it runs through `npx` at a pinned version.
- **osv-scanner** (Google's open-source scanner) checks every package in
  `package-lock.json` against the OSV vulnerability database. Advisories we
  have judged harmless (dev-only tools such as Stryker's dependencies) are
  listed in `osv-scanner.toml`, each with a reason and an expiry date.
- **Knip** finds files, exports, types and dependencies nothing uses. Several
  files are loaded by name rather than imported (Astro routes, the bridge, the
  image service, site configs); `knip.json` lists them as entry points so they
  are not reported as unused. The two sample sites are skipped.
- **Budget tests** turn performance into tests that fail when a number crosses
  a limit:
  - *Bridge size* (`src/client/bridge-size.test.ts`, a unit test): the bridge
    is bundled and gzipped; it must stay under its byte budget (measured
    5318 B, budget 6400 B), because it ships into every preview page.
  - *Render latency* (e2e, `test/e2e/preview-server.e2e.test.ts`): after
    warmup, median render under 30 ms and p95 under 50 ms, for an HTML page and
    for a Markdown document. The `landing/long` render budget (100 consecutive
    edits of a 44-block page) is wider: median under 60 ms and p95 under 100 ms.
    Five runs measured the median at 8 to 33 ms, so a median near 60 ms is a
    real regression, not noise.
  - *Memory* (same e2e file): after warmup, `rss` under 400 MB, and `heapUsed`
    grows by under 10 MB over 500 more renders. The test reads memory from a
    dev-only route (`/__dev/memory`) after a forced GC. The server is started
    with `PREVIEW_DEV=1` and `--expose-gc` for this; neither exists in
    production.
- **Browser tests** (Vitest browser mode, Chromium through Playwright) are the
  only checks that see what the bridge does in a page: hydration of islands,
  morphing of a draft into the live DOM, computed styles, and the editor-origin
  check. The harness page plays the editor and loads the preview in an iframe
  from a real server built with `test/browser/site.config.ts`. Their
  configuration, scope and file list are in the [browser suite](#browser-suite).
- **Stryker** is described in its own section below.

## Commands

| Tool | Command | Time |
| --- | --- | --- |
| Typecheck | `cd preview-render-server && ../node_modules/.bin/tsc` | seconds |
| Typecheck, protocol | `npm run typecheck -w preview-protocol` | seconds |
| Unit tests, protocol | `npm run test -w preview-protocol` | seconds |
| Lint | `node_modules/.bin/biome lint` | ~2 s |
| Format check | `node_modules/.bin/biome format` (fix with `--write`) | ~2 s |
| Unit tests, one file | `cd preview-render-server && ../node_modules/.bin/vitest run <file>` | seconds |
| Unit tests, all | `cd preview-render-server && ../node_modules/.bin/vitest run` | ~5 s (993 tests) |
| e2e and budgets | `cd preview-render-server && ../node_modules/.bin/vitest run --config vitest.e2e.config.ts` | ~22 s |
| Browser tests | `npm run test:browser -w preview-render-server` (one file: append `-- <file>`) | ~40 s (9 files, 18 tests) |
| Memory of one preview process (manual) | `npm run measure:memory` (see [Memory metric](#memory-metric)) | ~21 s |
| Audit | `npm run audit` (needs `osv-scanner`, see below) | ~3 s |
| Knip | `npm run knip` | ~2 s |
| dependency-cruiser | `npm run depcruise` (rules: [Annex](#annex-dependency-cruiser-rules)) | ~3 s |
| Module graph | `npm run graph` (see [Module graph](#module-graph)) | ~20 s |
| Edges of one file | `npm run -s deps -- --focus "<regex>"` or `--reaches "<regex>"` | ~3 s |
| Skott cycles | the command below | ~7 s |
| Stryker | `npx stryker run` | see Stryker |
| Everything | `npm run check [-- flags]` | ~21 s fast, ~95 s with `--e2e`, ~130 s with `--all` (estimate) |

The e2e run builds the sample site and spawns the server, so it needs a free
port and some memory. Add `--disableConsoleIntercept` to see its `console.log`
output (the memory test prints its readings that way).

`osv-scanner` is not an npm package. It is installed once with
`winget install -e --id Google.OSVScanner --version 2.7.0` (open a new shell
afterwards so it is on PATH).

Skott cycle check (from the repo root; it exits 0 whether or not it finds
cycles, so read what it prints). The block below is bash (Git Bash, Linux, CI);
the PowerShell one-liner follows it. `npm run check -- --all` runs it for you
in either shell.

```sh
npx skott@0.35.12 --fileExtensions=.ts --displayMode=file-tree \
  --showCircularDependencies --exitCodeOnCircularDependencies=0 \
  -ts preview-render-server/tsconfig.skott.json \
  -ig 'sample-site/**' -ig 'sampleAstroProject/**' -ig 'reports/**' \
  -ig '**/node_modules/**' -ig 'DOCS/**' -ig '**/*.test.ts' -ig '**/test/**' \
  -ig '**/vitest*.config.ts' -ig 'scripts/**'
```

PowerShell (no `\` continuations, double quotes):

```powershell
npx skott@0.35.12 --fileExtensions=.ts --displayMode=file-tree --showCircularDependencies --exitCodeOnCircularDependencies=0 -ts preview-render-server/tsconfig.skott.json -ig "sample-site/**" -ig "sampleAstroProject/**" -ig "reports/**" -ig "**/node_modules/**" -ig "DOCS/**" -ig "**/*.test.ts" -ig "**/test/**" -ig "**/vitest*.config.ts" -ig "scripts/**"
```

The graph covers production code only: tests, test helpers, the Vitest configs
and `scripts/` are ignored, since only a runner loads them. The extra
`tsconfig.skott.json` maps the workspace import `preview-protocol` to its
source; without it Skott reads that name as an npm package and draws no edge.

Add `--no-trackTypeOnlyDependencies` to see cycles that exist at runtime only
(type-only imports vanish when the code is compiled).

### Module graph

`npm run graph` draws the import graph with dependency-cruiser, over the same
scope as the Skott command (production code of `preview-render-server` and
`preview-protocol`; tests, test helpers, Vitest configs and `.d.ts` files left
out). It enforces nothing. It writes two files to `reports/graph/`:

- **`modules.html`, for people.** Open it in a browser (it loads Mermaid from a
  CDN, so it needs internet). Two diagrams: *Folders* (each `src/` folder
  collapsed to one box, about 25 edges: the architecture at a glance) and
  *Files* (every file, grouped by folder, about 75 edges). Packages are left
  out to keep it readable.
- **`deps.txt`, for agents.** One `from → to` line per edge, npm packages
  collapsed to their name (`node_modules/astro`) and Node builtins kept
  (`fs`), so `grep` answers "who imports X" and "what does X import". About
  9 KB; the JSON reporter says the same in about 110 KB.

For one question, skip the files and ask directly: `npm run -s deps -- --focus
"render/handlers"` prints that file's imports and importers, and `--reaches
"preview-protocol/src/index.ts"` prints everything that depends on it,
directly or not.

### Running everything

`npm run check` runs `scripts/check.ts` (plain Node, no dependencies, so it
behaves the same on Windows and a Linux CI). Flags go after `--` and combine:

| Flag | Runs | Time |
| --- | --- | --- |
| `--fast` (default) | tsc, tsc protocol, protocol tests, biome lint, biome format, unit tests, knip, depcruise, osv-scanner | ~20 s |
| `--e2e` | the fast set, then e2e and the budget tests, the browser suite, and the coverage floors | ~95 s (measured 2026-10-30: 94 s, of which e2e 26 s, browser 32 s, coverage 9 s) |
| `--mutation` | `npx stryker run` (incremental) | ~29 s when nothing changed; see below |
| `--all` | everything above, then the Skott cycle check | ~130 s with a warm Stryker baseline |

Example: `npm run check -- --e2e --mutation`. An unknown flag exits with code 2.

The `depcruise` step enforces the import rules listed in the [annex](#annex-dependency-cruiser-rules).

- Tools run one after another (memory is low) and their output streams live.
- A failure does not stop the run; the closing summary table lists every tool
  with `pass`, `fail`, `report` or `skipped`, and its duration. The exit code
  is non-zero if any gate failed.
- Skott is a report: it shows `report`, never fails the run on cycles (only a
  crash of the tool itself counts as `fail`). Stryker also shows `report`, but
  fails the run when its score is under `thresholds.break`.
- If `osv-scanner` is not on PATH, that step is `skipped` with the install
  command, and the run does not fail. CI will install it.
- Skott runs only with `--all`, because `npx` fetches it over the network.
- **Who runs it:** the "targeted tests only" rule in `CLAUDE.md` applies to
  agent sessions. This script is where the full unit suite runs, started by a
  person. Agents do not run `npm run check` unless asked.
- **Mutation timing:** the first `--mutation` run after tests change can be
  long (9 min once, when the stored baseline was stale and only 281 of 2684
  mutants were reused). The next run reused all 2684 and took 26 s. Changing
  one line of source re-runs only the mutants on that code.

### Pre-commit hook

`.githooks/pre-commit` (plain `sh`) runs both typechecks, `biome lint`,
`biome format` and `depcruise`, stopping at the first failure (under ~10 s). Unit
tests, Knip and the audit stay in `npm run check`. Enable it once per clone:

```sh
git config core.hooksPath .githooks
```

Git for Windows runs it with its bundled `sh`, so PowerShell needs nothing
extra. Skip it with `git commit --no-verify` only rarely, and say why in the
commit message.

### How to read the results

- **tsc:** no output and exit 0 is a pass. Each error is
  `file(line,col): error TSxxxx: message`. Read the first line of each.
- **Biome:** exit 0 is a pass. Each finding names the rule and the line. For
  format findings, run `biome format --write` rather than editing by hand.
- **Unit and e2e tests:** on a failure read the one assertion line (expected
  against received), not the stack trace.
- **osv-scanner, a package vulnerability:** upgrade the dependency, or add an
  `[[IgnoredVulns]]` entry with `id`, `ignoreUntil` (at most three months out)
  and a `reason`.
- **osv-scanner, an expired ignore entry:** the audit fails again once
  `ignoreUntil` passes. Re-check the entry (is the advisory still unfixed? is
  the package still dev-only?), then either upgrade or renew the date with a
  fresh reason. Do not renew blindly.
- **Knip:** it should print nothing. A new finding is either dead code (delete
  it) or a file used in a way Knip cannot see (declare it in `knip.json`).
  Knip's output is easy to over-trust: check a flagged item before deleting it.
- **dependency-cruiser:** a violation names the rule (see the [annex](#annex-dependency-cruiser-rules)) and the `from → to` edge. Fix the import, not the config. The one legitimate config edit is an `fs` allowlist entry (`request-path-fs-allowlist`), which needs a comment giving the reason the file only reads. Orphan warnings print but never fail the run.
- **Skott:** it follows only `import` statements, so a file loaded by a path
  string shows as an orphan. `src/dev/memory-route.ts` and `src/client/bridge.ts`
  (both loaded through `new URL(...)` in `integration.ts`) are expected to look
  unused; they are not dead code. A reported cycle is a real cycle, so fix the import structure
  (move the shared piece to a third file). The CLI prints the cycle verdict but
  not the edge list; to see all edges, use Skott's API as described in
  [MODULE-GRAPH.md](MODULE-GRAPH.md).
- **Budget failures:** the assertion prints the measured value next to its
  bound, for example `bridge is 5318 bytes gzipped, budget 6400`. Latency and
  memory numbers can be noisy on a busy machine, so re-run once before
  digging. A real regression repeats.
- **Memory test:** it judges `heapUsed` growth, not RSS growth. RSS only has a
  coarse ceiling (400 MB) because V8 reserves heap and the OS keeps freed pages,
  so RSS moves by tens of MB between runs without a leak. A live-heap rise of
  several MB across the 500 renders is the real signal of a leak.
- **Browser tests:** a failure names the test and the assertion, and some name
  a GAP or KNOWN LIMIT (asserted as the product does today, so they pass). A
  run that loses its browser connection under low memory has passed on a
  re-run; re-run once before digging, as with the budgets.
- **Memory metric:** compare private memory across runs, not rss. Private
  memory is what the process owns; rss also counts shared pages.

## Stryker (mutation testing)

Line coverage says which code the tests *run*, not whether they would *notice*
it being wrong. Stryker changes the production code in small ways, one change
at a time (a `<` becomes `<=`, a condition becomes `true`, a string becomes
empty). Each change is a *mutant*. It then re-runs the tests: if one fails the
mutant is *killed* (good); if none fails it *survived* (the tests do not pin
that behaviour down).

- **Where it runs:** on `preview-render-server/src`, excluding test files, type
  files and the entry scripts and routes that unit tests cannot reach (the
  exclusions mirror the coverage exclusions in `vitest.config.ts`). Tests run
  through Vitest with `coverageAnalysis: perTest`, so each mutant runs only the
  tests that cover its line.
- **Score:** (killed + timeout) / (killed + timeout + survived + no coverage).
  Errored mutants are not counted. Thresholds in `stryker.config.json`: `high`
  80, `low` 60. Above 80 is healthy; below 60 needs attention.
- **Floor:** `break` is 85 (baseline 91.83 on 2026-10-29), so a score below 85
  fails the run. It is a ratchet: raise it when the score rises; lower it only
  with a reason in the commit.
- **Report:** open `reports/mutation/mutation.html` in a browser. Filter by
  file, then by status (Survived, NoCoverage); each survivor shows the original
  and the changed code. `reports/` is gitignored.
- **Triage survivors**, in this order:
  1. *No coverage:* no test reaches the code. Add one.
  2. *Conditions and logic* (boundaries, `&&` against `||`, error paths): add a
     test whose input tells the original from the mutant.
  3. *Equivalent mutants* (the change cannot alter behaviour, such as a
     `?? ''` fallback that is never reached) and *bare constants* (regexes,
     word lists, message strings) last. They are usually not worth a test.
- **Context:** [MUTATION-WEAK-SPOTS.md](MUTATION-WEAK-SPOTS.md) is the record
  of the first full run and the work that followed it, with the weakest files
  and function-level hot spots. Use it to see what has already been judged noise.
- **One file:** `npx stryker run --mutate "preview-render-server/src/overlay/dates.ts"`
  takes seconds to a few minutes depending on the file.
- **Full run:** `npx stryker run`. A first, non-incremental run takes a long
  time (tens of minutes). With the baseline below, later runs are quick.
- **Last full run:** 2026-10-28, 90.74% overall (34 files, 992 tests; was
  77.55% on the first run). The latest incremental run (2684 mutants, 970
  tests) scored 91.83%.

### Incremental mode

`"incremental": true`, with the baseline stored in
`reports/stryker-incremental.json` (gitignored, so local to the machine).

- Only mutants whose code or covering tests changed since the last run are
  re-run; the rest reuse the stored result. The summary line says how many were
  reused.
- Changing a test or the config re-runs every mutant those tests cover, so a
  small edit to a widely used test file can still mean a long run.
- Delete `reports/stryker-incremental.json` to force a full run, or pass
  `--force` to re-run everything while still updating the file.
- A fresh clone has no baseline, so its first run is a full run. A future CI
  would have to cache this file between runs to benefit from incremental mode.

## Browser suite

The browser suite runs the preview in a real Chromium, which the HTTP tests
cannot do: hydration of islands, morphing of a draft into the live page,
computed styles, and the editor-origin check.

- **Where:** `preview-render-server/test/browser/`, nine `*.browser.test.ts`
  files (18 tests), with `vitest.browser.config.ts`. Vitest runs in browser
  mode through `@vitest/browser-playwright`, on Chromium headless. It needs the
  Playwright Chromium build (`npx playwright install chromium`, once per
  machine).
- **How it works:** a harness page on port 5174 (`origin.ts`) plays the editor.
  `global-setup.ts` builds `site.config.ts` (the sample site with the harness
  origin in `editorOrigins`) and starts it on a free port. The harness loads
  that preview in an iframe and sends it the real protocol messages.
  `commands.ts` holds the custom commands (`previewEval`, `delayRenders`, and
  others) that run in Node with Playwright's API, because the iframe is
  cross-origin to the harness page.
- **Run:** `npm run test:browser -w preview-render-server`. Files run one at a
  time (`fileParallelism: false`; memory is low). To run one file, append it:
  `npm run test:browser -w preview-render-server -- morph.browser.test.ts`.
- **Gate:** the `browser` step of `npm run check -- --e2e`, after e2e and the
  budgets.
- **Out of the coverage floors and Stryker on purpose.** `vitest.config.ts`
  includes only `src/**` and `test-editor/**`, so the coverage run never
  reaches `test/browser/`. Stryker mutates only `src/` and runs through
  `vitest.config.ts`, and a browser test cannot map a mutant to its line. Its
  floors are unchanged by the browser suite.
- **Not in dependency-cruiser's scope.** It scans `src/` only, so the suite is
  not checked by it. Production code still may not import `test/`
  (`no-test-in-production`).
- **Knip:** `test/browser/commands.ts` and `test/browser/site.config.ts` are
  entry points in `knip.json`: the commands are reached by name through the
  config's `commands` object, and the site config is named by a path string in
  `global-setup.ts`. Knip cannot follow either.

## Memory metric

`npm run measure:memory` (`scripts/measure-memory.mjs`) is a manual script, not
a gate. It builds the default sample (`sites/sample-site.config.ts`), starts
its server in its own process, and reports two numbers at three points: idle
(listening, no request), after warm-up (`POST /__preview/warm`), and after 100
renders of `landing/home-v2`.

- **rss** is `process.memoryUsage().rss` from `/__dev/memory`, after a forced
  GC, the same figure the memory budget and SYSTEM-DESIGN.md use.
- **Private memory** comes from the OS: the private working set on Windows
  (`WorkingSetPrivate`), and `Private_Clean` plus `Private_Dirty` in
  `/proc/<pid>/smaps_rollup` on Linux. Only Windows has been run.
- **Recorded, 2026-10-30, Windows, default sample, one server process:**

  | Stage | rss | Private |
  | --- | --- | --- |
  | Idle | 98.8 MB | 49.0 MB |
  | After warm-up | 202.0 MB | 150.2 MB |
  | After 100 renders | 231.3 MB | 177.6 MB |

  Record both figures and the machine's conditions next to any new reading.

## Adding a workspace package

Every new package (`cms-server` is next) has to join the guardrails, because
most tools list their scope by path and a package they do not list is
unchecked. Go through this list when the package is created:

1. **Root `package.json`:** add it to `workspaces`.
2. **Package scripts:** `typecheck` (`tsc`) and `test` (`vitest run`), as in
   `preview-protocol`.
3. **`tsconfig.json`:** copy `preview-protocol/tsconfig.json`, so the strict
   flags carry over. Do not relax one for the new package.
4. **`biome.json`:** add `<package>/**` to `files.includes`.
5. **`knip.json`:** add a `workspaces` entry with its entry points (files
   loaded by name rather than imported).
6. **`stryker.config.json`:** add its `src` globs to `mutate`, with the same
   exclusions as for the render server (glue scripts with top-level effects).
7. **`package.json` `depcruise` script:** add `<package>/src` to the paths, and
   add rules for what the package may and may not import (see the
   [annex](#annex-dependency-cruiser-rules)). Update the annex table. Add the
   same path to the `deps` script and to `BASE`, `INTERNAL` and `FOLDERS` in
   `scripts/graph.ts`.
8. **`scripts/check.ts`:** add its `typecheck` and `test` steps to `FAST`.
9. **Skott step in `scripts/check.ts` and `tsconfig.skott.json`:** map any workspace import to
   its source, as for `preview-protocol`.
10. **This manual:** update the overview and command tables.

Skipping a line does not fail anything; the package is just unchecked. That
is the reason for the list.

## Annex: dependency-cruiser rules

`npm run depcruise` checks every import under `preview-render-server/src` and
`preview-protocol/src` against `.dependency-cruiser.cjs`. A rule is an
"allowed to import" question; a violation prints the rule name below.
"Request path" means the files that serve a preview request: `render/`,
`overlay/`, `client/`, `*-route.ts` and `request-guard.ts`.

| Rule | In plain words | Why | Severity |
| --- | --- | --- | --- |
| `client-stays-browser-safe` | `client/` imports no `node:*` builtin and no server module outside `client/` | the bridge runs in the browser and has a size budget | error |
| `protocol-is-a-leaf` | `preview-protocol` never imports `preview-render-server` | it is the shared contract; the CMS app imports it too | error |
| `request-path-no-process-or-git` | the request path imports no `child_process`, git library or store/write module | the preview node is read-only (decision 4) | error |
| `request-path-fs-allowlist` | only `render/runtime.ts`, `overlay/plugins.ts` and `media-route.ts` import `fs` | the tool sees imports, not calls, so each `fs` user is reviewed once | error |
| `no-circular` | no runtime import cycles (`import type` is ignored) | cycles break load order and make code hard to test | error |
| `no-test-in-production` | production code never imports a test, test helper or fixture | tests must not ship or shape the build | error |
| `no-orphans` | lists files nothing imports | Knip already gates dead code; entries loaded by URL look orphaned | warning |
| `not-to-unresolvable` | every import resolves (`virtual:` and `astro:` are exempt) | a typo or missing dependency fails here | error |

Out of scope on purpose: build-time code (`manifest/`, `schema/`, `build.ts`,
`integration.ts`) writes files, and `dev/` runs only under `PREVIEW_DEV`.

**When a rule fails:** fix the import, not the rule. The one routine config
edit is a new `fs` allowlist entry, with a comment saying why the file only
reads. To change or add a rule, edit `.dependency-cruiser.cjs` and update this
table. The reasoning behind each rule is in step 9 of
`QUALITY-TOOLING-PLAN.md`.
