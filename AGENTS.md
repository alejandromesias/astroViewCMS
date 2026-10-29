# AGENTS.md

Guidance for AI agents and human reviewers working in this repo. `claude.md` has the working rules (token saving, strict types, targeted tests, LF endings). This file says **what to review** and **what to skip**.

## What this repo is

A Tina-style in-memory preview renderer for Astro sites. Two first-party packages (`preview-render-server`, `preview-protocol`), plus two sample Astro sites used only as test inputs. See `DOCS/SYSTEM-DESIGN.md` and `DOCS/PREVIEW-RENDER-SERVER.md`.

## Review these

Our own code, in rough priority order.

| Path | Why it is worth reviewing |
| --- | --- |
| `preview-render-server/src/` | The product. Integration, render/overlay/schema/manifest logic, routes, request guard, media route. |
| `preview-render-server/src/client/` | Browser-side bridge and patching code that runs inside the preview iframe. Bugs here are visible to editors. |
| `preview-protocol/src/` | The wire contract between editor and renderer. Changes ripple to both sides. |
| `preview-render-server/test-editor/` | The test editor page that drives the bridge. Review only when the bridge or protocol changes. |
| `preview-render-server/test/e2e/` | End-to-end and budget tests. Review for flaky or weakened assertions. |
| `preview-render-server/sites/*.config.ts` | Per-site configuration for the sample sites. Small, but it defines what the e2e suite exercises. |
| `scripts/check.ts` | The single quality-check runner (`npm run check`). |
| `.githooks/` | Pre-commit hook. |

Config that sets the quality bar (review when it changes, since a loosened rule silently weakens every other review):
`biome.json`, `knip.json`, `.dependency-cruiser.cjs`, `stryker.config.json`, `preview-render-server/vitest.config.ts` (coverage floors), `osv-scanner.toml`, `tsconfig*.json`, `package.json` files.

Docs worth a read when behaviour changes: `DOCS/*.md` (`SYSTEM-DESIGN.md`, `PREVIEW-RENDER-SERVER.md`, `QUALITY-TOOLING.md`). Check the doc and the code still agree.

### Test files

Unit tests sit beside their source as `*.test.ts`. Review them with the code they cover, not as a separate pass. Look for tests that cannot fail (no assertion, mock that returns the expected value). The mutation score floor (`stryker.config.json`) and coverage floors guard this, so a drop there is a review finding.

## Ignore these

### Third-party and vendored

- `node_modules/` (root and every workspace)
- `sample-site/`: an upstream Astro theme (has its own LICENSE and README). Only its use as a test input matters, not its code.
- `sampleAstroProject/`: a stock Astro starter, same treatment. It has its own `AGENTS.md` and `CLAUDE.md` for that sample; they do not apply to this repo.

### Generated or build output

- `**/dist/`, `**/.build/`, `**/.vitest/`
- `preview-render-server/coverage/`
- `reports/` (Stryker HTML report and `stryker-incremental.json`)
- `.stryker-tmp/`
- `package-lock.json`: review only for unexpected dependency additions, never line by line.

### Fixtures and test data

- `preview-render-server/test/fixtures/`: deliberately odd inputs (broken, minimal, or unusual Astro components). Style and lint rules do not apply; Biome and knip already exclude them.
- Snapshot or recorded outputs, if any appear.

### Notes, not code

- `HANDOFF.md`, `DOCS/Handoffs/`: session handoff notes.
- `DOCS/MUTATION-WEAK-SPOTS.md`, `DOCS/MODULE-GRAPH.md`, `DOCS/VISUAL-CHECKS-ON-SAMPLE-SITE.md`, `DOCS/QUALITY-TOOLING-PLAN.md`: working notes and generated analysis. Skim only if the review touches their subject.

### Excluded from coverage and mutation on purpose

Glue files with top-level side effects, covered by the e2e suite rather than unit tests. Missing unit coverage here is expected, not a finding:
`src/build.ts`, `src/start.ts`, `src/types.ts`, `src/render-route.ts`, `src/validate-route.ts`, `src/warmup-route.ts`, `src/dev/documents-route.ts`, `src/render/runtime.ts`, `src/overlay/content-shim.ts`, `src/overlay/markdown-instance.ts`, `src/schema/stubs-flavor1.ts`. They still deserve a normal read for correctness when changed; the exclusion list lives in `preview-render-server/vitest.config.ts` and `stryker.config.json` and must stay in sync.

## Review conventions

- Strict TypeScript. Flag `any` outside tests.
- Every file is LF. A diff that rewrites a whole file usually means CRLF crept in.
- Do not flag style that Biome already enforces; run `npm run check` instead.
- Run targeted tests only. Never run the full Vitest suite.
- Never commit without being asked.
- `npm run check` (fast), `-- --e2e`, `-- --mutation`, `-- --all`: see `DOCS/QUALITY-TOOLING.md`.
