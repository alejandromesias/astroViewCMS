# CI pipeline

How the checks run on GitHub Actions, which ones block a merge, and how to read
and extend them. The tools themselves are described in
[QUALITY-TOOLING.md](QUALITY-TOOLING.md). Built in WORKPLAN-PHASE-2.md, tasks
2.1k (stage 1) and 2.1l (mutation testing). Hardening that is not built yet is
in section 8.

## 1. Workflows and jobs

| Workflow | Trigger | Job | What it runs | Limit |
| --- | --- | --- | --- | --- |
| `ci.yml` | push to `main`, pull request, by hand | `fast` | `npm run check -- --fast`: tsc (4 packages), Biome, unit tests with coverage floors, Knip, dependency-cruiser, osv-scanner | 25 min |
| | | `e2e` (needs `fast`) | cms-server end-to-end, preview end-to-end and budgets, browser suite (Chromium) | 40 min |
| | | `mutation-diff` (needs `fast`) | Stryker on the source files the branch changed, then the judgement (section 3) | 240 min |
| `mutation-full.yml` | nightly 03:17 UTC, by hand | `shard` x6 | Stryker on every file of one group each | 330 min each |
| | | `merge` | judges the whole run, keeps the per-file baseline | 15 min |
| `windows.yml` | weekly, Monday 05:23 UTC, by hand | `unit` | `npm run coverage` on `windows-latest` (not a gate) | 40 min |
| `nightly.yml` | nightly 02:37 UTC, by hand | `measure` | memory of one preview process and the listing-route tripwire, printed to artifacts (not a gate, `continue-on-error`) | 45 min |
| `security.yml` | push to `main`, weekly, by hand | `codeql`, `osv-sarif` | CodeQL for JavaScript and TypeScript; osv-scanner results as SARIF in the Security tab (reports, not gates) | 30 min, 10 min |

- Every workflow has `permissions: contents: read`, uses no secret and runs on
  `pull_request`, never `pull_request_target`. The repo is public.
- A pull-request run cancels the one it supersedes. Runs on `main` are not
  cancelled.
- A tool that is missing on CI **fails** the step: with `CI` set, `check.ts`
  turns "skipped" into "failed". The four symlink tests also fail instead of
  skipping, so nothing that is skipped locally is skipped in CI.
- Node comes from `.node-version`. Actions use major-version tags for now.

## 2. What blocks a merge

| Check | Blocks? |
| --- | --- |
| `fast` | yes |
| `mutation-diff` | yes (section 3) |
| `e2e` | yes (since 2026-11-07; the job no longer has `continue-on-error`) |
| `mutation-full` | no. It runs after the merge, and a wave is closed only when it is green (section 4) |

The repository ruleset "main protection" (set 2026-11-07) requires a pull request
for `main`, merge commits only, no force push and no deletion, and the three
checks above. Repository admins can bypass it ("always"), so direct pushes by
the admin still land; other contributors need a green pull request. A red
guarded push by the admin is not stopped by the ruleset: CI shows it.

The local pre-commit hook (`.githooks/pre-commit`, about 7 seconds) is the fast tier
in front of CI: two typechecks, `lint`, `format:check` and `depcruise`, all of which
`fast` runs again. CI is the gate; the hook only saves a red run. Enable it per
clone with `git config core.hooksPath .githooks`, and keep that setting: the
Stryker tripwire (`.githooks/reference-transaction`) needs it too.

## 3. Mutation testing on a branch

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
   | `cms-server` | `cms-server/src/` | `stryker.cms-server.config.mjs` |

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
2. **Every pushed branch, in CI:** `mutation-diff`. The task is done when the
   survivors of its changed files are killed or classified, and the job is green.
3. **Every wave, in CI:** `mutation-full` is green (overall 75 or more), the
   files under 80 are listed in its summary, and the wave is tagged
   `wave-<n>-closed`.

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
  `mutation-baseline` holds the per-file scores of the last full run.
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

A new Stryker group needs a rule in `scripts/lib/stryker-plan.ts`, a
`stryker.<group>.config.mjs`, a `vitest.mutation.<group>.config.ts` and a line
in the `matrix` of `mutation-full.yml`.

## 7. Troubleshooting

- **Fails on Linux, passes on Windows:** path separators, case-sensitive paths,
  file modes (the mode-600 test), `.bin` shims. Fix the code or the test; do not
  add a skip. A real limit is written down with its cause.
- **A budget test failed once:** re-run the job once. A second failure is real.
- **"skipped" turned into a failure:** a tool is missing on the runner. Install
  it in the workflow (osv-scanner is installed at a pinned version, checksum
  checked).
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
