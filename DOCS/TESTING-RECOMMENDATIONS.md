# Testing recommendations

Rules for writing tests in this repo. They come from raising the Stryker mutation score from 77% to about 91%. The details and the original cases are in `DOCS/MUTATION-WEAK-SPOTS.md`, and the tools are described in `DOCS/QUALITY-TOOLING.md`.

A good test fails when the code changes. Line coverage only shows that the code ran. The mutation score shows whether the tests would notice a change.

## 1. Fixtures and setup

- Build fixtures inside the `it` or in `beforeEach`, never at `describe` level or module level. Stryker measures coverage per test, so code that runs outside a test is not linked to any test, and its mutants are reported as surviving or uncovered.
- Prefer small per-case helpers (`shapeOne(...)`, `makeSite(...)`) to one large shared fixture. A shared fixture hides gaps because every test passes for the same reason.
- Give each test its own temp folder and output folder.
- To test a changed-flag or "only this differs" branch, use a fixture where that one thing is the only difference.

## 2. Assert exact values

- Use `toBe` and `toEqual` with the full expected value: error `name` and `message`, response body, status, headers, log arguments.
- `toContain`, `toMatch(/x/)` and `toBeTruthy()` let many mutants pass. Use them only when the exact value really does not matter.
- `not.toThrow(/x/)` can pass for the wrong reason (another error was thrown). Assert what *does* happen.
- For character-scanning loops, assert the whole output string.
- To check how something was written (an attribute instead of a property), spy on the method, for example `setAttribute`.

## 3. Make the behaviour observable

Many surviving mutants were in code whose effect the test could not see.

- **Guards with the same result on both paths.** Use a fake that returns a real value, then assert it was *not* called.
- **Path traversal guards.** Create real files where the traversal would land, so a broken guard would serve them.
- **"Must be skipped" logic.** Give the skipped thing content that would show up in the output if it were read.
- **Stale-answer counters.** Use three steps: start request A, invalidate it, start B, then let A answer. Check that A's answer is dropped.
- **Timing.** Fake `performance.now` with two `mockReturnValueOnce` calls, and use numbers whose rounding shows in the result.

## 4. Inputs: near misses and whole tables

- Regexes and matchers: add near-miss negatives (one character off, the wrong extension, a missing anchor). More positive cases do not kill regex mutants.
- Lookup tables and alias maps: use `it.each` over the whole table, not one sample row.
- Limits: test every value from 0 to the limit, and one past it.
- User keys: include `__proto__`, `constructor` and `toString` as inputs wherever a key comes from content or config. See `DOCS/IMPLEMENTATION-RECOMMENDATIONS.md` §1.
- Hand-kept lists: test them with real data (for example, every JS reserved word).

## 5. Dependencies, stubs and fakes

- When tests inject a dependency (`readSource`, `fetch`), add at least one test that uses the real default.
- Stub browser APIs that happy-dom lacks (`getAnimations`) on the prototype, and restore the original property descriptor afterwards.
- Mock `console` when a test checks logging, and restore it in `afterEach`.
- Plugin and integration hooks are plain functions. Call them directly, for example `hook.call({ resolve: vi.fn() }, ...)`, and pass `vi.fn()` helpers for hook tables such as `astro:config:setup`.
- If a file lists entrypoints by path, check that each path exists on disk.
- Vitest quirk: a `vi.fn` that rejects or throws can fail the test even when the code catches the error. Workaround: in the `vi.mock` factory, use a plain function that reads a mutable state object.

## 6. Every source file gets its own test file

A file can score well only through other files' tests and still have no direct test. `media.ts` and `keys.ts` were like this. When you add `foo.ts`, add `foo.test.ts` next to it.

## 7. Running Stryker on new work

- Make sure the file's tests pass first: `npx vitest run <file>`.
- Run Stryker incrementally on the files you changed: `npx stryker run --mutate "src/a.ts,src/b.ts"` (comma-separated). The table also shows cached files, so read only your rows.
- The result that counts is the Stryker re-run, not the green test run.
- Read the surviving mutants from `reports/stryker-incremental.json`.
- Mutants in module-level constants ("static" mutants) often survive under the Vitest runner, because modules are not reloaded for each mutant. Check them by hand and treat them as noise.
- Floors: coverage is 96% for lines, functions and statements and 94% for branches. Stryker breaks below 85%.

## 8. Agent and shell notes

- Do not run the full Vitest suite or `npm run check` in agent sessions. Run only the test files for the feature you changed.
- `node -e` and heredocs mangle `\n` and backslashes. Use the Edit or Write tools to change test files, and use absolute paths.

## Checklist for a new test file

- [ ] Fixtures are built per test, not at `describe` level.
- [ ] Assertions use exact values.
- [ ] Each guard has a test where breaking it would change the outcome.
- [ ] Regexes have near-miss negatives, and tables are covered with `it.each`.
- [ ] Prototype keys are tried wherever user keys are accepted.
- [ ] At least one test uses the real default of each injected dependency.
- [ ] Stryker was re-run on the changed files, and the survivors were read.
