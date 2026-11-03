# Mutation testing: weakest files

Stryker run over `preview-render-server/src` (2,623 mutants, overall score 77.55%).
These are the 12 files that scored below 75%, ordered from **least bad** (top) to **worst** (bottom).

- **Score** = killed + timeout, over killed + timeout + survived + no coverage. Errored mutants are not counted.
- **Survivors** = survived + no-coverage mutants (a test run did not catch them, or no test reached the code).
- Stryker does not record which test "should have" caught a survivor, so the hot spots are listed per **function** (the useful unit when refactoring). Line numbers refer to the file's source at the time of the run.
- A second run of these 12 files reproduced the scores, except `schema/config-bundle.ts` (69.75% → 68.07%), which hints at a flaky or order-dependent test there.
- Survivors on bare constants (regexes, string lists such as `RESERVED`) are often equivalent or low value. Check them last.

| # | File | Score | Survivors | Errors |
|---|------|------:|----------:|-------:|
| 1 | `manifest/routes.ts` | 74.00% | 13 | 1 |
| 2 | `client/patch.ts` | 73.99% | 45 | 0 |
| 3 | `overlay/content-api.ts` | 72.57% | 62 | 0 |
| 4 | `overlay/media.ts` | 72.22% | 5 | 0 |
| 5 | `overlay/plugins.ts` | 70.42% | 63 | 0 |
| 6 | `schema/config-bundle.ts` | 69.75% | 36 | 0 |
| 7 | `languages.ts` | 69.57% | 28 | 0 |
| 8 | `overlay/image-service.ts` | 69.44% | 11 | 0 |
| 9 | `integration.ts` | 68.56% | 61 | 12 |
| 10 | `manifest/import-scan.ts` | 68.29% | 91 | 0 |
| 11 | `overlay/dates.ts` | 60.78% | 20 | 0 |
| 12 | `overlay/errors.ts` | 57.14% | 3 | 0 |

## Functions to look at, per file

Counts are survivors in that function; "no cov" means no test reaches it at all.

### 1. `manifest/routes.ts` (74.00%)
- `routeType` (line 44): 7, condition and string mutations
- `STATIC_PATHS` (line 15): 3, regex
- `readIfExists` (lines 47-48): 2, **no cov**
- `shapeRoutes` (line 37): 1
- Error: 1 mutant (`ObjectLiteral`, line 30) crashes test setup.

### 2. `client/patch.ts` (73.99%)
- `createPatcher` (lines 34-105): 18, 5 no cov
- `syncIslandAttributes` (lines 120-129): 14, 3 no cov
- `patchHead` (lines 157-173): 6, boolean and logic mutations
- `metaKey` (lines 145-149): 5, 2 no cov
- `bodyOutsideRegions` (line 138) and `KEEP` (line 13): 1 each

### 3. `overlay/content-api.ts` (72.57%)
- `createContentApi` (lines 56-230): 60, 8 no cov. It is one huge function, mostly optional-chaining (16), condition (12) and string (11) mutants. Splitting it up would make the gaps easier to see.
- `DRAFT` (line 17) and `BODY_EXTENSIONS` (line 50): 1 each

### 4. `overlay/media.ts` (72.22%)
- `isMediaMetadata` (line 23): 4, condition and logic mutations
- `MEDIA_TAG` (line 7): 1

### 5. `overlay/plugins.ts` (70.42%)
- `dataModules` (lines 84-97): 10
- `dataModuleSource` (lines 109-113): 7, conditions and logic
- `normalize` (line 125): 3
- `CONTENT_CONFIG` (line 10) and `IMPORT_PATTERNS` (lines 13-14): 3 regex each
- `RESERVED` (line 122): 35 survivors, all string literals. Probably an untested name list; check whether the list itself is worth testing.

### 6. `schema/config-bundle.ts` (69.75%)
- `schemaStubs` (lines 46-67): 30, mostly conditions (10) and logic (7)
- `CODE_FILE` (line 27): 3 regex
- `loadCmsCollections` (lines 81-88): 2
- `normalize` (line 100): 1
- Flaky: see the note above.

### 7. `languages.ts` (69.57%)
- Module-level string constants (lines 10-29): 16
- `walkFences` (lines 55-65): 4, boundary and arithmetic mutations
- `CLOSING` (line 48): 4 regex; `OPENING` (line 47): 1
- `PLAIN` (line 33): 3

### 8. `overlay/image-service.ts` (69.44%)
- `previewImageService` (lines 31-43): 10
- `wrapService` (line 20): 1

### 9. `integration.ts` (68.56%)
- `previewRenderServer` (lines 42-128): 32, 9 no cov, mostly string (16) and object-literal (5) mutants
- `siteModule` (lines 241-265): 9, 1 no cov
- `findAstroConfig` (lines 271-272): 9
- `regionWrappers` (lines 213-214): 3
- `IMAGE_EXTENSIONS` (line 19): 3; `devRoutes` (line 152): 1
- Errors: 12 mutants break setup code (file system, glob and route handling) and are reported as runtime errors, so they are not scored.

### 10. `manifest/import-scan.ts` (68.29%)
- `importSpecifiers` (lines 84-92): 15, mostly regex (6)
- `stripJsonComments` (lines 146-154): 13, condition and equality mutations
- `scanProject` (lines 26-49): 9
- `readAliases` (lines 120-133): 8, 3 no cov
- `resolveSpecifier` (lines 167-174): 8, 4 no cov
- `CODE_EXTENSIONS` (line 10): 8 string literals

### 11. `overlay/dates.ts` (60.78%)
- `reviveDates` (lines 22-27): 11, conditions, logic and optional chaining
- `ISO_DATE` (line 8): 9 regex mutants. Only the happy path is tested, so try malformed or near-miss dates.

### 12. `overlay/errors.ts` (57.14%)
- `DraftError` (lines 14-15): 3 string mutants (name and message). Assert the error's `name` and `message` text.

## How to re-run

```
npx stryker run                                    # incremental, whole project
npx stryker run --mutate "preview-render-server/src/overlay/dates.ts"   # one file
```

