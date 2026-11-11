# CI pipeline

How the checks run on GitHub Actions, which ones block a merge, and how to read
and extend them. The tools themselves are described in
[QUALITY-TOOLING.md](QUALITY-TOOLING.md). Built in WORKPLAN-PHASE-2.md, tasks
2.1k (stage 1), 2.1l (mutation testing) and 2.1s (fewer and shorter waits).
Hardening that is not built yet is in section 8; a proposal that is not built is
in section 9.

## 1. Workflows and jobs

| Workflow | Trigger | Job | What it runs | Limit |
| --- | --- | --- | --- | --- |
| `ci.yml` | push to `main`, pull request, by hand | `fast` | `npm run check -- --fast`: tsc (5 packages, the sample site included), Biome, unit tests with coverage floors, Knip, dependency-cruiser, osv-scanner | 25 min |
| | | `e2e` | cms-server end-to-end, preview end-to-end and budgets, browser suite (Chromium) | 40 min |
| | | `mutation-diff` | Stryker on the source files the branch changed, then the judgement (section 3) | 240 min |
| `mutation-full.yml` | nightly 03:17 UTC, by hand | `gate` | nightly only: skips the run when nothing outside `DOCS/` changed since the last green run (section 4) | 10 min |
| | | `shard` x11 (needs `gate`) | Stryker on every file of one group each; `cms-server` is five groups by folder plus the rest (section 3) | 120 min each |
| | | `merge` | judges the whole run, keeps the per-file baseline | 15 min |
| `mutation-branch.yml` | by hand only (`workflow_dispatch`, inputs `ref` and `base`) | `mutation` | Stryker on the files one pushed branch changed against `base` (default `main`), then the judgement of `mutation-diff`. No pull request needed | 240 min |
| `windows.yml` | weekly, Monday 05:23 UTC, by hand | `unit` | `npm run coverage` on `windows-latest` (not a gate) | 40 min |
| `nightly.yml` | nightly 02:37 UTC, by hand | `measure` | memory of one preview process and the listing-route tripwire, printed to artifacts (not a gate, `continue-on-error`) | 45 min |
| `security.yml` | push to `main`, weekly, by hand | `codeql`, `osv-sarif` | CodeQL for JavaScript and TypeScript; osv-scanner results as SARIF in the Security tab (reports, not gates) | 30 min, 10 min |

- **The three jobs of `ci.yml` run side by side** (since 2026-11-11, 2.1s): `e2e` and
  `mutation-diff` do not wait for `fast`, so a push is green after the slowest of the three,
  not after `fast` plus the slowest. If `fast` fails, the other two still run (about 1 push in 20,
  roughly 4 free runner minutes); read the `fast` log first. They are not cancelled from a
  step of `fast`: that needs `actions: write`, does nothing on a fork pull request, and can turn
  the `fast` check into "cancelled" and hide the failure. Revisit if the repository becomes
  private (billed minutes) or `fast` fails on more than 1 push in 5.
- Every workflow has `permissions: contents: read`, uses no secret and runs on
  `pull_request`, never `pull_request_target`. The repo is public.
- A pull-request run cancels the one it supersedes. Runs on `main` are not
  cancelled.
- A tool that is missing on CI **fails** the step: with `CI` set, `check.ts`
  turns "skipped" into "failed". The four symlink tests also fail instead of
  skipping, so nothing that is skipped locally is skipped in CI.
- Node comes from `.node-version`. Actions are pinned to full commit SHAs (section 8).

## 2. What blocks a merge

| Check | Blocks? |
| --- | --- |
| `fast` | yes |
| `mutation-diff` | yes (section 3) |
| `e2e` | yes (since 2026-11-07; the job no longer has `continue-on-error`) |
| `mutation-full` | no. It runs after the merge, and a wave is closed only when it is green (section 4) |
| `mutation-branch` | no. It runs by hand on a pushed branch, for a check before its pull request exists |

The repository ruleset "main protection" (set 2026-11-07) requires a pull request
for `main`, merge commits only, no force push and no deletion, and the three
checks above. Repository admins can bypass it ("always"), so direct pushes by
the admin still land; other contributors need a green pull request. Direct pushes
are the policy for changes under `DOCS/` only (README section 2); the `pre-push` hook
refuses any other file. A red
guarded push by the admin is not stopped by the ruleset: CI shows it.

