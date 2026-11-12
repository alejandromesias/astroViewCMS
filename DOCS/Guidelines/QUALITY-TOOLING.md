# Quality tooling: manual

Day-to-day reference for the automated checks in this repo: what each one
guards, how to run it, and how to read what it says. It is meant to be read on
its own. The reasoning behind each choice and the history of how each tool was
set up is in [QUALITY-TOOLING-PLAN.md](../Historic/QUALITY-TOOLING-PLAN.md).

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
| `preview-contract` | The contract between the renderer and `cms-server`: manifest shapes, `schema.json`, the render request body, with Zod schemas. Depends only on `preview-protocol` and Zod. | yes |
| `cms-server` | The CMS server on `127.0.0.1`: Hono routes over plain modules for documents, git, media and preview nodes. Depends on `preview-protocol` and `preview-contract`, never on the renderer. | yes |
| `sample-site` | Sample Astro site the server renders in tests and demos. | no (fixtures, not our code) |

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

| Tool | What it guards | Config | Gate? | Where it runs |
| --- | --- | --- | --- | --- |
| Strict `tsc` flags | type holes | `preview-render-server/tsconfig.json` | gate | local, CI `fast` |
| Biome | code style and common mistakes | `biome.json` | gate | local, pre-commit, CI `fast` |
| Unit tests and coverage floors | every package's unit tests pass, and each package stays above its line, function, branch and statement floor | `vitest.config.ts` (root), `vitest.projects.ts` | gate | local, CI `fast` |
| Zod at the boundaries | untrusted input | code pattern | gate (tested at runtime) | in the unit tests |
| osv-scanner | known vulnerabilities in dependencies | `osv-scanner.toml` | gate | local (if installed), CI `fast` |
| Knip | dead code, unused exports and dependencies | `knip.json` | gate (should print nothing) | local, CI `fast` |
| dependency-cruiser | import rules: client stays browser-safe, protocol is a leaf, read-only request path, cycles, tests | `.dependency-cruiser.cjs` | gate | local, pre-commit, CI `fast` |
| Module graph (dependency-cruiser) | nothing: diagrams for people, an edge list for agents | `.dependency-cruiser-graph.cjs`, `scripts/graph.ts` | neither (a view) | local |
| Budget tests | bridge size, render latency, memory growth | tests | gate | local `--e2e`, CI `e2e` |
| Browser tests | the preview in a real Chromium: hydration, morphing, styles, editor origins | `preview-render-server/vitest.browser.config.ts` | gate | local `--e2e`, CI `e2e` |
| Memory metric | rss and private memory of one preview process, idle, after warm-up, after renders | `scripts/measure-memory.mjs` | neither (a number to record) | local |
| Stryker | whether the tests catch changes to the code | `stryker.config.json`, `stryker.<group>.config.mjs`, `.mutation-waivers.json` | gate (75 changed set, 80 per changed file) | CI `mutation-diff` (in parallel with `fast` and `e2e`), CI `mutation-full` (13 shards, skipped on a quiet night), CI `mutation-branch` (by hand); local only as an exception |

"Gate" means a failure should stop a change from landing (and fails the
build in CI; see [CI-PIPELINE.md](CI-PIPELINE.md)). "Report" means the output needs a human reading it.

### How each tool is applied here

- **Strict `tsc` flags.** `preview-render-server` is type-checked only (no
  emit: Node runs the `.ts` files directly). On top of `strict` it turns on
  `noUncheckedIndexedAccess` (an array or record read may be `undefined`),
  `exactOptionalPropertyTypes` (`{ a?: string }` does not accept an explicit
  `undefined`), `noImplicitOverride` and `noFallthroughCasesInSwitch`. When one
  fails, fix the code rather than relaxing the flag.
- **Biome** lints and formats `preview-render-server`, `preview-protocol`, `preview-contract` and `cms-server`
  (test fixtures are excluded). Rules are the recommended set plus three
  stricter ones: unused imports are errors, a promise nobody awaits is an error
  (`noFloatingPromises`), and `any` is an error. Test files may use `any` and
  non-null assertions. Style: 2-space indent, single quotes, LF line endings.
