# Work plan for closing phase 2

Written 2026-11-16, with waves 1 to 10 closed and `main` at `7dd6bff`. Wave 11 closed (2026-11-18): 2.14m, 2.14d, 2.10k, 2.11c, 2.13d and 2.12a are merged, and `main` is at `18e1831`. Status: **approved by the user, 2026-11-16 (U0), with U1 answered yes (slim 2.10f).** It is the live plan for the rest of phase 2. Three documents are folded into it:

- the open tasks of [WORKPLAN-PHASE-2.md](WORKPLAN-PHASE-2.md) (2.10e onwards);
- [WAVES-11-14-REWRITE.md](Proposals/WAVES-11-14-REWRITE.md);
- [WORKPLAN-PRE-PHASE-3.md](Proposals/WORKPLAN-PRE-PHASE-3.md).

WORKPLAN-PHASE-2.md then becomes the log. Its finished task bodies, Results and review notes stay where they are, so code comments that cite "WORKPLAN 2.5c" still resolve. Nothing new is written there.

Background: [SYSTEM-DESIGN-AUDIT.md](../Designs/SYSTEM-DESIGN-AUDIT.md) (findings A1 to A19). Authority: [SYSTEM-DESIGN.md](../Designs/SYSTEM-DESIGN.md), then [PHASE-2-DESIGN.md](../Designs/PHASE-2-DESIGN.md). If this plan and the design disagree, fix this plan.

Rule for this file: a task entry holds its goal, its inputs and its "done when". When a task closes, its Result line gives the PR, the merge commit, the score and a short summary: what was built, the decisions taken and by whom, the findings that changed the design, what is still open, and the implications for later tasks. Keep each item to a line or two. The full review rounds, commit-level detail and test notes stay in the PR, and the Result names it so it can be found.

## 1. Where phase 2 stands

### 1.1 Goal and done-when

Phase 2 builds `cms-server` for one site: read, save, preview from the saved state, sync, publish. It is done when every row of PHASE-2-DESIGN section 1 passes:

| Row | Proven by | State |
|---|---|---|
| R1. Edit two documents, save, reload: the preview shows them with no rebuild | 2.9e (HTTP); 2.12b (browser) | HTTP done; browser open |
| R2. A stale `baseRevision` answers 409 | 2.5c | done |
| R3. Publish creates one commit | 2.10d | done |
| R4. A developer's push to a saved document, then publish: the CMS wins and the message names it | 2.10b, 2.10d | done |
| R5. Deleting a referenced document is refused unless the same save fixes it | 2.6b | done |
| R6. With the build check on, a changeset that breaks the build is not pushed | 2.10e | open |
| R7. The test editor on the CMS origin drives the preview on its own origin | 2.8e; 2.12b | spike done; browser test open |
| R8. `cms-server` memory measured | 2.13e, 2.13a | 2.13e measured (PR #57); the publish part is open in 2.13a |

### 1.2 What is built (waves 1 to 10)

| Area | Tasks | What exists |
|---|---|---|
| Renderer side | 2.0, 2.8 | The `preview-contract` package (Zod, separate from `preview-protocol`). Bundle identity, revisions and the image list. Manifests inside `outDir`. A front server with token and CHIPS cookie, refusing to start without secrets unless `PREVIEW_INSECURE=1`. The config route and bridge. Validate tells real errors from refinements that threw |
| `cms-server` foundations | 2.1a to 2.1e, 2.2, 2.3, 2.4 | The package, config and dependency rules. Codecs for JSON, YAML, Markdown and MDX frontmatter, and `file()` entries. A git exec wrapper isolated by `GIT_DIR` and `GIT_WORK_TREE` (2.1j). Repo lifecycle, mutex, commits, worktrees. Bundle reader, list and read routes, the schema walker |
| Saving | 2.5, 2.6, 2.7 | Write planner. Changeset state derived from git, with base revisions and overwrite trailers and no side file. `PUT /api/changes` as a pipeline of stages. Delete guard with a reference index. Media upload, images at save time, warnings for missing `public/` images |
| Node and builds | 2.9 | Build runner, node supervisor, state, triggers and status. Preview client, overlay, preview URL, warm-up. Host allowlist on every CMS route |
| Git flow | 2.10a to 2.10d, 2.10g to 2.10j | Sync, per-document re-apply, guard recheck after sync, rename warnings. Publish (squash, push, retry). Poll loop |
| Editor | 2.11a, 2.11b, 2.11e | The test editor served on the CMS origin, its data sources, and its mutation scope (`editor.ts` 97.21%) |
| CI and process | 2.1k to 2.1t | Fast gates, e2e, `mutation-diff`, sharded `mutation-full`, nightly, weekly Windows, security scans, ruleset, worktree tooling, docs straight to `main` |
| Wave 11 (so far) | 2.14m, 2.14d, 2.10k, 2.11c, 2.12a, 2.13d | osv audit off docs-only pushes. `cms-contract` wire schemas and error codes. The pure `auto` build-check function. Save, conflicts, the changes list and the editor's API client. The test editor's stopgap routes removed (2.12a). The three files under 80 (2.13d) |
| Wave 12 (so far) | 2.14e, 2.11d | The `Origin` guard on write routes and the start-up origin warning (2.14e). The editor's Publish button, status polling and the run guide (2.11d) |

### 1.3 Decisions to carry

These are the rules builders keep needing. Each is in the log under the task named.

- **The CMS change wins** per document; the commit message names what it overwrote (D18, 2.10b).
- **Changeset state lives in git** (2.5b). Revisions of `file()` entries hash the raw entry without its id (2.0c).
- **Publish (2.10d).**
  - The squash parent is the merge base of `cms/work` and `origin/<branch>`. The push is never forced. The author is `git.author`.
  - A push race retries at most 3 times, then answers `502`. A retry does not revalidate. A retry whose sync brought code stops with `503 upstream-changed` (with `--bundle`) or `503 build-in-progress`.
  - `status.publish = { state, error }`.
- **Locking.** Save and publish share one mutex, and a lock timeout answers `503 busy`. No lock is held during a build (2.10d, 2.10e).
- **Builds.** Every trigger builds `cms/work` HEAD (2.9c-B). A failed first build is never rebuilt automatically; a restart is the manual retry (2.9c-B, decided 2026-11-09).
- **Poll (2.10g).** It runs only while an `/api` call came in the last 5 minutes, with the interval capped at 299 s. Back-off goes up to 10 minutes. While no node serves, a content-only change asks for a `sync-code` build.
- **Build check (2.10e, decided 2026-11-13).**
  - The `auto` triggers are recomputed at publish time and nothing is stored. Anything the check cannot tell counts as "build".
  - The candidate is built on a snapshot; saves are refused until the publish ends (design 3, decided 2026-11-18). Saves that continue during the build (design 1) are deferred to phase 4 or 5 (see 2.10e below).
- **Quality gates.**
  - Coverage floors are 80 lines, 90 functions, 80 branches and 80 statements per package (2026-11-02).
  - The Stryker thresholds are `high` 90, `low` 80, `break` 75 (2026-11-03). Never change `break`.
  - `mutation-diff` gates each changed file at 80.
  - A wave closes on a green `mutation-full` and a tag.

### 1.4 Quality state

- Wave 10 `mutation-full` (run `43491378803`, `da5388b`): **94.15%** overall.
- Were under 80 since wave 6: `preview-contract/src/schema.ts` 57.14, `preview-render-server/src/bundle.ts` 45.00, `preview-render-server/src/overlay/errors.ts` 57.14. 2.13d (#54) cleared them: local Stryker on `bundle.ts` now kills 40 of 40 (its two survivors are killed by a pinned git call, not waived). `schema.ts` and `errors.ts` measured 100 locally before the fix. Wave 11 `mutation-full` (run `44241325913`, on `5a75e14`): overall 94.15% (floor 75); `schema.ts` 100 (14 of 14), `bundle.ts` 100 (40 of 40), `errors.ts` 100 (7 of 7). No file is under 80.
- CI and security are green on `7dd6bff`. Nightly runs are green on ten scheduled runs in a row (2026-11-09 to 2026-11-18); see H1.

### 1.5 Accepted limits (carried, not tasks)

- **Rename duplicate:** a document renamed upstream and edited in the CMS is recreated at its old path. It is warned by 2.10j; the real fix changes document identity (audit A18, phase 3 backlog).
- **Formats with no codec:** a referrer in a format with no codec, such as TOML, is invisible to the delete guard. Read-only referrers answer `needsDeveloper`.
- **Windows tree kill:** pinned by a unit test only. The POSIX group kill is proven on Linux CI.
- **`--bundle`:** turns off the builder, the triggers, the start-up sweep and the astro check. It is meant for development and e2e.
- **Preview fidelity (D6):** the first render after load morphs script-initialized widgets back to server markup. The Swiper carousels on `landing/home-v2` break until a reload. This is phase 3 step 3.2, not a phase 2 task.
- **No regions on the sample:** `sample-site.config.ts` declares `regions: {}`. See decision U6.

### 1.6 Housekeeping (docs or checks only, no task branch)

| # | Item | When |
|---|---|---|
| H1 | **2.1p verification:** done 2026-11-18. Ten green scheduled nightly runs (2026-11-09 to 2026-11-18); each has a live `nightly-measurements` artifact. 2.1p is marked verified. The T3 reminder can go after 2026-12-01 | done |
| H2 | **2.1t Result:** done 2026-11-18. Run `43491378803`: `cms-git-ops` 7 min 18 s, `cms-git` 20 min 10 s. 2.1t is DONE (merged as `20dc360`) | done |
| H3 | **osv-scanner ignore** `GHSA-g3hv-75wg-m249` expires 2026-12-15. An expired entry fails `npm run audit` | revisit 2026-12-01 |
| H3b | **osv-scanner ignore** `GHSA-fc5q-39xc-vjpf` (picomatch) expires 2026-12-17. Check first whether a patched picomatch exists. An expired entry fails `npm run audit`. Waiver merged in #56 (`fca9160`) | revisit 2026-12-01 |
| H5 | **`run.test.ts` first-start flake:** one unexplained failure, then green after an explicit 5 s timeout. If it fails again, it becomes a task | watch |

## 2. Working rules (short form)

The full rules are in [README.md](../README.md) section 2 and [CI-PIPELINE.md](../Guidelines/CI-PIPELINE.md). The ones that shape this plan:

- One worktree and branch per task, cut from the latest `main`. Merge when `fast`, `e2e` and `mutation-diff` are green. Commits wait for the user's go-ahead.
- `[build]` tasks run an Astro build or the e2e or browser suite. Run **one at a time**, because the machine has little memory. Unit-only tasks run in parallel freely.
- `[user]` needs the user. `[ci]` is verified by a push.
- Push rarely: 2 or 3 pushes per PR, with all known fixes in one push.
- Targeted Vitest only, never the full suite. Stryker runs only through `scripts/stryker-run.mjs`, on a clean tree. Mutation exclusions need the user's approval.
- A wave closes on a green `mutation-full`, started by hand on `main` when its last PR merges, and then the tag `wave-<n>-closed`.
- Docs-only changes go straight to `main`. LF only. No `any` outside tests.
- Every task id fits `npm run worktree -- new <id> <slug>`. Suffixed ids such as `2.10e-A` are not used; new tasks get free ids instead.

## 3. What was taken from the proposals

I agree with the audit's verdict and with the content of both proposals. The architecture needs no change. What remains is to finish 2.10e, prove the product with a person and a second site, and stop paying gate costs on code phase 3 discards. The table records what this plan does with each proposal and where it departs from it.

| Proposal | Here | Note |
|---|---|---|
| Split 2.10e (rewrite change 1) | **Taken, renamed.** The trigger function is the new **2.10k**. **2.10e** keeps its id, its entry and row R6 | Suffixed ids break `npm run worktree` |
| State table and event-order test (change 2) | **Taken**, with two additions. The table is reviewed by the user **before** the code is written. The test uses a seeded in-repo generator with no new dependency (`fast-check` is not in the repo) | The table is the cheapest place to catch a race |
| Logic in framework-free modules, 2.11c and 2.11d (change 3) | **Taken** | It turns two throwaway tasks into phase 3's first code |
| Early manual run (change 4) | **Taken** as the new **2.12d**, with one addition: 2.11d writes a short run guide | There is no documented way to start `cms-server` against a GitHub repo today (A17), and the first run needs one |
| Slim 2.10f (change 5) | **Taken**, if the user agrees (U1) | Comparing build errors as text is fragile |
| Split 2.13a, add 2.13d (change 6) | **Taken.** The early memory part is the new **2.13e** | |
| 2.14d with 2.11c | **Changed.** 2.14d is its own task, **first** in wave 11, and 2.11c follows it in the same wave | 2.10e adds two `409` codes and 2.10k changes the validate answer. Each should land in the contract once, not be retrofitted. 2.14d also edits every route in `http/`, so nothing else should be in that folder at the same time |
| 2.14a, 2.14b | **Taken** (wave 13; decision U3 in wave 14) | The quick start's compatibility list (2.13b) needs 2.14a's table |
| 2.14c (`schema.json` v2) | **Taken, last** (first in wave 14) | No phase 2 row depends on it. Running it last lets the final acceptance and the measurements use the final bundle shape. If wave 14 runs long, it moves to the start of phase 3 with no loss |
| 2.14e (origins, `Origin` check, same-site spike) | **Taken**: code in wave 12, after 2.14d; the spike in wave 13 | |
| 2.14f (Astro canary), 2.14g (macOS job) | **Taken** (wave 13, `[ci]`) | The repo is public, so macOS runner minutes cost nothing |
| 2.14h (split the work plan) | **Replaced by this file.** No split: WORKPLAN-PHASE-2.md is frozen as the log, under its current name | The split's goal (a small live plan) is met without moving 390 KB or breaking anchors |
| 2.14i (gate profile for UI code) | **Decision U4**, before phase 3 | |
| 2.14j (site context and actor seam) | **Taken** (wave 13, a check first) | |
| 2.14k (reserve `base` in the envelope) | **Moved to phase 3**, with the protocol bump of step 3.7 | There is no protocol bump in phase 2 |
| 2.14l (backup ref for saves) | **Decision U5**; the build is phase 4 | |
| 2.14m (osv-scanner off docs-only pushes) | **Taken, first** in wave 11 | It caused the red docs commit on 2026-11-13 |
| Audit "not proposed" list | **Agreed** | |

The proposals miss five things, and this plan adds them:

1. The housekeeping in 1.6: 2.1p is verifiable now, and 2.1t's Result is empty.
2. The run guide that 2.12d needs.
3. A list of files shared between this plan's tasks (section 5.2).
4. An explicit phase-close checklist (section 7).
5. PHASE-2-DESIGN 5.9's `POST /api/publish` row does not list `409 publish-in-progress` or `409 remote-moved`. 2.14d generates that table, and 2.13b reconciles the design document.

## 4. Decisions for the user

| # | Decision | Needed by | Recommendation |
|---|---|---|---|
| U0 | Approve this plan | **approved 2026-11-16** | — |
| U1 | **Slim 2.10f:** while `upstreamBuildFailed` is set, skip the build check and say so (`buildCheckSkipped: 'upstream-broken'`), instead of comparing error text | before 2.14d is written (it adds the field) | **Yes, decided 2026-11-16** |
| U2 | **2.10e state table:** review it before 2.10e's code starts. Drafted 2026-11-18 ([Proposals/2.10e-STATE-TABLE.md](Proposals/2.10e-STATE-TABLE.md)); design 3 decided (saves refused during a publish; design 1 deferred to phase 4 or 5). Approved 2026-11-18, D-a to D-f as recommended | wave 12 | — |
| U3 | **How a site gets its dependencies** (2.14b): A, workspace only; B, the integration is a package installed into the site; C, hybrid | after 2.14a, wave 14 | A for the MVP and B as the target, stated in the quick start |
| U4 | **Gates for UI code** (2.14i): logic modules under the mutation gate; views get type check, lint, coverage and browser tests | before phase 3 | Yes |
| U5 | **Backup ref for saves** (`refs/cms/work`, pushed after a save and restored at start-up) | before phase 3; built in phase 4 | Yes, recorded in SYSTEM-DESIGN section 12 |
| U6 | **Regions** (A13): freeze them (keep the code, add nothing to the sample) or mark two or three regions on the sample | at 2.13b | Freeze |
| U7 | **Per-package mutation floors** (2.13c): keep one pooled threshold plus the per-file 80 on changed files, or add per-package gates | wave 14 | Keep pooled. Per-file `mutation-diff` already catches a weak file, and 2.13d clears the last three |
| U8 | **Key format of the UI hints** in the site config (2.14c item 4) | in 2.14c's PR | As proposed (`'<collection>.<path>': { label, widget, hidden }`) |

The phase 3 design questions (MVP scope, Preact, page-first navigation, click-to-focus, reload mode, editor language) are in [PHASE-3-DESIGN-PROPOSAL.md](../Designs/PHASE-3-DESIGN-PROPOSAL.md) section 10. They are asked when phase 3 starts, not here.

## 5. The waves

### 5.1 Table

| Wave | Tasks, in start order | `[build]` order |
|---|---|---|
| 11 | 2.14m `[ci]`, then 2.14d, then 2.11c (after 2.14d). Beside them: 2.10k, 2.13d, 2.12a `[build]`, then 2.13e `[build]` | 2.12a, 2.13e |
| 12 | 2.14e (code) first, then 2.11d. 2.10e is split into 2.10l `[build]` and then 2.10m `[build]` (2.10e stays as their umbrella; the table was approved, U2). 2.12d `[user]` as soon as 2.11d merges | 2.10l, 2.10m |
| 13 | 2.10f `[build]`, 2.12b `[build]`, 2.14a `[build]`. Beside them: 2.14e spike `[user]`, 2.14f `[ci]`, 2.14g `[ci]`, 2.14j, and any fixes from 2.12d | 2.10f, 2.12b, 2.14a |
| 14 (close) | 2.14c `[build]` first, then 2.12c `[user]`, 2.13a `[build]`, 2.13b, decisions U3 to U7, then the phase close (section 7) | 2.14c, 2.13a |

```text
 wave 11  2.14m   2.14d ──▶ 2.11c ─────────┐     2.10k ─────┐    2.13d    2.12a ─▶ 2.13e
 wave 12          2.14e (code)       2.11d ◀┘──▶ 2.12d [user]   2.10l ─▶ 2.10m [build] ◀┘ (umbrella: 2.10e)
 wave 13  2.10f ──▶ 2.12b      2.14a ─▶ (U3)     2.14e spike   2.14f  2.14g  2.14j
 wave 14  2.14c ──▶ 2.12c [user]   2.13a   2.13b   U3..U7   ──▶ phase close
```

**Critical path:** 2.10k → 2.10l → 2.10m → 2.10f → 2.12b → 2.12c → phase close. A second chain, 2.14d → 2.11c → 2.11d → 2.12d, gets the product in front of the user by the end of wave 12.

### 5.2 Shared files (serialize these)

| Files | Tasks, in order |
|---|---|
| `cms-server/src/http/*` | 2.14d, then 2.14e (the `Origin` check, small), then 2.10l and 2.10m (they rebase on 2.14e) |
| `cms-server/src/sync/publish.ts`, `preview/bundle-lifecycle.ts` | 2.10l, then 2.10m, then 2.10f |
| `preview/status.ts` | 2.10l, then 2.10m, then 2.10f (the `upstreamBuildFailed` type change) |
| `preview-contract/src/` | 2.10k (the validate answer), 2.13d (`schema.ts`), 2.14c. A task that changes `schema.ts` before 2.13d merges must bring it to 80 |
| `cms-server/editor/` | 2.11c, then 2.11d |
| `preview-render-server/src/` | 2.12a and 2.13d (`bundle.ts`): 2.13d waits for 2.12a's merge if 2.12a touches `bundle.ts`. 2.14c is last (`integration.ts`, the schema pass) |
| Tool configs (`biome.json`, `knip.json`, `stryker*.json`, depcruise, `scripts/check.ts`) | 2.14d if it adds a package, and 2.12a. Whichever starts second rebases |

## 6. Tasks

### Wave 11

**Status (2026-11-17):** 2.14m, 2.14d, 2.10k and 2.11c are merged (#50 to #53). 2.12a is merged (#55, `cd008ee`) and 2.13d is merged (#54, `18e1831`). 2.13e is merged (#57, `5a75e14`). It was the last wave 11 task. **Closed (2026-11-18).** The `mutation-full` run on `main` (run `44241325913`, on `5a75e14`) is green, and the tag `wave-11-closed` is set on `5a75e14`. It settles the 2.13d figure (section 2.13d). The H4 thread on PR #47 (Codex, 2.10g) is resolved; its fix is `f3b70a3`.

**Start order and decisions (2026-11-16, for Lead-11.16's questions).**
- The close plan is authoritative; the 2026-11-13 handoff's wave 11 (with 2.10e) is stale.
- Start together (unit-only, no shared files): 2.14m, 2.13d, 2.10k, 2.14d. 2.10k works in `sync/` and touches `preview-contract/src` only if the validate answer crosses the node boundary. 2.13d lands first on `schema.ts`; later `preview-contract` edits rebase on it.
- 2.14d holds the `[build]` slot while it runs e2e. 2.12a (`[build]`) starts after that; if both edit the tool configs, the one that starts second rebases. 2.13e runs last. 2.11c starts when 2.14d merges.
- 2.14d: new leaf package `cms-contract`. It holds wire shapes only: request and answer bodies and the error-code union with its HTTP status. A type that crosses the wire (for example `PublishAnswer`) is defined in the contract, and `sync/` and `save/` import it; types that never cross it stay put. Routes build errors through one typed helper that accepts only codes in the union, which replaces the string literals; that is the type-level check. One runtime test checks that each code's status matches the status map.
- 2.12a: fix all 9 `organizeImports` failures (`biome check --write`, no behaviour change), including the six in `scripts/`. Remove only what belongs to the test editor. If the `editorOrigins` field in `preview-config.ts` is still how the bridge learns the parent origin, keep it and say so in the PR; removing it is a contract change and needs the user. `cms-server/editor/editor.test.ts` stays in scope only where it names a removed route.
- 2.13e: a new script `measure:cms-memory` next to `measure:memory`. It uses `sample-site`, a prebuilt bundle and `--bundle` (no builder), a local bare repo. It records the rss of the `cms-server` process alone: at rest after 60 s, then after 50 single-document saves with a `GET /api/changes` and a `GET /api/status` after each.
- 2.13d: killing survivors with tests is the default. Any accept-as-equivalent or `.mutation-waivers.json` entry needs the user's approval, as in 2.11e.
- 2.11c: wire shapes come from the 2.14d schemas, not from the log. It is a client task and edits no server route; if it needs a server change, stop and ask.

#### 2.14m osv-scanner off docs-only pushes — `[ci]` · first

- The job that failed on `5079b9c` is `fast gates` in `ci.yml` (it installs osv-scanner and runs `npm run audit`), not `security.yml`. Add `paths-ignore: ['DOCS/**']` to the `push: main` trigger of `ci.yml`, and the same to the `push` trigger of `security.yml`. Leave `pull_request` untouched, so required checks still run on docs PRs. Check that a scheduled run (nightly or `security.yml`) still runs `npm run audit`, so a new advisory shows there; add it if not.
- **Done when:** a docs-only push to `main` starts no `fast gates` run and no osv step, and the schedule and PR triggers still run the audit.
- **Result:** PR #50, merge `35f5e13`. Closed. No mutation score (workflow-only).
  - **Built:** the `DOCS/**` filter on the `push` trigger of `ci.yml` and `security.yml`, so a docs-only push runs no osv step. The audit failure on PR #50 was accepted at the time; H3 tracks the ignore.
  - **Implication:** keep the filter off `pull_request`, or docs PRs stop being audited. Full detail in PR #50.

#### 2.14d `cms-contract`: API schemas and error codes — first code task (A6)

- A Zod schema and an inferred type for each route's request and answer. One union of error codes, each with the HTTP status it maps to.
- Include the codes that 2.10e will answer (`409 publish-in-progress`, `409 remote-moved`) and, if U1 is yes, `buildCheckSkipped`. Later tasks then emit codes that already exist.
- Recommended placement: a new leaf package `cms-contract`. The editor imports only it and `preview-protocol`, which a dependency-cruiser rule enforces. The builder may use an entry point of `preview-contract` instead if the new-package checklist costs too much; say which in the PR.
- `cms-server`'s routes parse requests and build answers with these schemas, and the local response types go. The route and error tables of `CMS-SERVER.md` (2.13b) are generated from the package.
- **Done when:** no route in `cms-server/src/http/` defines a response type of its own; a test fails if a route answers a code that is not in the union; changed files meet the mutation floor.
- **Result:** PR #51, merge `79a0429`. Closed. Mutation-diff 88.46 (changed files).
  - **Built:** the `cms-contract` leaf package (request and answer schemas, one error-code union with HTTP statuses), chosen over an entry point of `preview-contract`.
  - **Open:** `PublishAnswer` is still defined in `cms-server/src/sync/publish.ts`, so the move the plan describes is not done.
  - **Implication:** a route answers only codes in this union, so a new code is added here first. 2.13b will generate the route tables from it. Full detail in PR #51.

#### 2.10k The `auto` triggers — after 2.10d (was 2.10e-A)

- A pure function. Inputs: the changeset, the validate answer, and what sync reported. Output: build or not, with a reason (`mdx-body`, `build-time-field`, `refinement-threw`, `upstream-code`, `unknown`). `unknown` builds.
- "Build-time field" and "MDX body" reuse the logic of `save/rebuild.ts`, run over the changeset.
- The validate answer exposes the keys that hit `refinement-threw`, which is a `preview-contract` change.
- `publish.buildCheck` is read here. `always` and `never` skip the function.
- No lock, no worktree and no git.
- **Done when:** a unit test for each reason and for each combination that must not build; this function is the only place that decides.
- **Result:** PR #52, merge `41fb26f`. Closed. Mutation-diff 87.22. Reviewed by Reviewer-11.6.
  - **Built:** `decideBuild` in `sync/build-check.ts`, the only decider. Reasons: `mdx-body`, `build-time-field`, `refinement-threw`, `upstream-code`, and `unknown` (which builds). Option (i), chosen by you: the renderer writes `build-time.json`, and a created document with no record there builds as `unknown`.
  - **Finding:** a static schema in `preview-contract` made Stryker mutate nothing, so the schema now lives in `cms-server`.
  - **Open:** the optional test for an invalid `build-time.json` in `read.test.ts`.
  - **Implication:** `build-time.json` describes the last build, not the working copy. Keep mutation-scored schemas inside the package under test. Full detail in PR #52.

#### 2.11c Save and the changeset list — after 2.14d, 2.11b, 2.5c

- **Behaviour:**
  - A Save button sends `PUT /api/changes` with `{ changes: [{ document, baseRevision, data?, deleted? }] }`.
  - The answers to handle:
    - `409 conflict`, with "reload" and "keep mine";
    - `exists` and `file-missing`;
    - `422` next to the field, including `media-collision` and `staged-image-missing`;
    - warnings;
    - `referenced-by`;
    - `500 save-failed`;
    - `503 preview-unavailable` and `503 busy` as "try again".
  - After a save, the revisions update and the list refreshes.
  - `rebuild: true` shows "applies after rebuild", polls `GET /api/status` and then reloads the iframe.
  - After a save, re-read the saved documents and replace staging URLs with the saved paths.
  - The detail of each answer is in the log, 2.11c.
- **Structure:** `cms-server/editor/` gets four files:
  - `api.ts`: one function per route, parsing with the 2.14d schemas, with `fetch` passed in;
  - `messages.ts`: maps each answer and code to `{ level, text, field? }`;
  - `media.ts`: the staging URL swap;
  - `editor.ts`: the DOM glue only.
  The first three import no DOM type.
- **Done when:** the per-answer tests are on `messages.ts` and `api.ts`; `editor.ts` gets one wiring test per new button; drafts hide and restore as before.
- **Result:** PR #53, merge `001301d`. Closed. Mutation-diff 92.91. Reviewed by Reviewer-11.16 over five rounds and re-checks, and by Codex.
  - **Built:** `cms-server/editor/` with `api.ts`, `messages.ts`, `media.ts` and `editor.ts` (DOM only). Decisions: a saved delete locks the form and Restore creates the document with no revision (yours); `shapes.ts` is outside the mutation scope (option a, yours).
  - **Rules in `editor.ts`:** states are `saved | edited | deleted | gone`, and `removed` means the server lacks the document. `lockedByDelete` separates a Delete lock from a Reset lock. `applySaved` runs its steps in a fixed order (locks, sent-text baseline, unlock, then the draft). Changing that order needs the state tests in `editor.test.ts`.
  - **Confirmed behaviour (yours):** Reset during a save cancels a Delete made before it, and typing in a live form marked for deletion turns it into an edit. Tests cover both; do not report them as bugs.
  - **Open:** after a failed re-read, staged image URLs can stay in the form and the overlay until the next save (low; a known gap, not fixed).
  - **Implication:** 2.11d builds on this file and must keep the `saved` baseline and the `removed` semantics. Full detail in PR #53, including the review rounds and Codex comments.

#### 2.12a Remove the stopgaps — after 2.11b · `[build]`

- Remove from the preview build:
  - `GET /__dev/documents`;
  - `/__editor` and `test-editor/`;
  - `media-route.ts` and `/__preview-media/*`;
  - the media folder setting;
  - what is left of `editorOrigins`.
- Keep `/__dev/memory`.
- Rewrite or delete the e2e tests that used them. Update Knip, Stryker and depcruise. Add the end date to D12 and D13.
- Clear the six Biome `organizeImports` failures if they still exist; check before starting.
- **Done when:** `npm run check -- --e2e` passes with none of those routes in the preview build, and Biome reports nothing.
- **Result:** PR #55, merge `cd008ee`. Closed. Removed: `/__dev/documents`, `/__editor` and `test-editor/`, `media-route.ts` and `/__preview-media/*`, the media folder setting, and `siteRoot`; `clearBundle` now takes only `outDir`. Kept by decision: `/__dev/memory` and `editorOrigins` (the bridge still reads it; removing it is a contract change). Biome `organizeImports`: 9 failures on main when measured on 2026-11-17, not the six this spec named. Codex: no major issues on `42ac7f3`. CI green on `42ac7f3`. `npm run check -- --e2e` was not run locally (knip crashes here); CI `e2e and browser` is the check. Left by decision: five `/__preview-media/` unit-test fixtures and the `/__editor` fixture (test strings, not routes).
- **Not run locally:** `npm run check -- --e2e` was not run on this machine. The CI job `e2e and browser` was the check.

#### 2.13d The three files under 80 (A16)

- `preview-contract/src/schema.ts`, `preview-render-server/src/bundle.ts` and `preview-render-server/src/overlay/errors.ts`: kill or classify their survivors.
- **Done when:** the wave 11 `mutation-full` lists no file under 80.
- **Result:** PR #54, merge `18e1831`. Closed. Survivors killed by tests, none accepted: the git call's stdio is pinned in `bundle.test.ts`, and an `afterEach` restores the leaked spy in `schema.test.ts`. No `.mutation-waivers.json` entry and no accept-as-equivalent, so no approval was needed. Local Stryker on `bundle.ts`: 40 of 40 killed. Review on `c4c6e6c`: no blocking findings. CI green on `c4c6e6c`, including `mutation on changed files`. Wave 11 `mutation-full` (run `44241325913`, on `5a75e14`) lists no file under 80 for these three files: 100 each (14 of 14, 40 of 40, 7 of 7).

#### 2.13e `cms-server` memory, early — after 2.12a · `[build]` (was 2.13a-1)

- `cms-server` rss at rest and after a session of saves, measured by a script next to `measure:memory`. Record it in section 8 with the date and the method.
- **Done when:** the row has a value. Its publish part comes in 2.13a.
- **Result:** `scripts/measure-cms-memory.mjs`, run as `npm run measure:cms-memory`, merged as #57 (`5a75e14`) on 2026-11-18. Three runs on 2026-11-17, mean and range: rss 128.0 MB (127.4 to 128.8) at rest and 157.1 MB (156.5 to 157.9) after 50 saves; private 73.7 MB (73.2 to 74.4) and 102.4 MB (101.8 to 103.1). Each run adds 28.6 to 29.6 MB of rss over its 50 saves, so the rise is consistent across runs. Only 50 saves were run, so it is not known whether the rise levels off or keeps growing. Section 8 has the row.

### Wave 12

**Status (2026-11-18):** 2.14e (PR #58) and 2.11d (PR #59) are merged. 2.12d `[user]` can start now (2.11d is in). 2.10e, split into 2.10l and then 2.10m, is next.

#### 2.10e Build check and snapshot publish — after 2.10k, 2.14d, 2.9a · umbrella of 2.10l and 2.10m

**Split (2026-11-18, architect, for the wave 12 prep).** 2.10e keeps its id, its row R6, its done-when and the link to the state table, and gets no code of its own. It is done when 2.10l and 2.10m have both merged. 2.10l merges before 2.10m starts. Both start after 2.14e merges, because 2.14e edits every write route in `http/` (section 5.2).

- **2.10l: the gate and the refusals** `[build]`.
  - `sync/publish-gate.ts`: the only place that decides whether a save or a poll tick may run, and the only place that handles saves made since `S` (`afterPush`).
  - The publish click closes the gate synchronously, before it waits for the repo lock. A save or a poll tick checks the gate **after** it gets the lock and before it writes or syncs. A save that waited on the lock while the click arrived therefore sees a closed gate and cannot move `cms/work` off `S`.
  - `pushing` asserts `cms/work === S` before the push, and `afterPush` asserts it again.
  - **The snapshot is per attempt.** A retry with no build syncs, reads `S` again and squashes a new `C`, so the assertion always compares against the current attempt's `S`. That move is legitimate: the gate is closed, so only the publish moves `cms/work`.
  - Design 3 refusals on the 2.10d flow, with no candidate build: a save answers `409 publish-in-progress` and writes nothing, a poll tick is skipped, a second publish answers `409 publish-in-progress`. A sticky `failed` status clears on the next save or publish, and a save is allowed while it is `failed` (the gate is open).
  - Move `PublishAnswer` into `cms-contract` (left open by 2.14d). Add `409 publish-in-progress` to the generated per-route table of `PUT /api/changes` and to PHASE-2-DESIGN 5.9 (done in that file, 2026-11-18).
  - The event-order harness: injected git, build and clock, the curated scenarios of the state table that need no candidate build, and the seeded random runs.
  - **Done when:** the refusals above hold on the 2.10d flow, the gate reopens after every answer, the harness is green, and `PublishAnswer` lives in `cms-contract`.
  - Follow-up (not in 2.10l): preview-contract has 5 files with module-level zod schemas. Stryker's `ignoreStatic: true` marks their static mutants `Ignored`, so the gate never judges them. Fix: set `ignoreStatic: false` for the preview-contract triage, as done for cms-contract in 2.10l, then kill the survivors. Left out of 2.10l so the change does not start judging static mutants in a second CI group in the same PR.
- **2.10m: the candidate build** `[build]`.
  - The snapshot `{ C, S }` and the candidate build in a worktree under `.cms/<site>/` with a name pattern the start-up sweep can match.
  - `preview/bundle-lifecycle.ts` owns the candidate, and publish never calls the build-runner directly. It gains `buildCandidate(commit)` (takes the one build slot, waits for a running build; the builder's triggers merge into one rebuild after release, skipped if `adopt` already covers that commit), `adopt(candidate)` (runs in `finishing` under the lock, through the normal swap path) and `discard(candidate)` (also removes the worktree).
  - **`S` stays fixed once a build has run.** A push race after a build answers `409 remote-moved` and never retries.
  - `decideBuild` is wired in (`always`, `never`, `auto` recomputed at publish time). Publish's `validate()` returns the keys that hit `refinement-threw` to `decideBuild`. This is internal to `cms-server`: no `cms-contract` change (decided 2026-11-18). Showing the editor why a publish builds would be a later feature with its own contract field.
  - Under `auto`, `upstream-code` builds the candidate even if the sync's rebuild just passed on the same tree. The extra build is accepted in phase 2; "skip it when the trees are equal" is a later optimisation.
  - Tests that this task owns: a restart after the push and before `finishing` leaves a changeset with nothing in it (invariant 5); a lock timeout at the push after a build answers `503 busy` and discards the candidate (scenario 8); the start-up sweep removes a stale candidate worktree.
  - **Done when:** the R6 items below hold, and the full event-order test is green.
- **Smoke for 2.12c:** a save during a publish and a failed build, with `buildCheck: always`. 2.12d runs as planned, with `buildCheck: never`, which does not exercise the candidate build.

The scope below is the whole of 2.10e, to be split between the two tasks as above.

- **Carried in:** move `PublishAnswer` into `cms-contract` (left open by 2.14d). Goes to 2.10l.
- **Optional, no owner:** the test for an invalid `build-time.json` in `read.test.ts` (open from 2.10k). Do it in the next task that touches `sync/build-check.ts`.

1. **The state table, before any code (U2).**
   - The states: `idle`, `syncing`, `validating`, `squashing`, `building`, `pushing`, `reconciling`, `failed`.
   - The events: save, poll tick, publish click, build passed, build failed, push accepted, push rejected, remote moved with content, remote moved with code.
   - For each pair: what happens and which answer goes out.
   - The invariants:
     1. A save that answered `200` is in `cms/work` or in a pushed commit, never in neither.
     2. The commit pushed is the commit that was built.
     3. The bundle that serves is never ahead of what was pushed.
     4. At most one publish runs.
     5. No document is published twice as a change.
     6. From the squash to the push, `cms/work` HEAD is `S` (phase 2 only; design 1 drops it).
   - **The architect drafted the table (2026-11-18): [Proposals/2.10e-STATE-TABLE.md](Proposals/2.10e-STATE-TABLE.md).** The user approved it with D-a to D-f as recommended (U2, 2026-11-18). The builder checks it against the code and flags any cell that does not hold. It moves into `CMS-SERVER.md` in 2.13b.
2. **The flow (design 3, decided 2026-11-18; the full table is in [Proposals/2.10e-STATE-TABLE.md](Proposals/2.10e-STATE-TABLE.md)):**
   1. The publish click closes the **publish gate**: from now until the answer, a save answers `409 publish-in-progress` and a poll tick is skipped. `cms/work` cannot move.
   2. Publish syncs, waits for a running rebuild, validates and decides whether to build (`always`, `never`, or `decideBuild` for `auto`, recomputed now). Under the lock it squashes the candidate `C` and notes `cms/work` HEAD as `S`, then releases the lock.
   3. `C` builds in a worktree with no lock held, in the preview builder's one build slot (D-f). `status.publish.state` is `publishing`, and a second publish answers `409 publish-in-progress`.
   4. On a pass, publish takes the lock, checks that `cms/work` is still at `S`, and pushes `C`, never forced. Then `cms/work` resets to `C`, the candidate bundle becomes current, and the gate opens.
   - **(a)** A push race after a build answers `409 remote-moved` and pushes nothing. A race with no build keeps the 2.10d retry (D-c).
   - **(b)** The candidate's bundle becomes current only after a successful push, and the 2.10d post-push rebuild is skipped for it.
   - **(c)** A failed build answers `424 build-failed` with `firstError`. Nothing is pushed, `cms/work` is untouched, the log goes to `.cms/<site>/logs/`, and the status is `failed` (D-e).
   - **Extension seam (for design 1, phase 4 or 5):** `sync/publish-gate.ts` is the only place that decides whether a save or a tick may run, and the only place that handles saves made since `S` (`afterPush`: phase 2 asserts `cms/work` is at `S`; design 1 re-applies them onto `C`). Routes and the poll loop call the gate and never read the publish state for this. The snapshot `{ C, S }` is a value passed between the steps. See SYSTEM-DESIGN.md section 4, "Publish and saves".
   - **Also in this task:** move `PublishAnswer` into `cms-contract` (left open by 2.14d); a test that a restart after the push and before `finishing` leaves a changeset with nothing in it; the start-up sweep removes a stale candidate worktree.
3. **The event-order test.**
   - Git, the build and the clock are injected.
   - Run the curated scenarios of the state table (section 5: the common and the critical ones), then a few hundred seeded random orders of 8 to 12 events, against the real functions, and check the invariants after each step.
   - The generator lives in the repo and adds no dependency.
   - CI uses fixed seeds and prints the seed on a failure. The test stays under about 10 s.
- **Done when (R6):**
  - Build check:
    - a broken MDX body is not pushed under `always` or `auto`, and is pushed under `never`;
    - a content-only change under `auto` skips the build.
  - During a publish:
    - a save answers `409 publish-in-progress` and writes nothing;
    - a poll tick is skipped;
    - a second publish answers `409 publish-in-progress`;
    - a push race after a build answers `409 remote-moved` and pushes nothing;
    - a failed push or build leaves the bundle and `cms/work` unchanged;
    - the gate opens again after every answer.
  - The table is reviewed and the event-order test is green. `[build]`

#### 2.11d Publish — after 2.11c, 2.10d

- **Carried in:** decide whether to fix or accept again: staged image URLs staying in the form and overlay after a failed re-read (open from 2.11c).
- **Behaviour:** a Publish button and a message for each answer of `POST /api/publish`:
  - `200 { commit, overwritten, renamed }`: `commit: null` shows "nothing to publish", and a non-empty `renamed` is a warning;
  - `409 referenced-by`, `422`, `424` and `502`;
  - `503 busy` and `503 build-in-progress` as "try again";
  - `503 upstream-changed`;
  - `409 publish-in-progress`: the button is disabled while `status.publish.state` is `publishing`, and the Save button is disabled with it (drafts are kept), both enabled again on `idle`. The same `409 publish-in-progress` is also the answer to a save made during a publish (2.10e design 3), so `messages.ts` maps it for `PUT /api/changes` too ("A publish is running. Save again when it ends");
  - `409 remote-moved`;
  - `upstreamBuildFailed`, and `buildCheckSkipped` if U1 is yes.
  - The status `publish { state, error }` keeps showing `failed` after a reload. The answer codes come from 2.14d, so this task does not wait for 2.10e.
- **Structure:** as in 2.11c. The publish call goes in `api.ts` and its messages in `messages.ts`. Status polling goes in a DOM-free `status.ts` (start, stop, on change).
- **Gaps found while writing the guide:** record them, and fix them as wave 13 tasks, unless a fix is one line (2026-11-18).
- **Run guide (for 2.12d):** a short `DOCS/Guidelines/RUN-CMS-SERVER.md`. It says how to point `cms-server` at a GitHub repo (`cms.config.ts`, the site config, credentials), the start command, `buildCheck`, and where logs and `.cms/<site>/` live. 2.13b grows it into the quick start.
- **Done when:** per-answer tests on `messages.ts`, `api.ts` and `status.ts`, including `commit: null`, a non-empty `renamed` and each `503` and `409`; the run guide exists.
- **Result:** PR #59, merge `d4d9d46`. Closed. Mutation-diff 92.67 on the changed files (lowest `editor.ts` 89.99; all at or above 80), on head `be783b8`. Reviewed by Reviewer-11.18 over several rounds, and by Codex.
  - **Built:** a Publish button with a message for each answer; `status.ts` (DOM-free) polls `GET /api/status` while a publish runs, and starts a poll when a publish is reported running; a page's own failed publish hides its error from the status line (the answer shows it), until a later publish is seen; a gate refusal (`409 publish-in-progress`, `503 busy`) does not hide a real status error; `DOCS/Guidelines/RUN-CMS-SERVER.md`.
  - **Decisions:** status is polled only while a publish runs, not continuously (the page does not see another tab's publish until it reads status again); staged image URLs after a failed re-read are accepted, not fixed (the carried-in item, decided by you).
  - **Open:** the server does not yet emit `409 publish-in-progress`, `409 remote-moved`, `424 build-failed` or `buildCheckSkipped`. The client handles them, so 2.10l, 2.10m and 2.10f make them real. The run guide is untested until 2.12d.
  - **Implication:** `status.ts` has an `onRead` hook (every answered read) besides `onChange`; the editor's publish-state logic depends on it. `dev-remote.ts` no longer prints a start command the server refuses (a gap found by the guide).

#### 2.14e Local origins and the `Origin` check — after 2.14d (A7)

1. `cms.config.example.ts` uses `http://cms.localhost:4400` and `http://preview.localhost:4401` (PHASE-2-DESIGN 5.7).
2. Start-up logs a warning when `origins.cms` and `origins.preview` share a host.
3. Write routes also refuse a request whose `Origin` header is present and is not `origins.cms`.
- **Carried in:** confirm whether the bridge still needs `editorOrigins` (kept by 2.12a). **Answered (2026-11-18): yes, keep it.** `preview-render-server/src/client/bridge.ts:160-165` reads it from `/__preview/config` to build the allowed parent origins, and `preview-config.ts` still serves it. Say so in the PR.
- **Order:** 2.14e goes first in wave 12 (small, unit-only). 2.10l and 2.10m rebase on it, because it edits every write route in `http/`.
- **Done when:** items 1 to 3 are merged with tests. The spike is item 4, in wave 13.
- **Result:** PR #58, merge `7f07298`. Items 1 to 3 closed; item 4 (the spike) is still open, in wave 13. Mutation-diff on the changed files, head `69e7fee`: `cms-server` 93.32 overall (`schema.ts` 100, `guard.ts` 95.45, `run.ts` 91.55, `app.ts` 85.48); `cms-contract` `errors.ts` 100. Every file at or above 80.
  - **Built:** the example origins on `cms.localhost:4400` and `preview.localhost:4401`; a start-up warning when the two origins share a host (`originsShareHost`; a log, not an error); one `Origin` middleware after the Host check, refusing any write whose `Origin` is present and not `origins.cms` with `403 cross-origin` (a new code).
  - **Decisions:** a new code, not `misdirected` (421, the Host check); an exact match on `origins.cms`, so a page on `127.0.0.1` cannot write when `origins.cms` names another host; `editorOrigins` stays. PHASE-2-DESIGN 5.9 describes the refusal.
  - **Implication:** 2.10l and 2.10m rebase on this, and the start condition of the 2.10e umbrella holds. The generated route table (2.13b) must list `cross-origin`.

#### 2.12d First manual run — after 2.11d · `[user]` (was 2.12c-1)

- Against a throwaway GitHub repo with no deploy attached, following the run guide, with `buildCheck: never`.
- One save, one publish, and one conflict made on purpose: push a change to a saved document from another clone, then publish. If 2.10l has merged, also save during a publish. It runs as soon as 2.11d merges and does not wait for 2.10l or 2.10m; the candidate build and the failed-build case are covered in 2.12c.
- Known limits, not to log again: script widgets after the first render (D6), and JSON text areas instead of forms.
- Each note becomes a fix task in wave 13 or an entry in the phase 3 proposal.
- **Done when:** the user confirms the run and the notes are sorted.

### Wave 13

#### 2.10f Upstream that doesn't build — after 2.10e · `[build]`

- Sync builds `cms/work` HEAD after the re-apply. On a failure it builds the `origin/<branch>` tip once, to tell whose failure it is:
  - if the tip fails too, record `upstreamBuildFailed { sha, firstError }` (a type change in `preview/status.ts`, its setter and its tests);
  - if the tip passes, the changeset is at fault, and that is reported instead.
- The last good bundle stays current. Publish validates against it, pushes, and reports `upstreamBuildFailed`.
- **If U1 is yes:** while `upstreamBuildFailed` is set, the build check is skipped and the answer and the status say `buildCheckSkipped: 'upstream-broken'`. The error-text comparison is dropped.
- The optional origin-tip build at start-up moves to phase 4.
- **Done when:** a developer pushes a broken component, and the CMS user still publishes a content edit and is told that the check was skipped and why. `[build]`

#### 2.12b Done-when tests — after 2.10f, 2.11d · `[build]`

- Each row of section 1.1 has a test that runs in `npm run check -- --e2e`; write the missing ones.
- The browser test for R7: Chromium on `cms.localhost` drives an iframe on `preview.localhost` through the token and cookie:
  - the iframe's `fetch` succeeds, and the same preview opened top-level answers `401`;
  - a draft changes the preview;
  - Save, then reload, and the overlay shows the saved content.
- A variant of the whole save and publish path with `siteDir` set (monorepo).
- **Done when:** the table is complete and green.

#### 2.14a Second-site spike — `[build]` (A2)

- Run the whole path on the official Astro blog template, and on a site of the user's own on Astro 7 if one exists. The path: first build, editor, edit, save, publish.
- Do not fix what breaks. Record each failure and its cause:
  - (a) a dependency the workspace lacks;
  - (b) the Astro version;
  - (c) an assumption taken from bigspring;
  - (d) a real bug.
- **Done when:** this plan links a table of failures by cause, each with the smallest fix, and the list of what a site must satisfy today. The scaffolding is thrown away.

#### 2.14e item 4 Same-site cookie spike — `[user]`

- Check whether `cms.avc.localhost` and `preview.avc.localhost` carry a `SameSite=Lax` preview cookie: in Firefox on Windows (Playwright), and in Safari on a real Mac if one is available.
- **Done when:** the result is in SYSTEM-DESIGN section 12 (the phase 4 cookie item), and the browser line of the quick start says it.

#### 2.14f Astro canary and the internals list — `[ci]` (A11)

- A weekly, non-blocking workflow runs the e2e suite on `astro@latest` and on the newest pre-release. A failure opens an issue.
- A section in PREVIEW-RENDER-SERVER.md lists every Astro internal the renderer touches, with the file that touches it.
- **Done when:** the workflow has run once, and the list matches a grep of the imports.

#### 2.14g macOS smoke job — `[ci]` (A12)

- A weekly job on `macos-latest`, shaped like `windows.yml`: the process and git unit tests and the e2e start test.
- **Done when:** the job is green once, or its failures are tasks.

#### 2.14j Site context and actor seam — check first (A10)

- Check that every route gets the site's state through one object, and that one middleware sets an `actor` (today a constant with `git.author`) that saves and publishes take the author from.
- Change the code only if either is missing.
- **Done when:** the check is written in the PR. If code changed, no behaviour changed and the existing tests pass untouched.

### Wave 14 (close)

#### 2.14c `schema.json` v2 for forms — first in the wave · `[build]` (A3)

1. **Dates** export `{ "type": "string", "cms": "date" }`.
2. **Discriminated unions:** each `oneOf` carries `cms: { discriminator }`, and each branch its constant value.
3. **Optional, nullable and default** survive in nested fields and array items, with a test per case.
4. **UI hints** come from the site config (U8) and are copied under `ui`. Every hint is optional.
5. **Versioning:** `bundle.json` gets `schemaVersion: 2`, and `cms-server` treats a bundle without it as a protocol mismatch (one rebuild, then an error).
- **Done when:** the fixture bundle is regenerated; a test walks every field of every editable sample document and finds a known node kind or an explicit `unknown`; `blog.date` exports the marker; changed files meet the floor.
- If the wave runs long, this task moves to the start of phase 3. No phase 2 row depends on it.

#### 2.12c Final acceptance — after 2.12b, 2.14c · `[user]`

- Against a throwaway GitHub repo with no deploy attached, with `buildCheck: auto`: one save and one publish, plus a publish that triggers a build.
- Also, from the 2.10e split (2026-11-18): with `buildCheck: always`, a save during a publish (`409 publish-in-progress`) and a build that fails (`424`, nothing pushed).
- **Done when:** the user confirms it, and anything surprising is a task or a phase 3 entry.

#### 2.13a Measurements — after 2.12b · `[build]`

- Measure publish latency under `never`, `auto` without a trigger, and `always`.
- Measure the re-apply time on the 200-post sample, and the swap time from a finished build to the new node serving.
- Measure the rss after a publish, to complete 2.13e.
- **Done when:** section 8 has values, each with its date and method.

#### 2.13b Documents — after 2.12b

- **`CMS-SERVER.md`:** diagrams, the routes and error tables generated from 2.14d, the git model, the build triggers, the 2.10e state table, and the YAML codec's known limit.
- **A quick start** grown from the run guide. It includes the compatibility list from 2.14a, the browser and OS line from 2.14e and 2.14g, and the decision of U3.
- **Other updates:**
  - PREVIEW-RENDER-SERVER.md: front server, bundle layout including `bundle.json` and `images.json`, removed routes, `editorOrigins` gone;
  - both READMEs;
  - SYSTEM-DESIGN: phase table, section 7, the decisions of U3 to U6;
  - PHASE-2-DESIGN 5.9;
  - the README map, which names this file as the live plan and WORKPLAN-PHASE-2.md as the log.
- **Done when:** a reader can go from `DOCS/README.md` to every phase 2 document, and no document contradicts the code.

#### 2.13c Quality floors — decision U7

- The coverage floors and the Stryker thresholds are decided. Only the per-package question is left.
- **Done when:** U7 is answered, and CI-PIPELINE.md and QUALITY-TOOLING.md say what was decided.

## 7. Phase close checklist

Phase 2 is closed when all of these hold:

1. Every row of section 1.1 is green in `npm run check -- --e2e` (2.12b).
2. The user has confirmed 2.12d and 2.12c.
3. Section 8 has every value.
4. Decisions U1 to U8 are answered and logged in SYSTEM-DESIGN section 11 or 12, or in this file.
5. The housekeeping items H1 to H5 are closed or carried by name into the phase 3 plan.
6. `mutation-full` is green on the closing commit with no file under 80, and the commit is tagged `wave-14-closed` and `phase-2-closed`.
7. The phase 3 design is opened from PHASE-3-DESIGN-PROPOSAL.md, with the phase 3 decisions asked.

## 8. Measurements

| | Value | Date, method |
|---|---|---|
| `cms-server` rss at rest, and after a session of saves (2.13e) | rss 128.0 MB at rest (127.4 to 128.8), 157.1 MB after 50 saves (156.5 to 157.9); private 73.7 MB and 102.4 MB | 2026-11-17, `npm run measure:cms-memory`: sample-site bundle with `--bundle`, a local bare repo, three runs, mean and range. Rss is the working set, private is the OS private working set |
| `cms-server` rss after a publish (2.13a) | | |
| Publish latency: `buildCheck` `never`, `auto` without a trigger, `always` | | |
| Re-apply time, 200-post sample | | |
| Swap time, build done to new node serving | | |

## 9. Moved out of phase 2

| Item | To |
|---|---|
| Reserve `base` in the render envelope (2.14k, A8) | Phase 3, with the protocol bump of step 3.7 |
| Building option B of U3 (the integration installed into the site) | Phase 4 |
| The backup ref for saves (U5, A9) | Phase 4, if U5 is yes |
| Origin-tip build at the first start-up (2.10f optional, from 2.9c-B) | Phase 4 list, SYSTEM-DESIGN section 12 |
| Preview fidelity: priming and script widgets (A4, D6) | Phase 3 step 3.2 |
| Document identity across upstream renames (A18) | Phase 3 backlog |
| Saves accepted during a publish build, re-applied onto the candidate after the push (2.10e design 1) | Phase 4 or 5, with several editors or server drafts. The seam is `sync/publish-gate.ts`; SYSTEM-DESIGN section 4, "Publish and saves" |
| D2's plugin setting, and the restricted MDX renderer | Phase 3 proposal, decision 1 |