The local pre-commit hook (`.githooks/pre-commit`, about 7 seconds) is the fast tier
in front of CI: two typechecks, `lint`, `format:check` and `depcruise`, all of which
`fast` runs again. CI is the gate; the hook only saves a red run. Enable it per
clone with `git config core.hooksPath .githooks`, and keep that setting: the
Stryker tripwire (`.githooks/reference-transaction`) needs it too.

## 3. Mutation testing on a branch

By hand, for a pushed branch with no pull request yet: run the `mutation-branch`
workflow (section 1) with `ref` (the branch) and `base` (a branch name on origin,
default `main`). It runs the steps below, with the changed set taken from
`origin/<base>`.

`node scripts/stryker-changed.ts --run` (the `mutation-diff` job, and
`npm run check -- --mutation` locally):

1. **Changed set.** The `src` files changed from the merge base with
   `origin/main` to `HEAD`. A changed `foo.test.ts` counts as a change to
   `foo.ts`. Files outside the `mutate` list of `stryker.config.json` (tests,
   `.d.ts`, glue such as `build.ts`) are dropped.
2. **Groups.** Each file belongs to one group, which has its own Stryker config
   and Vitest config, so only the tests that cover it run
   (`scripts/lib/stryker-plan.ts`):

   | Group | Files | Config |
   | --- | --- | --- |
   | `serve` | `preview-render-server/src/serve/`, `preview-config.ts` | `stryker.serve.config.mjs` |
   | `preview` | `preview-render-server/src/manifest/` | `stryker.preview.config.mjs` |
   | `renderer` | the rest of `preview-render-server/src/` | `stryker.renderer.config.mjs` |
   | `protocol` | `preview-protocol/src/` | `stryker.protocol.config.mjs` |
   | `contract` | `preview-contract/src/` | `stryker.contract.config.mjs` |
   | `cms-preview` | `cms-server/src/preview/` | `stryker.cms-preview.config.mjs` |
   | `cms-save` | `cms-server/src/save/` | `stryker.cms-save.config.mjs` |
   | `cms-documents` | `cms-server/src/documents/` | `stryker.cms-documents.config.mjs` |
   | `cms-git` | `cms-server/src/git/` | `stryker.cms-git.config.mjs` |
   | `cms-codecs` | `cms-server/src/codecs/`, `cms-server/src/schema/` | `stryker.cms-codecs.config.mjs` |
   | `cms-server` | the rest of `cms-server/src/` (`http/`, `config/`, `bundle/`, the top-level files, and any new folder) | `stryker.cms-server.config.mjs` |

   The `cms-server` package is split by folder (2.1s), because the single `cms-server` group had grown
   from 30 to 60 minutes in three days and set the length of the whole nightly run. The
   six `cms-*` groups share the Vitest config `vitest.mutation.cms-server.config.ts`. A file counts for
   the first group whose prefix matches, so a new folder under `cms-server/src/` falls into
   `cms-server` until a rule moves it. The time of each group is in the job summary (section 5).

3. **Run.** Each group goes through `scripts/stryker-run.mjs` (a copy of `HEAD`
   with no git repository above it; see QUALITY-TOOLING.md). Stryker itself
   never fails on a score; the judgement does.
4. **Judgement** (`scripts/stryker-summary.ts`). The score of a file is
   killed + timeout over killed + timeout + survived + no coverage. The job
   fails when:
   - the changed set scores **under 75** overall; or
   - a changed file scores **under 80**, unless `.mutation-waivers.json` lowers
     that file's floor; or
   - a group has no report, or its report mutated nothing (the run broke).

   A changed file with no valid mutant is listed as "no mutants" and does not
   fail. With no changed `src` file the job passes with an empty table. On
   `main` the changed set is always empty.

