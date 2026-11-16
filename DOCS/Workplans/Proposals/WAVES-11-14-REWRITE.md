# Waves 11 to 14, rewritten (proposal)

Written 2026-11-15, with wave 10 closed and `main` at `7dd6bff`. Status: **proposal, not approved.** If accepted, the wave table and the entries of 2.10e, 2.10f, 2.11c, 2.11d, 2.12c, 2.13a and 2.13c in WORKPLAN-PHASE-2.md are edited to match; until then that plan stands.

Background: [SYSTEM-DESIGN-AUDIT.md](../../Designs/SYSTEM-DESIGN-AUDIT.md) findings A1, A5, A14 and A16. The pre-phase 3 tasks (step 2.14) are in [WORKPLAN-PRE-PHASE-3.md](WORKPLAN-PRE-PHASE-3.md).

## 1. What changes and why

The content of the tail is right. Four things about its shape are worth changing.

| # | Change | Why |
|---|---|---|
| 1 | **Split 2.10e** into 2.10e-A (the `auto` triggers, a pure function) and 2.10e-B (the snapshot flow) | The entry holds a trigger rule, a four-step flow with three race cases, and eight "done when" clauses. That is more than one session and more than one review. The triggers have no dependency on the flow |
| 2 | **2.10e-B starts with a state table** of publish, sync and build, and ends with a test that drives event orders against it | The unlocked build window is the riskiest code left in the phase, and it protects the anti-goal "a CMS user loses saved work". Today the rules are prose in four task entries (A5) |
| 3 | **2.11c and 2.11d put their logic in framework-free modules** | Phase 3 replaces the test editor. The API calls and the answer-to-message mapping are what phase 3 keeps; the DOM glue is what it discards (A14) |
| 4 | **The manual run moves forward**: a first one right after 2.11d, with `buildCheck: never` | It is the only time a person uses the product, and it sits in the last wave, when nothing is left to absorb a surprise (A1). The publish path it needs was merged in wave 10 |

Two smaller ones:

| # | Change | Why |
|---|---|---|
| 5 | **Slim 2.10f**: drop the "same file and message" comparison `[user]` | See section 3. It is a **(call)** in the design, not a user decision, and it is the fragile part |
| 6 | **2.13a splits**: `cms-server` memory is measured in wave 11; **2.13d** brings the three files under 80 to the floor | Memory needs only a running server, and phase 3's choices (what the server bundles and serves) lean on the number. The three files have been carried since wave 6 (A16) |

Nothing is removed from the phase's "done when". Row R6 is unchanged; the second clause of 2.10f's own "done when" changes if change 5 is accepted.

## 2. The rewritten waves

| Wave | Tasks | Notes |
|---|---|---|
| 11 | **2.10e-A**, **2.11c** (with 2.14d), **2.12a** `[build]`, **2.13a-1**, **2.13d** | 2.10e-A, 2.13a-1 and 2.13d touch no shared file. 2.11c and 2.12a both remove or change editor code: 2.12a deletes `preview-render-server/test-editor/`, 2.11c edits `cms-server/editor/`, so they do not collide |
| 12 | **2.10e-B** `[build]`, **2.11d**; then **2.12c-1** `[user]` | 2.11d does not wait for 2.10e-B: it handles `409 publish-in-progress` and `409 remote-moved` from the contract (2.14d), as today's entry already plans. 2.12c-1 runs as soon as 2.11d merges |
| 13 | **2.10f** `[build]`, **2.12b** `[build]`, and from step 2.14: **2.14a** `[build]`, **2.14c** `[build]`, **2.14e** | Four `[build]` tasks, so one at a time: 2.10f, 2.12b, 2.14a, 2.14c. 2.14e runs beside them |
| 14 | **2.12c-2** `[user]`, **2.13a-2**, **2.13b** (with 2.14h), **2.13c**, and the rest of step 2.14 | 2.13c is now only the per-package floor question; the thresholds were decided on 2026-11-03 |

Ids with a suffix (`2.10e-A`, `2.13a-1`) are not accepted by `npm run worktree -- new`; make those worktrees as 2.9c-A and 2.9c-B were made (`git worktree add`, then `npm run worktree -- link <dir>`).

Critical path: 2.10e-A → 2.10e-B → 2.10f → 2.12b → 2.13. One task longer in count than today, the same in work, since 2.10e was already two tasks in one entry.

```text
 wave 11   2.10e-A ─────────┐        2.11c (+2.14d) ──┐      2.12a   2.13a-1   2.13d
 wave 12   2.10e-B [build] ◀┘        2.11d ◀──────────┘ ──▶ 2.12c-1 [user]
 wave 13   2.10f ──▶ 2.12b            2.14a ──▶ 2.14c            2.14e
 wave 14   2.12c-2 [user]   2.13a-2   2.13b (+2.14h)   2.13c
```

## 3. The changed task entries

Only what differs from WORKPLAN-PHASE-2.md is written here. Everything else in each entry stays.

### 2.10e-A The `auto` triggers — after 2.10d · wave 11

- A pure function: given the changeset, the validate answer and what sync reported, it returns whether to build and the reason (`mdx-body`, `build-time-field`, `refinement-threw`, `upstream-code`, `unknown`). `unknown` counts as "build", as settled on 2026-11-13.
- The validate answer exposes the keys that hit `refinement-threw` (a contract change in `preview-contract`).
- `publish.buildCheck` is read and passed through; `always` and `never` skip the function.
- No lock, no worktree and no git in this task.
- **Done when:** unit tests for each reason and for each combination that must not build; the function is the only place that decides.

### 2.10e-B The snapshot flow — after 2.10e-A · wave 12 · `[build]`