The HTML report is at `reports/mutation/mutation.html`; the cached results are in `reports/stryker-incremental.json`.

## Improvement log

### 1. `manifest/routes.ts`: 74.00% → 98.04%

Result: 38 killed, 12 timeout, 1 survived, 0 no coverage, 0 errors (was 13 survivors and 1 error). `routes.test.ts` went from 8 to 33 tests, all passing. Implementation unchanged: the weakness was in the tests, not in the code.

What was added:
- **Route types:** a table test for `page`, `endpoint`, `redirect` and `fallback`, plus an unknown type falling back to `page`. Before, only `endpoint` and `page` were asserted, so the `routeType` condition mutants survived.
- **`getStaticPaths` regex:** positive cases (`function`, `async function`, `const`, `let`, extra whitespace after a newline) and near-miss negatives (no `export`, `getStaticPathsLater`, `myexport`, `export var`, `asyncfunction`, empty source). This kills the `\b`, `\s+`, optional-group and alternation mutants.
- **Default `readIfExists`:** a test with a real temp folder (existing and missing page). Before, every test injected `readSource`, so the default reader had no coverage at all.
- **Entrypoints:** an absolute path and a `file://` URL, each checked against the resulting `component`.
- **Filter and rest params:** `/_astro` and `/a/__b` are kept (only the `/__` prefix is dropped); several rest params in one pattern; malformed `[..a]`, `[.a]`, `[...]` are not rest params.
- **Sorting:** three routes given in reverse order, not just the already-sorted fixture.

Remaining survivor (equivalent): line 48, `'utf8'` → `""`. `readFileSync` then returns a Buffer, and `RegExp.test` stringifies it, so the result is identical. Not worth a test.

Learnings and gotchas:
- A shared module-level fixture (one `shapeRoutes` call, many `it`s) hides gaps. A small `shapeOne(type, source, entrypoint, pattern)` helper made each edge case a one-liner.
- Injecting a dependency (`readSource`) makes tests easy but leaves the default implementation untested. Always add at least one test that uses the real default.
- Regex mutants die from **near-miss negatives**, not from more positives.
- `--mutate` on the CLI still prints the whole project's table because incremental mode reports cached files too. Read only the row for your file. The survivors for one file can be listed from `reports/stryker-incremental.json` (`files[...].mutants` where status is not Killed/Timeout); `reports/mutation/mutation.json` does not exist with the current reporters.
- Writing test source through a shell `node -e` string mangles `\n` escapes (it produced a literal newline inside a string). Use the Edit tool for test files.

### 2. `client/patch.ts`: 73.99% → 94.22%

Result: 163 killed, 7 survived, 3 no coverage, 0 errors (was 45 survivors). `patch.test.ts` went from 15 to 39 tests, all passing. Implementation unchanged: again the gaps were in the tests.

What was added:
- **Animations** (`finishAnimations`, ~10 mutants): `Element.prototype.getAnimations` is stubbed (and restored in `afterEach`) so the tests can assert that a morphed region and a morphed body are finished with `{ subtree: true }`, that nothing is finished when nothing morphed, and that a browser without `getAnimations` does not throw.
- **Island attributes** (`syncIslandAttributes`, 14 mutants): changed, added and removed plain attributes; only differing attributes are written (spying on `setAttribute`); `ssr` and `props` are never copied or removed as plain attributes; `props` removal puts `ssr` back first; neither side has `props` means no write; non-island elements are morphed normally.
- **Meta keys** (`metaKey`, `patchHead`): `http-equiv`, `property` and `charset` metas; `name=x` vs `property=x` do not collide; metas without an identifying attribute are ignored on both sides; a head change is reported when *only* the title, *only* a new meta, or *only* a meta attribute changed (this kills the `changed = true` mutants one by one); duplicate live meta keys update only the first.
- **Scripts and body**: an external script the live page lacks is neither run nor reported; two identical new scripts in one render run once; an `src` script next to an inline one does not confuse the comparison; a style or link only in the render is not a "change outside the regions"; a text-only change outside the regions morphs the body; the live style, link and script survive a body morph while other nodes are removed (`KEEP`).
- **Duplicate regions**: when the live page repeats a region name, only the first is morphed by the region step.

Remaining survivors, all equivalent or not worth a test:
- Lines 34, 68, 105: `?? ''` fallbacks on `textContent`. It is never `null` for an element, so the fallback cannot be reached.
- Line 138: the `'script, style, link'` selector text in `bodyOutsideRegions`. The scripts and links are also dropped by the morph callbacks, so this selector only matters in rare combinations.
- Lines 40 and 80: `ConditionalExpression → true` on the island check and the `!live.has(name)` guard. idiomorph only calls `beforeNodeMorphed` for same-tag nodes, so the second half of the `&&` is redundant, and a duplicate region name overwriting the first leaves no visible difference in happy-dom.
- Line 169: `importNode(meta, true)` deep flag. A `<meta>` has no children.
- Line 13 (`'STYLE'` in `KEEP`) survived the Stryker run even though replacing it by hand makes the new "keeps live styles" test fail. Unexplained; possibly a static-mutant coverage quirk. Worth a look if the score matters.

Learnings and gotchas:
- Browser APIs that happy-dom lacks (`getAnimations`) can be stubbed on `Element.prototype` with `Object.defineProperty`, as long as you restore the original descriptor afterwards.
- To assert *how* something was written (only differing attributes, `ssr` before `props`), wrap the element's own `setAttribute` and record calls. Asserting the end state alone leaves the "skip if unchanged" mutants alive.
- Changed-flag mutants (`changed = true` → `false`) need tests where *that one thing* is the only change; combined fixtures hide them.
- Heredocs containing a large TypeScript file broke the shell tool (`unexpected EOF`). Write the addition with the Write tool to a temp file, append it, delete the temp file.
- The shell stays in the last directory between calls, so a repeated `cd relative/path` silently fails; use absolute paths.

### 3. `overlay/content-api.ts`: 72.57% → 94.25%

Result: 209 killed, 4 timeout, 13 survived (was 62 survivors). `content-api.test.ts` has 83 tests in total with `media.test.ts` (new). Implementation unchanged.

