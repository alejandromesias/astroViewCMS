# Quality tooling plan

Written 2026-10-28. Goal: keep the codebase reliable as it grows toward the
multi-tenant shape in [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md). Each step is small,
lands on its own, and leaves the typecheck and the targeted tests green.

| # | Step | Tool | When | Status |
|---|---|---|---|---|
| 1 | Stricter TypeScript flags | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | now | done |
| 2 | Lint and format | Biome | now | done |
| 3 | Boundary validation | Zod from `astro/zod` (already a dependency) | after 2 | done |
| 4 | Architecture map | Skott (graph, cycles) | after 3 | todo |
| 5 | Vulnerable dependencies | osv-scanner (+ Renovate or Dependabot) | after 2 | todo |
| 6 | Dead code | Knip, run on demand | after 4 | todo |
| 7 | Budget tests | bridge size, render time and memory | after 2 | todo |
| 8 | CI | one `check` script run on every push | after 2 and 5 | todo |
| 9 | Architecture rules | dependency-cruiser | once CI exists | deferred |

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

## 5. osv-scanner

- Scan `package-lock.json`. Keep an ignore file where every entry has a reason
  and an expiry date.
- Add Renovate or Dependabot so fixes arrive, with `astro`, `sharp` and
  `rolldown` grouped.

## 6. Knip

- Entry points: `src/build.ts`, `src/start.ts`, `sites/*.config.ts`, the virtual
  modules. Run on demand and read the output; do not gate on it until the
  false positives are tuned out.
- Same pass: go through the 43 production `noNonNullAssertion` warnings left
  from steps 2 and 3. Replace each with a check or a narrower type, or keep it
  with a `biome-ignore` that says why the value exists.

## 7. Budget tests

- **Bridge size:** a test that bundles the client and fails above a byte
  budget (set from today's size plus a margin).
- **Render time and memory:** in the style of `media-route.measure.test.ts`.
  They protect the capacity estimate in section 6 of the design (about 80 MB
  per preview node, about 1 ms per render). Loose thresholds, so they flag
  regressions and not noise.

## 8. CI

- A root `check` script: typecheck, lint, targeted unit tests, osv-scanner.
  A workflow runs it on every push. This is the precondition for step 9.

## 9. dependency-cruiser (deferred)

Added once CI exists, with the rules the design implies:

- `client/**` must not import `node:*` or server modules.
- `preview-protocol` must not import from the server.
- The preview node is read-only (decision 4): no write or git helpers in the
  render, overlay and request paths.
- No cycles, and no production code importing test fixtures.
