# Quality tooling plan

Written 2026-10-28. Goal: keep the codebase reliable as it grows toward the
multi-tenant shape in [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md). Each step is small,
lands on its own, and leaves the typecheck and the targeted tests green.

| # | Step | Tool | When | Status |
|---|---|---|---|---|
| 1 | Stricter TypeScript flags | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | now | done |
| 2 | Lint and format | Biome | now | done |
| 3 | Boundary validation | Zod from `astro/zod` (already a dependency) | after 2 | todo |
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
  hand-written 400 checks in `render-route.ts` and friends), site config, and
  later `PUT /api/changes`.
- Keep the error messages naming the failing field, as the contract requires.
- Not in the bridge or `preview-protocol`: the bridge ships in every previewed
  page (D14), so its size counts.

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