Added: the file a new draft is written to (`holdingFile`: glob extensions, `{a , b}` lists, no extension, no base, `file()` loader, unknown collection, backslash paths, no collections at all), the entry shape (`digest`, `body` defaults), schema issue paths (array indexes, symbols), pass-through for calls with no usable reference, full `render()` results for empty drafts, and exact `validate` messages.

Remaining survivors:
- Equivalent: `?? ''` fallbacks (97, 113), the `touched` fallback and `!context` guards in `getCollection` (165, 164), the `parsingFile` reset (56, 144), the `finally` block (143).
- Loop bound in the date-revival retry (124, 3 mutants): killing it needs a schema that keeps failing after every revive round. Not attempted.
- Line 187: `ref.id === undefined` forced false only changes the read log (`authors/undefined`), which no test asserts.
- Lines 17 and 50: see the static-mutant gotcha below.

### 4. `overlay/media.ts`: 72.22% → 94.44%

Result: 17 killed, 1 survived (was 5 survivors). The file had **no test file** of its own (it was only exercised through `content-api.test.ts`); `media.test.ts` is new. Implementation unchanged.

Added: the exact shape from `mediaMetadata`, and `isMediaMetadata` for null, primitives, untagged objects, `false` and `'true'` tags, and a tagged function.
The survivor is `Symbol.for('…')` → `Symbol.for('')` on line 7 (static, see below).

Learnings and gotchas:
- **Static (module-level) mutants survive in this setup.** `Symbol.for('x')`→`Symbol.for('')` survived in `media.ts` and `content-api.ts`, and `'STYLE'` in `KEEP` survived in `patch.ts`, although a manual edit makes the matching test fail. The modules are probably not reloaded per mutant by the vitest runner, so mutants in code that runs only at import time can't be killed. Treat them as noise, or verify them by hand.
- A file with a high-looking score from indirect tests can have no direct tests at all. Check for a `*.test.ts` next to it first.
- A very large function is not a problem for mutation testing when the factory accepts fakes: one fake `real` that returns marker objects (`{ passthrough: args }`) shows whether a call was handed through or handled.
- Tests written from the survivor list passed on the first run for both files. The signal is in the Stryker re-run, not in the test run.
- `--mutate` takes a comma-separated list; two `--mutate` flags left the output looking like nothing had run. The score table rows are easier to read from `reports/stryker-incremental.json` (count `files[...].mutants` by status).

### 5. `overlay/plugins.ts`: 70.42% → 80.00%, and a real bug fixed

Result: 177 killed, 3 timeout, 45 survived (was 63 survivors). 36 of the 45 are the `RESERVED` word list (see below), so the score understates the work. `plugins.test.ts` went from 25 to 120 tests (the word list is a table test).

**Implementation bug found and fixed.** `RESERVED` lacked 11 words that are invalid as module-level `export const` names: `implements`, `interface`, `package`, `private`, `protected`, `public`, `static`, `eval`, `arguments`, `debugger`, `instanceof`, `extends` (12 counting `extends`). A data JSON file with a key like `"public"` or `"static"` made `dataModuleSource` emit `export const public = …`, a syntax error that broke the whole data module and with it the preview. They are added to the list, and a test imports a generated module containing every reserved key to prove it parses. I found them by importing `export const <word> = 1` for a list of candidate words in node.

Added: regex tests for spacing and quoting in `rewriteContentImports`, the content-config name (`^`, `$`, `tsx`), `contentImportRewrite` details (return shape, shim path in any spelling, warning text), `dataModuleSource` for valid/invalid names, null and primitive files, and `dataModules` guard clauses (what must not reach `this.resolve`, options passed on).

Remaining survivors:
- `RESERVED` (36) and `name`/`enforce` (84): see "static" below. A test does fail when I empty a word by hand.
- Equivalent: `'utf8'` (97), the `startsWith('\0')` guard (86, a later check already returns), the `!Array.isArray` check (109, array indexes are never valid names).
- The `CONTENT_CONFIG` and `IMPORT_PATTERNS` regexes (10, 13, 14): `[cm]?` can never matter because only `.ts` and `.js` reach the check (the extension filter runs first). The `import` pattern mutants `\S*` and `\s*` swaps need a space between `import` and `(` that no real code has. `CONTENT_CONFIG` could be simplified to `/^content\.config\.[jt]s$/`.

### 6. `schema/config-bundle.ts`: 69.75% → 95.80%

Result: 104 killed, 10 timeout, 5 survived (was 36). `config-bundle.test.ts` went from 7 to 58 tests. Implementation unchanged. Before, `schemaStubs` was only tested through the flavor 1 end-to-end bundle; flavor 2 (the `?query` path inside the Astro build) had no test.

Added: direct tests of the plugin hooks with a fake `this.resolve`: `transform` with and without a query, each code extension, what must be left alone (node_modules, virtual ids, the stub itself), and `resolveId` for `astro/zod`, for the query-carrying local imports (external, node_modules, non-code and unresolved results), and for `findContentConfig` file names and priority.

Remaining: `CODE_FILE` `$`-anchor variants (27; hit only by a combined path) and two equivalent options (`tsconfig.json` name, `logLevel`).

The flakiness noted at the top (69.75% → 68.07%) did not show up here; the new tests are all synchronous or use temp folders.

Learnings and gotchas:
- **Anything built at `describe` level is invisible to Stryker's per-test coverage.** `const plugin = dataModules(...)` at the top of a `describe` ran during collection, so its mutants (the `name`, `enforce`) were counted as covered by no test and survived, even with a direct assertion. Create the object inside the `it` (or a `beforeEach`).
- Module-level constants (`RESERVED`, the regexes) are static mutants and survive for the same reason as in #3/#4. A long list of word literals can inflate the survivor count; check the function-level survivors first.
- Mutation survivors are a cheap way to find *missing cases in a list*: probing the survivors of `RESERVED` led to a real syntax-error bug.
- Plugin hooks are plain functions: call them with `.call({ resolve: vi.fn() }, …)` and assert on what they asked the fake to resolve. No Vite or rolldown run is needed.