- **Unit tests and coverage floors.** One Vitest run (`npm run coverage`, from
  the root `vitest.config.ts`) runs the unit tests of all four packages. Their
  projects come from `vitest.projects.ts`, which Stryker shares. The coverage
  report covers each package's `src/` (and the renderer's `test-editor/`). Each
  package has its own floor (one glob each), so a weak package cannot hide
  behind strong ones. **Decision (user, 2026-11-02):** every package's floors are
  Lines 80, Functions 90, Branches 80, Statements 80. This overrides all earlier
  per-package floors (the renderer's ratchet at 97, the 98 and 86 of the other
  packages, `cms-server`'s 85 / 98 / 65 / 83) until a further assessment. The
  aim is test quality, not chasing a number. If a metric cannot reasonably be
  met for a file, the file may be excluded from coverage, temporarily or
  permanently, but only after the user approves it; the exclusion is listed with
  its reason in `vitest.config.ts`.
- **Zod** (imported from `astro/zod`, the copy Astro already ships) parses
  everything that crosses a trust boundary instead of casting it: the render
  request envelope (`src/render/envelope.ts`), the query checks in
  `src/render/handlers.ts`, and the site config (`src/site-config.ts`). The
  parsed type is what the rest of the code sees, and the 400 messages the
  server returns stay byte-identical because tests assert them. Document
  *contents* are not checked here; that is a separate schema pass later. This
  one is a code pattern, so there is no command: its protection is the unit
  tests of those files.
- **dependency-cruiser** builds the import graph of the production code and
  enforces the import rules. It includes cycles (`no-circular`: file A imports B
  imports A, which make code hard to test and to move; runtime imports only, as
  `import type` vanishes at compile time). The architecture notes in
  [MODULE-GRAPH.md](../MODULE-GRAPH.md) come from the same graph. The rules also
  keep the bridge (`client/`) free of Node and server modules and keep test
  fixtures out of production code.
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
  - *Render latency* (e2e, `test/e2e/budgets.e2e.test.ts`): after
    warmup, median render under 30 ms and p95 under 50 ms, for an HTML page and
    for a Markdown document. The `landing/long` render budget (100 consecutive
    edits of a 44-block page) is wider: median under 60 ms and p95 under 100 ms.
    Five runs measured the median at 8 to 33 ms, so a median near 60 ms is a
    real regression, not noise. The budget file runs as its own Vitest project
    after the other e2e files (`vitest.e2e.config.ts`, `groupOrder`), so no
    other file loads the CPU while a median is measured.
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
| Typecheck, contract | `npm run typecheck -w preview-contract` | seconds |
| Unit tests, contract | `npm run test -w preview-contract` | seconds |
| Typecheck, cms-server | `npm run typecheck -w cms-server` | seconds |
| Typecheck, sample site | `npm run typecheck -w sample-site` | seconds |
| Unit tests, cms-server | `npm run test -w cms-server` | seconds |
| Unit tests and coverage floors, all packages | `npm run coverage` (root `vitest.config.ts`: one run, prints the coverage summary, fails under any package's floor) | ~25 s (measured 2026-11-02: 24.6 to 25.5 s) |
| Lint | `node_modules/.bin/biome lint` | ~2 s |
| Format check | `node_modules/.bin/biome format` (fix with `--write`) | ~2 s |
| Unit tests, one file | `cd preview-render-server && ../node_modules/.bin/vitest run <file>` | seconds |
| Unit tests, all | `cd preview-render-server && ../node_modules/.bin/vitest run` | ~5 s (1039 tests, 35 files) |
| e2e and budgets | `cd preview-render-server && ../node_modules/.bin/vitest run --config vitest.e2e.config.ts` | ~46 s (94 tests, 14 files; measured 2026-11-02: 46.0 to 46.7 s; the budget file runs last, alone, see *Render latency* under [How each tool is applied here](#how-each-tool-is-applied-here)) |
| Browser tests | `npm run test:browser -w preview-render-server` (one file: append `-- <file>`) | ~32 s (10 files, 25 tests; measured 2026-11-02: 31.0 to 33.4 s) |
| Memory of one preview process (manual) | `npm run measure:memory` (see [Memory metric](#memory-metric)) | ~21 s |
| Audit | `npm run audit` (needs `osv-scanner`, see below) | ~3 s |
| Knip | `npm run knip` | ~2 s |
| dependency-cruiser | `npm run depcruise` (rules: [Annex](#annex-dependency-cruiser-rules)) | ~3 s |
| Module graph | `npm run graph` (see [Module graph](#module-graph)) | ~20 s |
| Edges of one file | `npm run -s deps -- --focus "<regex>"` or `--reaches "<regex>"` | ~3 s |
| Stryker | `npx stryker run` | see Stryker |
| Everything | `npm run check [-- flags]` | ~38 s fast, ~115 s with `--e2e`, ~710 s with `--all` (measured 2026-11-02, step sums, see [Running everything](#running-everything); the Stryker step is 594 s of the `--all` total) |

The e2e run builds the sample site and spawns the server, so it needs a free
port and some memory. Add `--disableConsoleIntercept` to see its `console.log`
output (the memory test prints its readings that way).

`osv-scanner` is not an npm package. It is installed once with
`winget install -e --id Google.OSVScanner --version 2.7.0` (open a new shell
afterwards so it is on PATH).

Cycles are checked by the `no-circular` rule in the `depcruise` step. It counts
type-only imports too (`tsPreCompilationDeps`), as Skott did, so a cycle made of
`import type` alone also fails. Run `npm run depcruise` to see them. The
"missing-tsc-transpiler" notice it prints is expected: the swc parser does the
work, because dependency-cruiser does not support TypeScript 7 yet.

### Module graph

`npm run graph` draws the import graph with dependency-cruiser, over the
production code of `preview-render-server`, `preview-protocol` and `preview-contract` (tests, test
helpers, Vitest configs and `.d.ts` files left out). It enforces nothing. It writes two files to `reports/graph/`:

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
| `--fast` (default) | tsc for the five packages (the sample site included), biome lint, biome format, unit tests and coverage floors (every package, one run), knip, depcruise, osv-scanner | ~38 s (measured 2026-11-02: the unit tests and coverage step 25 s, the rest 13 s; 2026-11-01 measured 127 s for the same steps, not explained) |
| `--e2e` | the fast set, then e2e and the budget tests, and the browser suite | the fast set plus ~77 s (measured 2026-11-02: e2e 46 s, browser 31 s) |
| `--mutation` | `node scripts/stryker-changed.ts --run`: Stryker on the files the branch changed (commit first), judged like the `mutation-diff` job | minutes to tens of minutes; see [CI-PIPELINE.md](CI-PIPELINE.md) |
| `--all` | everything above (the coverage floors run in the fast set) | the fast set plus e2e plus the changed-files mutation run |

Example: `npm run check -- --e2e --mutation`. An unknown flag exits with code 2.

The `depcruise` step enforces the import rules listed in the [annex](#annex-dependency-cruiser-rules).

- Tools run one after another (memory is low) and their output streams live.
- A failure does not stop the run; the closing summary table lists every tool
  with `pass`, `fail`, `report` or `skipped`, and its duration. The exit code
  is non-zero if any gate failed.
- Stryker shows `report`, but fails the run when its score is under
  `thresholds.break`.
- If `osv-scanner` is not on PATH, that step is `skipped` with the install
  command, and the run does not fail locally. With `CI` set a missing tool fails
  the step, and CI installs osv-scanner at a pinned version.
- **Who runs it:** the "targeted tests only" rule in `CLAUDE.md` applies to
  agent sessions. This script is where the full unit suite runs, started by a
  person. Agents do not run `npm run check` unless asked.
- **Mutation timing:** the first `--mutation` run after tests change can be
  long (9 min once, when the stored baseline was stale and only 281 of 2684
  mutants were reused). The next run reused all 2684 and took 26 s. Changing
  one line of source re-runs only the mutants on that code.
- **The sample-site build "exit 1" (wave 5, explained 2026-11-07):**
  `npm run build` and `npm run build:sample` in `preview-render-server` exit 1
  when `.build/sample-site` already holds files from an earlier build but no
  `bundle.json`. `assertOutDirIsSafe` (`preview-render-server/src/site-config.ts`)
  refuses to clear a folder it did not create. A fresh `--out` folder builds
  with exit 0 (checked on Windows, 2026-11-07). The stale folder is gitignored:
  delete it, or pass a new `--out`. CI runs no site build step; its e2e tests
  build into fresh `.build/e2e-*` folders, so the check never trips there.

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
- **Cycles:** a `no-circular` violation is a real runtime cycle, so fix the import
  structure (move the shared piece to a third file). To see its edges, run
  `npm run -s deps -- --reaches "<regex>"`.
- **Files loaded by path:** the graph follows only `import` statements, so
  `src/dev/memory-route.ts` and `src/client/bridge.ts` (both loaded through
  `new URL(...)` in `integration.ts`) show as orphans. They are not dead code.
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

- **Packages covered:** `preview-render-server`, `preview-contract`,
  `preview-protocol` and `cms-server` (`mutate` in `stryker.config.json`). Their tests run through
  `vitest.mutation.config.ts`, which lists each package as a Vitest project;
  a new package needs a project entry there as well as `mutate` globs.
  `vitest.related: true` is set so a single-file run (`--mutate <file>`) runs only
  the tests that import that file.
- **Where it runs (renderer):** on `preview-render-server/src`, excluding test files, type
  files and the entry scripts and routes that unit tests cannot reach (the
  exclusions mirror the coverage exclusions in `vitest.config.ts`). Tests run
  through Vitest with `coverageAnalysis: perTest`, so each mutant runs only the
  tests that cover its line.
- **Score:** (killed + timeout) / (killed + timeout + survived + no coverage).
  Errored mutants are not counted. Thresholds in `stryker.config.json`: `high`
  90, `low` 80. Above 90 is healthy; below 80 needs attention.
- **Floor:** `break` is 75 (decided by the user, 2026-11-03). A score below 75
  fails the run. The values were all over the place and forced failing runs: `break` 90 failed the
  2026-11-02 run at 88.88%. The thresholds live only in `stryker.config.json`; the docs quote them
  from there. Earlier values: `break` 85 (2026-10-29), 90 (2026-10-31).
  It is a ratchet: raise it when the score rises; lower it only
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
- **Context:** [MUTATION-WEAK-SPOTS.md](../Historic/MUTATION-WEAK-SPOTS.md) is the record
  of the first full run and the work that followed it, with the weakest files
  and function-level hot spots. Use it to see what has already been judged noise.
- **One file (local, the exception):** `node scripts/stryker-run.mjs stryker.renderer.config.mjs --mutate "preview-render-server/src/overlay/dates.ts"`
  takes seconds to a few minutes depending on the file.
- **Where it runs:** in CI (`mutation-diff` on every pull request push, `mutation-full`
  nightly and by hand at the end of a wave); see [CI-PIPELINE.md](CI-PIPELINE.md). Locally only through
  `scripts/stryker-run.mjs`, never `npx stryker run`. The history below is from
  before CI.
- **Full run (history):** `npx stryker run` took tens of minutes on the first,
  non-incremental run.
- **Last full run:** 2026-10-28, 90.74% overall (34 files, 992 tests; was
  77.55% on the first run). The latest incremental run (2684 mutants, 970
  tests) scored 91.83%. **Latest run: 2026-10-31** (`npm run check -- --all`, 161 s
  after source changes): 91.74% over 2781 mutants (2525 killed, 18 timeout, 211
  survived, 18 no coverage, 7 runtime errors), above the 90 floor.
  **Run 2026-11-02** (`npm run check -- --all`, 594 s): 88.88% over 4,254 mutants (3747 killed, 33 timeout, 431 survived, 42 no coverage, 1 error), **under the 90 break**, so the run exits 1. `cms-server` is 78.3% (`server.ts` 36%, the bridge that 2.7a rewrites; `codecs` 72.8%). No `src` file changed in task 2.1f, so this is code from waves 1 to 3; task 2.1g owns it. Not fixed in 2.1f.
  **Forced full run, 2026-11-01** (new root config, `preview-protocol` added, ~29 min):
  92.83% over 2735 mutants. By package: preview-render-server 92.98%,
  preview-protocol 97.22%, preview-contract 83.10% (between the `low` line of 80 and
  the `high` line of 90, and the weakest; 9 survivors).

### Running Stryker through the script (since 2026-11-04)

A raw `npx stryker run` creates its sandbox (`.stryker-tmp`) inside the repo. The sandbox has
no `.git`, so a git call made by a test or a mutant climbs to the main checkout. This switched
the checkout to another branch three times (WORKPLAN-PHASE-2.md, 2.1h standing risk). The
rules that came from it:

1. **Clean tree.** Commit or stash before a run.
2. **Tripwire hook.** `.githooks/reference-transaction` refuses any ref or `HEAD` change in the
   main checkout while `VITEST` or `STRYKER_MUTATOR_WORKER` is set. Needs `core.hooksPath`
   set to `.githooks` (see Pre-commit hook).
3. **Only the script runs Stryker:** `node scripts/stryker-run.mjs <config> --mutate <files>`.
   It refuses a dirty tree and a run without `--mutate`, adds `--force`, exports `HEAD` with
   `git archive` to `%TEMP%\avc-stryker\<stamp>` (no `.git`, no repository above it), links
   `node_modules` with junctions, and checks that git finds no repository there. Before and
   after, it compares the main checkout's branch, `HEAD`, refs (except `refs/t3/`, which the
   T3 Code app writes), local config and root `node_modules`; if any changed it copies nothing
   back. Cleanup removes junctions as links, never following them.
4. **Agents.** Builder briefs for agents that may run Stryker carry the same rule. Agents that
   edit code run with `isolation: "worktree"`, but a Stryker run still goes through the script.

Configs: one per group (`stryker.<group>.config.mjs`, groups in CI-PIPELINE.md section 3; `cms-server` is seven groups (six by folder or file, plus the rest) since 2.1s and 2.1t). Output: `reports/stryker-runs/<stamp>/`
(`run.json` has the config, arguments and `HEAD`), plus the console output. Each run starts
from an empty incremental file, so the accumulated `reports/stryker-triage-*.json` files are
not updated. `--mutate` is required; the whole repo runs in CI as `mutation-full`.

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
- A fresh clone has no baseline, so its first run is a full run. CI does not use
  incremental mode: `stryker-run.mjs` always passes `--force`, so every score is
  fresh. Whether the nightly should cache a baseline is decided in WORKPLAN 2.1p.

## Browser suite

The browser suite runs the preview in a real Chromium, which the HTTP tests
cannot do: hydration of islands, morphing of a draft into the live page,
computed styles, and the editor-origin check.

- **Where:** `preview-render-server/test/browser/`, ten `*.browser.test.ts`
  files (25 tests), with `vitest.browser.config.ts`. Vitest runs in browser
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
- **Out of the coverage floors and Stryker on purpose.** The root
  `vitest.config.ts` includes only each package's `src/` (and the renderer's
  `test-editor/`), so the coverage run never reaches `test/browser/`. Stryker
  mutates only `src/` and runs through `vitest.mutation.config.ts`, and a
  browser test cannot map a mutant to its line. Its floors are unchanged by the
  browser suite.
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
8. **`scripts/check.ts`:** add its `typecheck` step to `FAST`. Its unit tests
   run in the one `unit tests + coverage` step, so they need no step of their own.
9. **Coverage:** add a project for it to `vitest.projects.ts` (shared by the coverage and Stryker configs) and a per-package threshold glob to the root `vitest.config.ts`
   threshold, so the unified coverage run (task 2.1e) covers it. A package
   without a floor is unguarded.
10. **This manual:** update the overview and command tables.

Skipping a line does not fail anything; the package is just unchecked. That
is the reason for the list.

## Annex: dependency-cruiser rules

`npm run depcruise` checks every import under `preview-render-server/src`,
`preview-protocol/src`, `preview-contract/src` and `cms-server/src` against `.dependency-cruiser.cjs`. A rule is an
"allowed to import" question; a violation prints the rule name below.
"Request path" means the files that serve a preview request: `render/`,
`overlay/`, `client/`, `serve/` (the front server and the gate), `*-route.ts` and
`request-guard.ts`.

| Rule | In plain words | Why | Severity |
| --- | --- | --- | --- |
| `client-stays-browser-safe` | `client/` imports no `node:*` builtin, no server module outside `client/` and nothing from `preview-contract` (its index pulls in `node:crypto` and Zod) | the bridge runs in the browser and has a size budget | error |
| `protocol-is-a-leaf` | `preview-protocol` never imports `preview-render-server` or `cms-server` | it is the shared contract; the CMS app imports it too | error |
| `contract-is-a-leaf` | `preview-contract` imports no workspace package except `preview-protocol` (Zod is external and allowed) | it is shared with `cms-server`; it must not pull in the renderer, the sample site or the CMS server | error |
| `request-path-no-process-or-git` | the request path imports no `child_process`, git library or store/write module | the preview node is read-only (decision 4) | error |
| `request-path-fs-allowlist` | only `render/runtime.ts`, `overlay/plugins.ts`, `media-route.ts` and `serve/static.ts` import `fs` | the tool sees imports, not calls, so each `fs` user is reviewed once; `serve/static.ts` only reads the client folder, traversal-guarded | error |
| `renderer-never-imports-cms-server` | `preview-render-server` never imports `cms-server` | the two apps share only `preview-contract` and `preview-protocol` (design 5.11) | error |
| `cms-server-never-imports-renderer` | `cms-server` imports no `preview-render-server` module | the CMS uses `preview-protocol` and `preview-contract` only (design 5.11) | error |
| `child-process-only-in-git-and-preview` | only `cms-server/src/git/` and `cms-server/src/preview/` import `node:child_process` | process calls stay in two reviewable places (design 5.11) | error |
| `hono-only-in-http` | only `cms-server/src/http/` imports `hono` | the other CMS modules stay HTTP-free (design 5.11) | error |
| `no-circular` | no runtime import cycles (`import type` is ignored) | cycles break load order and make code hard to test | error |
| `no-test-in-production` | production code (the four packages' `src`) never imports a test, test helper or fixture | tests must not ship or shape the build | error |
| `no-orphans` | lists files nothing imports | Knip already gates dead code; entries loaded by URL look orphaned | warning |
| `not-to-unresolvable` | every import resolves (`virtual:` and `astro:` are exempt) | a typo or missing dependency fails here | error |

Test files (`*.test.ts` and anything under `test/`) are exempt from
`child-process-only-in-git-and-preview` and `hono-only-in-http` (`pathNot: TESTS`),
because the git test harness (`cms-server/test/helpers/`) runs `git` in tests.
Packages in `node_modules` are shown as edges but not followed (`doNotFollow`),
so the `node_modules/` matchers see them.

Out of scope on purpose: build-time code (`manifest/`, `schema/`, `build.ts`,
`integration.ts`) writes files, and `dev/` runs only under `PREVIEW_DEV`.

**When a rule fails:** fix the import, not the rule. The one routine config
edit is a new `fs` allowlist entry, with a comment saying why the file only
reads. To change or add a rule, edit `.dependency-cruiser.cjs` and update this
table. The reasoning behind each rule is in step 9 of
`QUALITY-TOOLING-PLAN.md`.