**Waivers.** `.mutation-waivers.json` is an array of
`{ "file", "floor", "reason", "task" }`. `floor` is under 80 (it lowers one
file's floor, never the overall 75). `reason` and `task` must name the
WORKPLAN task that classified the survivors, for example equivalent mutants.
Add an entry only when a real run needs one, and review it like code.

## 4. Mutation testing in three levels

1. **Every change, locally:** write the tests the way TESTING-RECOMMENDATIONS.md
   says. No Stryker run is needed to finish a task.
2. **Every pull request, in CI:** `mutation-diff`, or by hand for a branch with no pull request yet: `mutation-branch`. The task is done when the
   survivors of its changed files are killed or classified, and the job is green.
3. **Every wave, in CI:** `mutation-full` is green (overall 75 or more), the
   files under 80 are listed in its summary, and the wave is tagged
   `wave-<n>-closed`. Do not wait for the nightly: when the last pull request of
   the wave is merged, start the run by hand,
   `gh workflow run mutation-full.yml`, and read it with `gh run list --workflow mutation-full.yml`.
   A run by hand always runs; the nightly may be skipped (below). The run takes
   about as long as the slowest group, which is the time to plan for.

**The nightly run skips quiet nights.** The `gate` job of `mutation-full.yml` compares
`main` with the commit of the last green `mutation-full` run. When nothing outside
`DOCS/` differs, the shards and the merge job are skipped and the run's summary
says so. A skipped night counts as a green run in the run list; the trend step of
the merge job looks through the last 30 runs and keeps the 10 newest that have a baseline.

### How often to push a pull request branch

Each push to a pull request branch starts `fast`, `e2e` and `mutation-diff` again, about
4 to 9 minutes of waiting and of runner time each (measured 2026-11-11: 6 to 9 pushes
per pull request was usual). The rules, in force from 2026-11-11:

1. **Check before you push.** Run the targeted tests of the files you changed
   (`npx vitest run <file>`), and let the pre-commit hook run. Do not use CI to find out
   whether a test passes.
2. **Commit as often as you like; push when the task is reviewable.** The first push
   opens the pull request. After that, push only to fix a red check, to answer a
   review comment, or when the task itself changed.
3. **Batch the fixes.** If two checks are red, or the review has several comments, fix
   them all and push once. Read the whole failure first (`gh run view <id> --log-failed`),
   not one assertion at a time.
4. **Do not poll while a run is going.** Work on something else, or hand back, and read
   `gh pr checks <number>` when the run is expected to be done. Wait for the result
   only after the last push of the task. A newer push cancels the run before it
   (`cancel-in-progress`), so a quick second push wastes the first run, not more.
5. **Target: 2 or 3 pushes per pull request.** A pull request with more than 4 is a sign that
   tests were not run locally; say so in the hand-back.

**When a local Stryker run is allowed:** a tight loop on one file that you
expect to take under 10 minutes, or while CI is down or out of minutes. Never
a full run, and never `npx stryker run`: always
`node scripts/stryker-run.mjs <config> --mutate <files>` from the repo root,
on a clean tree.

## 5. Reading the results

- **The job summary** (the run's page on GitHub) has one table: a row per
  changed file with its score, killed / valid, floor and status
  (`pass`, `FAIL`, `under 80`, `no mutants`, `(waived)`), the overall score and
  the list of failures.
- **Artifacts:** `coverage` (from `fast`, 14 days); `mutation-diff` (14 days):
  `plan.json`, `summary.json` and, per group, the JSON report and `run.json`;
  `mutation-<group>` and `mutation-baseline` (90 days) from `mutation-full`.
  `mutation-branch` (14 days): the same files as `mutation-diff`, from a run by hand.
  `mutation-baseline` holds the per-file scores of the last full run.
- **Time per group:** the `mutation-diff` job and each `mutation-full` shard end their job
  summary with a table of the Stryker time per group, slowest first, and write the same
  numbers to `timing.json` beside each group's report (in the artifacts). Use it to
  rebalance the groups: a group over 20 minutes in the nightly run is split by folder
  (section 6).
- **Survivors** are in the job log, in the Stryker clear-text output of the
  group: the original and changed code and the tests that ran.
- **Locally,** after `node scripts/stryker-changed.ts --run`, the same files
  are in `reports/mutation-diff/`. Without `--run` the script only prints the
  plan. `--base <ref>` changes the comparison point (default `origin/main`;
  run `git fetch origin main` first). `--all --group <name> --run` is one
  shard of the nightly run.

## 6. Adding a gate

1. Put the logic in a script under `scripts/`, with unit tests in the
   `scripts` Vitest project (pure rules in `scripts/lib/`).
2. Add a step to the `fast` set in `scripts/check.ts` if it is quick, or a step
   or job in `ci.yml` if it is not. Make it fail on CI when its tool is
   missing.
3. Add a row to the overview table of QUALITY-TOOLING.md, with its config and
   where it runs.
4. If the job should block merges, add it to the ruleset (2.1o) and to the
   table in section 2.

A new Stryker group needs a rule in `scripts/lib/stryker-plan.ts` (before the
rule whose prefix contains its folder), a `stryker.<group>.config.mjs`, a Vitest
config (a new `vitest.mutation.<group>.config.ts`, or the one of the package, as the
`cms-*` groups share `vitest.mutation.cms-server.config.ts`) and a line in the
`matrix` of `mutation-full.yml`. `stryker-plan.test.ts` fails when a group has no
config file.

## 7. Troubleshooting

- **Fails on Linux, passes on Windows:** path separators, case-sensitive paths,
  file modes (the mode-600 test), `.bin` shims. Fix the code or the test; do not
  add a skip. A real limit is written down with its cause.
- **A budget test failed once:** re-run the job once. A second failure is real.
- **"skipped" turned into a failure:** a tool is missing on the runner. Install
  it in the workflow (osv-scanner is installed at a pinned version, checksum
  checked).
- **`mutation-branch` says `origin/<base>` not found:** `base` must be a branch
  name on origin (default `main`). Check the spelling, and that the branch is pushed.
- **`mutation-diff` says "no report for group" or "mutated nothing":** the
  Stryker run broke. Read the group's log lines before the table.
- **A group's score looks too low after a dry run failure:** the Stryker sandbox
  does not contain `sample-site`; tests that need it use fixtures under
  `cms-server/test/fixtures`.
- **`e2e` fails the build of `sample-site`:** `npm run build` refuses a
  non-empty `.build/sample-site` with no `bundle.json`. See QUALITY-TOOLING.md.

## 8. Hardening and extras

- **Repository (2.1o).** Done in the repo: every action pinned to a full commit SHA
  with its version in a comment; `actionlint` as a step of `fast`; CodeQL and the
  osv-scanner SARIF in `security.yml`; Dependabot for npm and github-actions
  (`.github/dependabot.yml`, weekly, minor and patch grouped). The ruleset
  `main protection` is active, with admin bypass (section 2), and a red pull request
  was seen to be `BLOCKED` (PR #9, closed). Done in GitHub settings by the user:
  fork pull-request approval, Dependabot alerts, private vulnerability reporting.
- **Trends (2.1p).** `mutation-full` ends with a trend table of the last 10
  successful whole-repo runs, read from their `mutation-baseline` artifacts (not a
  gate; `scripts/trend.ts`). The nightly measurements are text, not JSON: the
  numbers are read by hand until a few nights show which ones matter.
- **Stryker cache (2.1p decision, 2026-11-07).** No cache. Every Stryker run keeps
  `--force`, so each score is fresh. A cached baseline can go stale: a stale one once
  made a run take 9 minutes and reuse only 281 of 2684 mutants (QUALITY-TOOLING,
  2026-10-31). The cache is reconsidered only when the trend shows the incremental
  and forced scores within 0.5 points on two runs, and this section is updated then.
- **Windows.** Weekly unit run on `windows-latest`. Not a required check; the run
  page is the signal.
- **Dependency updates.** A Dependabot pull request changes no source file, so
  `mutation-diff` tests nothing for it. A Vitest or Stryker bump shows up only in the
  nightly `mutation-full` run.

## 9. Proposal, not built: `mutation-diff` as parallel jobs per group

Today `mutation-diff` is one job that runs the groups of the changed files one after
another (`runGroups` in `scripts/stryker-changed.ts`). That is fine while a diff run
takes 2 to 7 minutes (measured 2026-11-11). It becomes the longest wait when a branch changes
several groups, or a large file of `cms-git`, `cms-save` or `cms-preview`. The docs record about
40 minutes for one large file.

**Build it when** a `mutation-diff` job takes over 15 minutes on a pull request (read the time
table of section 5).

**Design.**
1. A `plan` job runs `node scripts/stryker-changed.ts` (no `--run`) and outputs the group names
   of the changed files as JSON; it uploads `plan.json`.
2. A `mutate` job with `strategy.matrix.group` from that output runs
   `node scripts/stryker-changed.ts --group <name> --run` on the files of the plan for that
   group, and uploads `reports/mutation-diff/<group>`. This needs a new option, `--only-group`,
   because `--group` today requires `--all`.
3. A `verdict` job (the required check, still named `mutation on changed files`) downloads the
   plan and the reports and runs `node scripts/stryker-summary.ts`, which already judges a
   finished run.
4. With no changed source file the matrix is empty and `verdict` passes at once. A skipped
   matrix job must not count as a pass for a group that has files: `verdict` fails when a
   planned group has no report, as it does today.

**Cost.** A change to the plan, two new options in `stryker-changed.ts` and a test for each, three
jobs in `ci.yml` and a change to the ruleset only if the check name changes (keep the name).
**Gain.** A diff run takes as long as its slowest group, not the sum of all of them.