**Recommendation (not done yet):** the `RESERVED` bug was found by chance, so other places may have the same kind of problem: a hand-kept list or lookup that does not cover the whole input space. Worth a targeted sweep of other hand-written word lists, tables indexed by a user-controlled key (see the `Object.prototype` bug in #7), and generated code that interpolates user-controlled names.

### 7. `languages.ts`: 69.57% → 72.53%, and a real bug fixed

Result: 66 of 91 mutants killed or timed out (was 28 survivors, now 25). `languages.test.ts` went from 9 to 55 tests. The score barely moves because 24 of the 25 survivors are module-level constants (see below), not missing tests.

**Implementation bug found and fixed.** `canonicalLanguage` looked the name up with `ALIASES[lower] ?? lower`. `ALIASES` is a plain object, so a fence like ` ```constructor ` or ` ```__proto__ ` found the inherited `Object.prototype` member and returned a function or object instead of a string. That value then went into the set of languages and into the `onLimited` report. It now uses `Object.hasOwn(ALIASES, lower)`, and a test fails with the old code. Only lower-case names matter, because the input is lower-cased first (`toString` becomes `tostring`).

Added: a table over every alias, the plain-text words, near-miss tests for the opening and closing fence regexes (indent, marker count and kind, trailing text, tabs, CRLF), and exact-output tests of what `restrictLanguages` rewrites.

Remaining survivors:
- The 19 string literals of `ALIASES` and `PLAIN` and the 5 regex variants of `OPENING`/`CLOSING`: static mutants. By hand, dropping the `$` of `CLOSING` makes the "does not close" test fail.
- Equivalent: `i <= lines.length` (line 55); the extra iteration reads `undefined`, which never matches.

Learnings and gotchas:
- **A plain object used as a lookup table needs `Object.hasOwn` (or a `Map`).** Try `constructor` and `__proto__` as keys whenever a user-controlled string indexes an object.
- When most survivors are module-level constants, the Stryker score understates the tests. Edit one by hand to check before writing more tests.
- A table test (`it.each`) over a whole alias map is the cheap way to pin it: one case per entry plus the upper-case form.

### 8. `overlay/image-service.ts`: 69.44% → 94.44%

Result: 34 of 36 killed (was 11 survivors). `image-service.test.ts` went from 5 to 18 tests. Implementation unchanged.

Added: the plugin is built inside each test (the `describe`-level gotcha of #6), `resolveId` and `load` are checked for their exact arguments and results (`skipSelf`, the prefix, path escaping), and `wrapService` is checked with missing options.

Remaining: both survivors are the client-environment check (line 33). The old test passed because `resolve` returned nothing either way. A test whose `resolve` finds the file, run in the `client` environment, should kill them. I added it after the Stryker run and did not re-run.

Learnings and gotchas:
- A guard whose skipped branch ends in the same result (here `undefined`) is only visible when the fake behind it returns something. Make the fake return a real value and assert it was not called.
- Backslashes written through a shell heredoc can lose a level (a Windows path in a test string lost its separators). Check such lines after writing them.

### 9. `integration.ts`: 68.56% → 90.72%

Result: 176 killed, 18 survived (was about 60 survivors); 12 more mutants break setup code and are reported as runtime errors, so they are not scored. `integration.test.ts` went from 22 to 59 tests. Implementation unchanged.

Added: the setup hook is run end to end with fake `injectRoute`/`injectScript`/`updateConfig` (route list, order and `prerender`, with and without `PREVIEW_DEV`; every route entry point is checked to exist on disk), plus the real `scan-site` and `schema-site` fixtures for the scan and the schema plugin; exact output of `siteModule` for every config combination; `findAstroConfig` priority; `findImages` per extension; `regionWrappers` options and spelling of ids.

Remaining survivors:
- Static strings at the top (`IMAGE_EXTENSIONS`, lines 17-19) and the route patterns and file names inside the setup hook (lines 42-43, 96-109, 243): the same static-mutant problem as before, or file names that a test only reads indirectly (`content-config.flavor1.mjs`).
- Line 122: `loaderKinds` for a collection without a loader, which needs a content config with a loader-less collection.

Learnings and gotchas:
- A hook table can be tested without Astro: call `hooks['astro:config:setup']` with `vi.fn()` for the three helpers, then call the hooks of the plugins it passed to `updateConfig`. That also proves the wiring (which files the data-module plugin was given), which unit tests of the plugin alone cannot.
- Checking that each `entrypoint` URL points at an existing file turns a string mutation of the path into a failing test for free.
- Use one fresh output folder per test (`outputs()`); otherwise one test's manifests satisfy another's assertions.

### 10. `manifest/import-scan.ts`: 68.29% → 86.92%, and a real bug fixed

Result: 279 killed or timed out, 42 survived (was about 55 survivors). `import-scan.test.ts` went from 11 to 76 tests, most of them on temp sites built per test (`makeSite`).

**Implementation bug found and fixed.** `stripJsonComments` removed trailing commas with a regex over the whole text after comments were gone, so a comma inside a string that precedes `}` or `]` was removed too (`"x,}"` became `"x}"`). That could damage a tsconfig `paths` or `include` value. Trailing commas are now dropped in a second pass that skips strings (`dropTrailingCommas`).

Added: tables for the comment and comma cases with exact output; `readAliases` with missing or broken files, `baseUrl`, exact and wildcard patterns; `resolveSpecifier` with exact aliases, multiple targets, extensions and index files, files outside the site and in `node_modules`; `scanProject` for each code extension and each config name, import cycles, `@plugin`/`@config` in nested stylesheets, and what must not be scanned.

Remaining survivors:
- 20 string literals of the extension lists (lines 10-12): static.
- Equivalent: `<=` in the string-scanning loops (reading one character past the end gives `undefined`), `inside` for paths that are absolute on another drive, the sort of the alias list when two prefixes have the same length.

Learnings and gotchas:
- Building a small site in a temp folder per test is clearer and cheaper than growing one shared fixture, and each test then shows its own input.
- Tests written for survivors found a bug here again: asking "what if the thing being cleaned is inside a string" is a good question for every text-cleaning function.
- Table tests with the exact expected output (`toBe`, not `JSON.parse`) kill the off-by-one mutants in character-scanning loops.

### 11. `overlay/dates.ts`: 60.78% → 78.43%

Result: 40 killed, 11 survived (was 20). `dates.test.ts` went from 4 to 47 tests. Implementation unchanged.

Added: a table of valid ISO forms (date only, `T` and space, fraction, `Z`, `+02:00`, `+0200`) and of near-misses (short parts, extra characters, leading and trailing space or newline, bad offsets, impossible dates), and the rules for which issues are acted on (code, expected type, empty path, missing or non-object parents, several issues at once, the copy is a copy).

Remaining survivors:
- 9 variants of the `ISO_DATE` regex: a module-level constant, so a static mutant. By hand, each of these variants makes a test fail.
- Two equivalent mutants: the `path.length === 0` check (an empty path reads `copy[undefined]`, which is never a string) and the `typeof current === 'string'` check (the regex rejects anything else after conversion to a string).

### 12. `overlay/errors.ts`: 57.14% → 100%

Result: 7 of 7 killed (was 3 survivors). New file `errors.test.ts` with 5 tests: name, `instanceof`, key, the same issues array, and the exact message with dotted paths (`blocks.2.title`), a separator between issues, a single issue, no issues and an empty path.

Learnings and gotchas:
- A small class like this needs exact-string assertions on `name` and `message`; "is an Error" does not kill string mutants.
- An assertion on `error.stack` is not worth it: the stack header is built before `this.name` is set, so it says nothing about the name.
- Near-miss tables for a regex (one extra character, one missing character, whitespace at either end) were again the quickest way to kill regex mutants, except for module-level constants.

## Second pass: files still below 85%

Full incremental Stryker run after the work above: overall score **88.01%** (2,334 killed or timed out, 318 survivors; was 77.55%). Ten files are still below 85%. This is a quick triage from the survivor lines (mutator, source line and replacement, read from `reports/stryker-incremental.json`), using what the log above taught: module-level constants and word lists are static mutants and mostly noise, `?? ''`/`'utf8'` fallbacks are equivalent, and real gaps are conditions, boundaries and unexercised error paths.

| File | Score | Survivors | Verdict |
|------|------:|----------:|---------|
| `media-route.ts` | 76.77% | 25 | **Look into** |
| `render/handlers.ts` | 79.52% | 22 | **Look into** |
| `dev/documents.ts` | 84.00% | 20 | **Look into** (medium) |
| `overlay/keys.ts` | 83.33% | 3 | Quick win |
| `manifest/languages.ts` | 80.95% | 4 | Quick win |
| `render/head.ts` | 84.51% | 12 | Optional |
| `request-guard.ts` | 82.61% | 4 | Optional, low value |
| `languages.ts` | 72.53% | 25 | Skip: already analysed, static constants |
| `overlay/plugins.ts` | 80.00% | 45 | Skip: 35 are `RESERVED`, rest equivalent |
| `overlay/dates.ts` | 78.43% | 11 | Skip: 9 static regex, 2 equivalent |

### Worth looking into

**`media-route.ts` (76.77%)**: the upload endpoint, with real validation and security-relevant logic, and the weakest of the group.
- `FILE_NAME` anchors (line 28) and the `!FILE_NAME.test(file)` guard (73): the `^`/`$` mutants and the guard forced to `false` survive, so no test sends a traversal-style or near-miss file name (`../x.png`, 15 or 17 hex digits, `.svg`). This is the path-traversal guard, so it matters most.
- Size limit (48): `>` vs `>=` on `MAX_BYTES`. Test exactly `MAX_BYTES` and `MAX_BYTES + 1`, and an empty body.
- Dimension check (100): the `!width || !height || !format` mutants survive; test a decoder result missing each of the three, and the `catch` (102) on undecodable bytes.
- Content type (39, 43): `/^image\//` unanchored, the `split(';')` and `trim()` mutants; test `image/png; charset=x`, ` image/png`, `text/image/png`.
- Response bodies and statuses (38, 45, 49, 55, 85, 90): empty-string mutants. Assert body text, as in `errors.ts`.
- Line 16 (`prerender = false` → `true`) is a static export: probably noise. `Cache-Control` on line 80: assert the header.

**`render/handlers.ts` (79.52%)**: five no-coverage mutants, all of them the validation failure path.
- Lines 112-114: no test makes `deps.validate` throw. Add one and assert the 500 status, the body text and the logged error.
- Line 37: the loop that walks `error.cause` up to 5 levels. Test a chain of 5 and 6 causes (kills `<=`, `depth--` and the condition).
- Line 51 (`catch` on a bad JSON body) and 52, 69: assert the 400 bodies and the bad-path message.
- Line 83: `.catch(() => [])` on validate. Test a rejecting validate and check the render still succeeds with no issues.
- Line 91: `renderMs` arithmetic. Fake `performance.now` and assert the rounded value.

**`dev/documents.ts` (84.00%)**: medium, because the logic is small but user-facing.
- Lines 68-69: the lookup for an item by `id` in an array and the object check. Test an array with non-object items, an array with no match, and a parsed value that is `null` or a primitive.
- `FRONTMATTER` (36, 43): near-miss tests (no leading `---`, trailing spaces after the fence, front matter with no data, a body only). The regex is a module-level constant, so check one by hand first.
- Line 56: the `format === 'json'` branch; a JSON record is not tested.
- 79, 84, 86, 100: assert the 405, 400 and 404 bodies. 94: a record with `buildTimeFields`.

### Quick wins (a few tests each)

- **`overlay/keys.ts` (3 survivors)**: line 15, a key that starts with the data prefix must return `undefined` (and one that merely ends with it must not); line 17, `slash <= 0` vs `< 0`: test a key with a leading `/`.
- **`manifest/languages.ts` (4)**: line 17, `||` → `&&`: test an entry with no file path and one with a non-markdown path; line 32, the `catch`: test an unreadable file; line 7, the `$` anchor: `a.md.txt`.

### Optional

- **`render/head.ts` (12)**: regex near-misses (`<header>` is not `<head>`, `<title-x>`), and the three entity decodes (`&#39;`, `&lt;`, `&gt;`), which are one-line table cases. The `SOURCE_SCRIPT_TAG` mutants (38) need an Astro script tag with and without `amp;`.
- **`request-guard.ts` (4)**: only the response bodies (`Forbidden`, `Not Found`, `Method Not Allowed`) and the `content-type` default. Cheap, but low value.

### Skip

- **`languages.ts`**, **`overlay/plugins.ts`**, **`overlay/dates.ts`**: the remaining survivors are the ones already classified above (static constants, `RESERVED`, equivalent checks). More tests would not move them.

### Suggested order

`media-route.ts` first (security guard plus the most survivors), then `render/handlers.ts` (the untested failure path), then the two quick wins, then `dev/documents.ts`.

## Second pass: improvement log

### `media-route.ts`: 76.77% → 92.93%

Result: 92 killed, 6 survived, 1 runtime error (was 25 survivors). The route tests went to 69 and a new `media-route.measure.test.ts` has 9 tests. Implementation unchanged.

Added: the traversal guard (`FILE_NAME`) with 19 near-miss names, plus a test with files that exist on disk (one outside the media folder, one with a non-hash name) so that "not found" cannot come from the missing file; the content-type rules (`image/png; charset=x`, `text/image/png`, upper case, no header); the size limit at 0, 1, `MAX_BYTES` and `MAX_BYTES + 1`; every response body, status and `Allow` header; `Cache-Control`; the content type served for each extension. `measureImage` is tested with `sharp` replaced, so that a missing width, height or format, and a throwing `sharp`, can be produced.

Remaining survivors: `prerender` and the `FILE_NAME` anchors (static constants), `EXTENSIONS` (static), and the `catch {}` body in `measureImage` (equivalent: falling out of the block also returns `undefined`). The guard-forced-to-false survivor (line 73) is covered by the test with real files; added after the Stryker run, not re-run.

Roadblocks and gotchas:
- **A path guard needs files that exist.** `../secret.png` was already answered 404 only because the file was not there. Put a file where the traversal would land.
- **Vitest 5 failed a test when a `vi.fn()` mock threw or rejected, even though the code under test caught the error** (`mockRejectedValue` and `mockImplementation(async () => { throw … })` both). I did not dig into why. The workaround is a plain function in the `vi.mock` factory that reads a mutable `state` object.
- The first Stryker run happened while that one test was failing, so its numbers were wrong. Check that the file passes before running Stryker.

### `render/handlers.ts`: 79.52% → 100%

Result: 83 of 83 killed (was 22 survivors, 5 of them with no coverage). Tests went from 12 to 43. Implementation unchanged.

Added: the whole failure path (a `validate` that throws during the second validation, a `validate` that throws in `handleValidate`, non-`Error` values thrown: a string, `null`, a number); how deep a `DraftError` is found in a cause chain (found under 0 to 4 wrappers, not under 5); every response body and header; `renderMs` and `Server-Timing` rounding with `performance.now` replaced; sorted limits; the media map reaching the page.

Learnings and gotchas:
- The depth limit is a good case for a table: `it.each([0, 1, 2, 3, 4])` plus one case just past the limit kills `<`, `<=` and the counter mutants.
- Replace `performance.now` with `mockReturnValueOnce` twice (start, end) and pick numbers where the rounding is visible (`12.36` gives `12.4`, not `12.3`).

### `dev/documents.ts`: 84.00% → 95.38%, and two real bugs fixed

Result: 124 killed, 6 survived (was 20). Tests went from 15 to 54.

**Implementation bugs found and fixed**, both in `entryOf` (the `file()` entry lookup):
- An array item with no `id` matched the key `"undefined"`, because `String(item.id)` of a missing id is `"undefined"`. Items without an `id` are now skipped.
- The object form used `parsed[id]`, so the keys `toString` or `__proto__` found inherited members of `Object.prototype` instead of "No entry". It now uses `Object.hasOwn`. This is the same class of bug as `languages.ts` (#7).

Added: front matter fences (spaces and tabs, four dashes, indented or text-carrying closing fence, closing fence at the end of the text, first fence wins, blank lines before the body, comment-only data, invalid YAML); entry lookup edge cases (non-object items, numeric ids, falsy values, first duplicate); every response of `handleDocument` (bodies, `Allow`, order of the checks, which flags are in the answer).

Remaining survivors: 4 variants of the `FRONTMATTER` regex (static), and two `true` conditionals on lines 69 and 72 (equivalent: the checks they replace are repeated by the code after them).

Learnings and gotchas:
- **Third time that a lookup by user-supplied key found something it should not** (`RESERVED`, `ALIASES`, now `entryOf`). `String(undefined)` as a lookup value and `obj[key]` on a plain object are the two patterns to grep for in the sweep recommended under #5.
- A test written to show something is *not* found can pass for the wrong reason (`not.toThrow(/No entry/)` passed while the function returned a function). Assert the exact error.

### `overlay/keys.ts`: 83.33% → 100%

Result: 18 of 18 killed. There was no test file for this module (it was only covered through `content-api`), so I added `keys.test.ts` with 7 tests: key builders, split at the first slash, an empty id, `data:` keys, the prefix only counting at the start (`blog/data:x`, `xdata:a/b`), and no collection (`/post`, which kills `slash <= 0` vs `< 0`). Implementation unchanged.

### `manifest/languages.ts`: 80.95% → 90.48%, and a real bug fixed

Result: 19 killed, 2 survived (was 4). Tests went from 3 to 27.

**Implementation bug found and fixed.** `readLanguages` did `new Set(languages)` on whatever the JSON held. A `code-languages.json` without a `languages` key gave an empty set (which means "restrict every language" instead of the documented "no list, no restriction"), and `"languages": "css"` gave the set `{'c','s'}`. It now returns `undefined` unless `languages` is an array.

Added: every Markdown extension in three cases, near-miss extensions that must not be read (`a.md.txt`, `a.mdy`, `a.xmd`, `md`, …) with a real fence inside so that reading them would show, missing and empty file paths, paths resolved against the root, several collections, canonical extra languages.

The old test put its "must not be read" JSON file behind an escaped fence that no reader would find, so reading it by mistake changed nothing. A "this file must be skipped" test needs content that would show up if the file *were* read.

Remaining survivors: the `MARKDOWN_FILE` regex (static) and the `catch {}` body (equivalent: falling out of the block returns `undefined`).

### `render/head.ts`: 84.51% → 90.14%

Result: 64 killed, 7 survived (was 12). Tests went from 3 to 22. Implementation unchanged.

Added: `<header>` and `<title-x>` / `<metadata>` must not match, upper-case tags and attributes on them, line breaks in the title, tags outside the head, the first `</head>` and the first title, empty and blank titles, self-closing meta and value-less attributes, a table of the five entities, `&amp;` decoded last, and near-misses for the source-script regex (with and without `amp;`, other attributes around `src`, content inside the tag, `type=style`).

Remaining survivors: 6 regex variants of the module-level constants (static).

Learnings and gotchas:
- The second quick win followed the pattern of #7, #9, #10 and the second pass: a list of "other" cases that never actually exercises the thing being excluded. Make the excluded case observable.
- Consistent with the earlier entries, a lenient reader of a file the build wrote (`new Set(x)` without checking `x`) is a place to look for the same kind of bug.

## Sweep: lookups by a user-controlled key

**The problem.** In JavaScript an ordinary object also "has" the names of `Object.prototype`. So `table[key]` with a key that comes from the user (a file name, a language in a code fence, a JSON key, an image path, an id) can return an inherited member such as `constructor` (a function), `toString`, or, for assignment, `__proto__` (which changes the prototype instead of adding a key). Four related mistakes turned up in the passes above:
1. `ALIASES[lower] ?? lower` in `languages.ts`: a fence ```` ```constructor ```` returned a function.
2. `parsed[id]` in `dev/documents.ts` `entryOf`: an entry id `toString` "existed".
3. `String(item.id) === id` in the same function: a missing `id` becomes the text `"undefined"`.
4. `new Set(languages)` in `readLanguages`: whatever the file held was accepted, a string became a set of characters.

**How the sweep was done.** Searched `src/` (without tests) for bracket lookups, `in` checks and `Record<string, …>` tables, and for each one asked: can the key come from a request, a draft or a file the user edits? Results:

| Place | Key from | Verdict |
|-------|----------|---------|
| `overlay/content-api.ts` `resolveImage` (`images[…]`, `context.media[…]`) | the image path in a draft | **Bug, fixed.** A draft image field `constructor` resolved to a function and never reached "image not found". Now `Object.hasOwn`. |
| `render/envelope.ts` `media[ref] = …` | the media map of the request body | **Bug, fixed.** A media ref `__proto__` replaced the prototype of the map, so every later lookup could inherit `url`, `width`… Entries are now collected and turned into an object with `Object.fromEntries`, which makes `__proto__` an ordinary key. |
| `render/islands.ts` `entryModules[specifier]` | the `component-url` written by the page | **Fixed** (low risk: site-defined). A specifier `constructor` made `file.replace` throw. Now `Object.hasOwn`. |
| `context.documents[key]` in `content-api.ts`, `data-proxy.ts`, `discover.ts` | document keys | Safe: reads are guarded by `hasDocument` (`Object.hasOwn`), and keys always contain `/` or `data:`, so they cannot be prototype names. |
| `collections?.[collection]` in `content-api.ts` | collection name from a key | Harmless: an inherited member has no `loader`/`schema`, so it behaves as a collection without them. Left as it is. |
| `buildTimeFields[key]`, `loaderKinds[collection]` in `manifest/documents.ts` | document keys, collection names of the site | Safe (keys contain `/`; names are the site's own). Left as it is. |
| `params[name]` in `match-route.ts`, `render-page.ts` | route parameter names of the site | Site-defined, and the object literal uses computed keys. Left as it is. |

**Tests added** (each fails on the old code and passes with the fix; checked by reverting the three fixes): `content-api.test.ts` (4 refs), `envelope.test.ts` (`__proto__` and `constructor` as media refs, plus the prototype of the result), `islands.test.ts` (four inherited names).

**Stryker on the files changed by the sweep** (one run, three files):

| File | Score | Notes |
|------|------:|-------|
| `overlay/content-api.ts` | 94.20% | 207 killed, 4 timeout, 13 survived (was 94.25%: unchanged, the new branches are all killed) |
| `render/envelope.ts` | 90.10% | 91 killed, 10 survived; 7 are the `IMAGE_FORMATS` strings (static) |
| `render/islands.ts` | 87.50% | 14 killed, 2 survived: the `/\/$/` regex of the base and a string |

Neither `envelope.ts` nor `islands.ts` was in the weak list (both were above 85% before), so there is no earlier score to compare with.

**Rules of thumb for new code.** For a lookup table keyed by user text use a `Map`, or `Object.hasOwn(table, key)` before reading, or `Object.create(null)`. To build an object from user keys use `Object.fromEntries`, never `obj[key] = value`. Never convert a possibly missing value with `String(…)` before comparing. When a reader of a generated file gets `x`, check its type before using it.

## Final run: files below 90%

Last full run: overall score **90.29%** (2,399 killed or timed out, 258 survivors, 16 mutants errored and are not scored). Started at 77.55%. The report of this run is the only one kept: `reports/mutation/mutation.html`, with the results in `reports/stryker-incremental.json`.

Eight files are still under 90%. Every file from the second-pass table above that is not listed here (`media-route.ts`, `render/handlers.ts`, `dev/documents.ts`, `overlay/keys.ts`, `manifest/languages.ts`, `render/head.ts`, `request-guard.ts`) is now at 90% or more.

| File | Score | Survivors | Verdict |
|------|------:|----------:|---------|
| `languages.ts` | 72.53% | 25 | **Not worth pursuing**: 24 are static constants |
| `overlay/dates.ts` | 78.43% | 11 | **Not worth pursuing**: 9 static regex, 2 equivalent |
| `overlay/plugins.ts` | 80.00% | 45 | **Not worth pursuing**: 35 are `RESERVED`, the rest equivalent or static |
| `client/bridge.ts` | 85.37% | 12 | Worth a short look |
| `manifest/import-scan.ts` | 86.92% | 42 | **Not worth pursuing**: 20 static, the rest equivalent |
| `render/islands.ts` | 87.50% | 2 | Optional, two cheap tests |
| `overlay/markdown.ts` | 88.57% | 4 | Not worth pursuing |
| `render/render-page.ts` | 89.74% | 4 | Not worth pursuing (one optional test) |

### Not worth pursuing further

Revisit only if the code changes. In each file the survivors have already been classified, and more tests would not move the score.

- **`languages.ts` (72.53%)**: the 19 string literals of `ALIASES` and `PLAIN` and the regex variants of `OPENING`/`CLOSING` are static mutants; `i <= lines.length` (line 55) is equivalent. The real bug (`Object.prototype` lookups) is fixed and tested.
- **`overlay/dates.ts` (78.43%)**: 9 variants of the `ISO_DATE` regex (static) plus the two equivalent checks (`path.length === 0`, `typeof current === 'string'`). The valid and near-miss tables already pass.
- **`overlay/plugins.ts` (80.00%)**: 35 of the 45 are the `RESERVED` word list (a test fails when a word is removed by hand), plus `name`/`enforce` built at import time, and equivalent guards (`'utf8'`, `startsWith('\0')`, `!Array.isArray`). Simplifying `CONTENT_CONFIG` to `/^content\.config\.[jt]s$/` would remove 3 regex survivors, but that is a code change, not a test.
- **`manifest/import-scan.ts` (86.92%)**: the extension lists at lines 10-12 (20 string literals, static); the rest are `<=` in string-scanning loops, a path on another drive, and the alias sort tie. Also not worth more effort after the `stripJsonComments` bug fix.
- **`overlay/markdown.ts` (88.57%)**: line 49 `currentOverlay()?.` (the overlay is always set in tests), line 54 the `renderTemplate` body wrapper, and line 63 the `?? []` fallback. All sit in glue code that Astro's runtime needs, and are better covered by an end-to-end render than by a unit test.
- **`render/render-page.ts` (89.74%)**: timing arithmetic (lines 62, 73: `-` → `+` on `performance.now()`), the `NotFoundError` name (38) and the `^\.\.\.` regex (65). The timings are only reported, never used for decisions. If you want one cheap test, fake `performance.now` and assert `pathsMs`/`renderMs`, the same idea as the `renderMs` test in `handlers.ts`.

### Worth a short look

- **`client/bridge.ts` (85.37%, 12 survivors)**: this is the only file below 90 with real logic left, and it is the preview's client side.
  - `requestCount` handling (lines 51, 56, 95): the `++`/`--` mutants and the stale-answer guard `if (id !== requestCount) return` (77). Test two overlapping drafts where the first answer arrives last, and assert only the second is patched.
  - Line 87, `isDraftMessage` guard: send a message event with foreign data and assert nothing is posted or patched.
  - Line 96, `patcher.reset()`: assert it runs on navigation.
  - Line 114, `status === 422`: assert a 422 and a non-422 error produce different messages.
  - Line 122: assert `message` is cut at 500 characters.
  - Lines 74, 78, 108: only log text and the listener name; skip, unless the log output matters.

### Optional

- **`render/islands.ts` (87.50%, 2 survivors)**: `base.replace(/\/+$/, '')` (line 9) needs a base with several trailing slashes (`/x//`), and line 13 needs a non-empty file with a leading slash. Two table rows.

## `client/bridge.ts`: 85.37% → 100%

Result: 82 of 82 killed (was 12 survivors). `bridge.test.ts` went from 17 to 33 tests. Implementation unchanged; I found no bug in it.

Added, following the "Worth a short look" notes above:
- **Stale answers.** The counter is bumped by a protocol-mismatch message and by a navigation. The old tests could not see it, because a later draft was not sent. The new tests leave a draft in flight, send a mismatch (or navigate), then send a *newer* draft, and finally answer the first one: it must be dropped. With `requestCount--` the first draft's id would be reused and its answer would land.
- **Stale failures.** A superseded draft whose fetch rejects, or whose answer is not JSON, must not report an error (the guard in the `catch`).
- **Foreign messages.** A message that is not a draft sends nothing at all and does not change the editor origin (the old test only checked that `fetch` was not called).
- **Navigation.** `patcher.reset()` is observable: an inline script the bridge ran is run again by the page that replaced the document; and `stop()` also removes the `astro:page-load` listener.
- **Errors.** Only a 422 is read as field errors (a 500 with the same JSON is reported as text); a 422 that is not JSON falls back to the text; the text is cut at 500 characters and a message of exactly 500 stays whole.
- **Logs.** `console.info` and `console.error` are asserted with their arguments.

Learnings and gotchas:
- **A counter that guards against stale answers is only tested by a third request.** Start A, invalidate it (navigation, mismatch), start B, *then* answer A. Answering A before B exists passes for both `++` and `--`.
- Mock `console.info`/`console.error` in these tests and restore them, or the log lines drown the test output.

Possible improvements to the code itself, not made (they change behavior and need a decision):
- **Abort superseded requests** with an `AbortController` (the render route keeps working on a draft nobody wants; the `fetch` call would gain a `signal`, and an abort lands in the existing `catch`, which already ignores stale ids).
- **A timeout** on the render request: a hung render leaves the editor with no `preview:rendered` or `preview:error` for the current draft until a newer one is sent.
- The `[preview-bridge] patched` log runs on every draft with the document keys; fine for development, noisy if a preview build is ever used by editors for long sessions.

## Latest full run

After the sweep and the `bridge.ts` work: overall score **90.74%** (2,385 killed, 26 timeout, 238 survived, 8 without coverage, 16 errored and not scored). Full suite: 34 files, 992 tests, all passing; `tsc` is clean. Only the report of this run is kept (`reports/mutation/mutation.html` and `reports/stryker-incremental.json`); `reports/` is not committed (listed in `.gitignore`), so re-run `npx stryker run` to regenerate it (the incremental file makes that quick).
