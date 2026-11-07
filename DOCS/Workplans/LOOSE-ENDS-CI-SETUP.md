# Loose ends from CI setup

Temporary tracker. Delete this file when every item is DONE. It is separate from
WORKPLAN-PHASE-2.md on purpose. Source of truth for the rules: DOCS/README.md
section 2 and DOCS/Guidelines/CI-PIPELINE.md. Everything goes through task branches
and pull requests (the user merges). Items run before 2.9c unless noted.

## Decisions (2026-11-07, user)

- **Mutation floors: just in time.** No mass cleanup of files nobody touches. A task
  that changes a file scoring under 80 raises it to 80, or adds a waiver in
  `.mutation-waivers.json`, in its own pull request. Waivers need classified
  survivors (CI-PIPELINE section 3).
- **`cms-server/src/main.ts` and `preview-render-server/src/dev/memory-route.ts` leave
  the `mutate` list.** Both are startup or route glue (16 and 13 lines), like
  `build.ts` and `start.ts`. Approved.
- **Sample site:** `"jsx": "react-jsx"` with `"jsxImportSource": "react"`; the
  `import React` in `PricingPlans.tsx` goes away.
- **Local rules:** "never run the full Vitest suite" stays (CI runs it). "Run Stryker
  only through the script" now applies to local runs only.
- **Deleting the stale branches and worktrees (q6) is approved.**
- **Skipped on purpose:** nightly skip when `main` is unchanged (saves about 36 min a
  night, not worth it).

## Items

| # | Item | State |
| --- | --- | --- |
| q1 | Docs, one PR (below) | open |
| q2 | Sample site JSX setting | open |
| q3 | Mutation floors | open |
| q4 | CI: CodeQL on PRs, e2e artifacts on failure | open |
| q5 | Tag `wave-6-closed` | waiting for the user's OK |
| q6 | Cleanup of branches, worktrees, temp folder | open |

### q1. Docs (one PR)

- CI-PIPELINE section 1: remove "Actions use major-version tags for now" (actions
  are pinned to full SHAs, section 8).
- README section 2: remove the exception "CI setup work is committed to `main`
  directly". All work goes through pull requests. (2.1k to 2.1p are done.)
- README: "Current phase: 2 (... not started)" becomes wave 7, with the next tasks.
- WORKPLAN-PHASE-2.md: add "superseded by CI-PIPELINE.md" above the manual Stryker
  rules (lines about 793 to 815); change the 2.9c checklist item "Stryker after
  merge, through the script" to "the mutation check on the PR is green"; close the
  2.5c item "Not rescored after the two review rounds" with the full run
  `42392688637` as the reference (all eight files scored 92.9 to 100).
- CI-PIPELINE section 8: one line that dependency-update PRs change no source file,
  so the mutation check tests nothing for them; a Vitest or Stryker bump shows up in
  the nightly run.

### q2. Sample site JSX setting

Set `"jsx": "react-jsx"` and `"jsxImportSource": "react"` in
`sample-site/tsconfig.json`, revert the `import React` in
`sample-site/src/layouts/components/PricingPlans.tsx`. *Done when:*
`npm run typecheck -w sample-site` and an `astro build` (temp outDir) both pass, and
CI is green. Reason: the sample site stands in for user sites; the CMS must not need
edits to their components.

### q3. Mutation floors

- Remove `main.ts` and `memory-route.ts` from the `mutate` list (`stryker.config.json`
  and the group configs that list them). Check `stryker-plan.ts` still plans every
  remaining file.
- Raise `cms-server/src/http/app.ts` (54) to 80 or more, before 2.9c adds
  `/api/status` there.
- The other four stay as they are, handled by whichever task touches them:
  `editor/page.ts` 76, `preview-contract/src/schema.ts` 57,
  `preview-render-server/src/bundle.ts` 45, `overlay/errors.ts` 57.
  Scores are from the full run `42392688637`.

### q4. CI extras

- `security.yml`: add `pull_request` to the CodeQL trigger (about 2 minutes).
- `ci.yml` `e2e` job: upload Playwright traces and test output as an artifact when
  the job fails.

### q5. Tag `wave-6-closed`

The full run `42392688637` was green with an overall 94.2, which meets the rule for
closing a wave (CI-PIPELINE section 4). Tag the commit that run covered and push the
tag. **Not done: needs the user's OK.**

### q6. Cleanup (approved)

Before deleting, check each item for commits that are not on `main` and report any.

- Local branches: `phase-2-wave-4`, `phase-2-wave-5`, `phase-2-wave-6`,
  `quality/mutation-followups`, `docs/handoff-and-design-updates`.
  (`parked/per-island-save` stays: it is parked work, not on the list.)
- Worktrees: `.claude/worktrees/agent-a305fe770ce11d6d0` and
  `agent-af0c0db567bc63f15`, and their `worktree-agent-*` branches.
- Remote branches of merged PRs: the old `dependabot/*` branches and
  `task/2.1o-pr-block-check`.
- `%TEMP%\avc-stryker` (the Stryker export folder) and the stale
  `preview-render-server/.build/sample-site`.

## Order

q1, q2, q3 and q4 are independent task branches. q5 waits for the user's OK. q6 last,
or any time. 2.9c starts after q3's `app.ts` item is merged.