The flow is the one the user settled on 2026-11-13 (WORKPLAN-PHASE-2, 2.10e). Two deliverables are added, one before the code and one after.

- **First, the state table.** One table in the task entry (later in `CMS-SERVER.md`): the states of a site (`idle`, `syncing`, `validating`, `squashing`, `building`, `pushing`, `reconciling`, `failed`), the events (save, poll tick, publish click, build passed, build failed, push accepted, push rejected, remote moved with content, remote moved with code), and for each pair what happens and which answer goes out. The invariants are stated next to it:
  1. a save that answered `200` is in `cms/work` or in a pushed commit, never in neither;
  2. the commit pushed is the commit that was built;
  3. the bundle that serves is never ahead of what was pushed;
  4. at most one publish runs;
  5. no document is published twice as a change.
- **Then the code,** as specified.
- **Last, an event-order test.** With git, the build and the clock injected (as the unit tests already do), run a few hundred random orders of the events against the real functions and check the five invariants after each step. It replaces none of the named cases in "done when"; it looks for the orders nobody named.
- **Done when:** as in the current 2.10e entry, plus the table is in the plan and the event-order test is green.

### 2.10f Upstream that doesn't build — after 2.10e-B · wave 13 · `[build]`

Kept: sync builds `cms/work` HEAD after the re-apply; on a failure it builds the `origin/<branch>` tip once to tell whose failure it is; `upstreamBuildFailed { sha, firstError }`; publish validates against the last good bundle, pushes, and reports it.

**Proposed change `[user]`:** drop "the candidate's failure only blocks the push when its error is not the one upstream already has (same file and message)".

- That rule compares build errors as text. A changed line number, a different error order or a path printed differently makes the same failure look new, and a different failure in the same file look old.
- The simpler rule: **while `upstreamBuildFailed` is set, the build check cannot vouch for anything, so it is skipped and the publish says so** (`buildCheckSkipped: 'upstream-broken'` in the answer and the status). This follows the user's decision that a developer's broken code does not hold the CMS change back.
- What is given up: under `always`, a changeset that adds a second break on top of a broken upstream is pushed. The host is already not deploying, and the next green upstream build runs the check again.
- "Done when" then reads: the developer pushes a broken component; the CMS user still publishes a content edit and is told that the check was skipped and why.

The optional origin-tip build at first start-up (from 2.9c-B) moves to the phase 4 list in SYSTEM-DESIGN section 12; nothing in the MVP needs it.

### 2.11c Save and the changeset list — after 2.11b, 2.5c · wave 11 · with 2.14d

Same behaviour. The structure changes:

```text
 cms-server/editor/
 ├─ api.ts        one function per route; parses answers with the cms-contract schemas
 ├─ messages.ts   maps each answer and error code to { level, text, field? }
 ├─ media.ts      swaps staging URLs for saved paths after a save (2.7b review)
 └─ editor.ts     the DOM glue of the test editor: calls the three above
```

- `api.ts`, `messages.ts` and `media.ts` import no DOM type and take `fetch` as a parameter. They carry the unit tests of "done when" and the mutation gate.
- `editor.ts` keeps its existing tests and gets one test per new button that checks the wiring, not each answer again.
- Phase 3's editor imports the three modules as they are.
- **Done when:** as today, with the per-answer tests on `messages.ts` and `api.ts`.

### 2.11d Publish — after 2.11c, 2.10d · wave 12

Same behaviour, same structure as 2.11c: the publish call goes in `api.ts`, its answers in `messages.ts`, and the status polling in a small `status.ts` (start, stop, on change), also DOM-free. If change 5 is accepted, `buildCheckSkipped` gets a message.

### 2.12c Manual acceptance — two runs · `[user]`

- **2.12c-1, after 2.11d (wave 12):** against a throwaway GitHub repo with no deploy attached, with `buildCheck: never`. One save, one publish, and one conflict made on purpose (push a change to a saved document from another clone, then publish). The user notes anything confusing, slow or wrong. Each note becomes a task or an entry in the phase 3 proposal.
- **2.12c-2, after 2.12b (wave 14):** the run of today's entry, with `buildCheck: auto`.
- **Done when:** the user confirms each run.

### 2.13a Measurements — two parts

- **2.13a-1 (wave 11):** `cms-server` rss at rest and after a session of saves, with a script next to `measure:memory`. Needs nothing from waves 11 to 13.
- **2.13a-2 (wave 14):** publish latency under the three `buildCheck` modes, re-apply time on the 200-post sample, swap time. As today.

### 2.13d The three files under 80 — wave 11

`preview-contract/src/schema.ts` (57.14), `preview-render-server/src/bundle.ts` (45.00) and `preview-render-server/src/overlay/errors.ts` (57.14): kill or classify their survivors. If 2.14c is accepted it changes `schema.ts` and would have to do this anyway.

- **Done when:** the next `mutation-full` lists no file under 80.

## 4. What stays exactly as planned

- 2.12a (remove the stopgaps) and 2.12b (done-when tests, the browser test for R7, the `siteDir` variant).
- 2.13b (documents), with two additions from the audit: a quick start for `cms-server`, and the split of 2.14h.
- The wave rule: a wave closes on a green `mutation-full` and a tag.
- Every user decision of 2026-11-13 about 2.10e.

## 5. If only part of this is accepted

The changes are independent. In order of value for the cost:

1. Change 4 (the early manual run): no code, and it is the first real use of the product.
2. Change 2 (the state table and the event-order test): the best protection for the riskiest task.
3. Change 3 (logic modules in 2.11c and 2.11d): it turns two throwaway tasks into phase 3's first two.
4. Change 1 (the split of 2.10e): mostly a sizing matter.
5. Changes 5 and 6.
