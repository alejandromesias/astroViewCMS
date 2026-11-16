# Work plan, pre-phase 3 (proposal)

Written 2026-11-15. Status: **proposal, not approved.** It turns the findings of [SYSTEM-DESIGN-AUDIT.md](../../Designs/SYSTEM-DESIGN-AUDIT.md) into tasks. Nothing here is scheduled until the user accepts it; an accepted task moves into WORKPLAN-PHASE-2.md as step 2.14 (the ids below already fit `npm run worktree`).

The tasks are suggestions sized by value, not a gate. Three are worth doing even if the rest are dropped: **2.14a** (a second site), **2.14c** (`schema.json` for forms) and **2.14d** (the API contract). Phase 3 is built on all three.

Reading marks are those of WORKPLAN-PHASE-2 section 2: `[build]`, `[user]`, `[ci]`.

## 1. Summary

| Id | Task | Finding | Priority | When | Size |
|---|---|---|---|---|---|
| 2.14a | Second-site spike | A2 | Must | before phase 3 starts | spike, 1 session `[build]` |
| 2.14b | Decide how a site gets its dependencies | A2 | Must | after 2.14a `[user]` | decision |
| 2.14c | `schema.json` v2 for forms | A3 | Must | before phase 3 starts | 1 to 2 sessions `[build]` |
| 2.14d | `cms-contract`: API schemas and error codes | A6 | Must | before phase 3 starts; best with 2.11c | 1 session |
| 2.14e | Local origins, `Origin` check, same-site spike | A7, A12 | Should | before phase 2 closes | 1 session, part `[user]` |
| 2.14f | Astro canary and the internals list | A11 | Should | any time `[ci]` | small |
| 2.14g | macOS smoke job | A12 | Should | before the MVP is shared `[ci]` | small |
| 2.14h | Split the phase 2 work plan | A15 | Should | at the phase 2 close (with 2.13b) | small, docs only |
| 2.14i | Gate profile for UI code | A14 | Should | before phase 3 starts `[user]` | decision plus config |
| 2.14j | Site context and actor seam | A10 | Should | before phase 3 starts | check first; small if needed |
| 2.14k | Reserve `base` in the render envelope | A8 | Could | with the next protocol bump | tiny |
| 2.14l | Decide the backup ref for saves | A9 | Could | decision now `[user]`, build in phase 4 | decision |
| 2.14m | osv-scanner and docs-only pushes | A19 | Could | any time `[ci]` | tiny |

Order and parallelism:

```text
 2.14a ──▶ 2.14b [user]
 2.14c ─┐
 2.14d ─┼──▶ phase 3 step 3.1 (editor shell and form model)
 2.14j ─┘
 2.14e, 2.14f, 2.14g, 2.14m   independent, any time
 2.14h                        with 2.13b
 2.14i [user], 2.14l [user]   decisions, no code until answered
```

2.14a and 2.14c both run builds, so they run one after the other (one `[build]` task at a time). 2.14c edits `preview-render-server/src/integration.ts` and the schema pass, which are on the shared-files list; nothing else here touches them.

## 2. Tasks

### 2.14a Second-site spike — Must · `[build]`

The question: what breaks when the site is not `sample-site`?

- Take one unrelated Astro site: the official blog template (`npm create astro -- --template blog`) is enough. It has Markdown and MDX content collections, no React, and different folder names. If the user has a site of their own on Astro 7, run that as a second case.
- Push it to a local bare repo, write its `cms.config.ts` and site config, and run the whole path: first build, open the test editor, edit a draft, save, publish.
- Do not fix what breaks. Record it: each failure with its cause, and whether the cause is (a) a dependency the workspace lacks, (b) the Astro version, (c) an assumption taken from bigspring, (d) a real bug.
- **Done when:** a table of the failures by cause is in this file, with the smallest change that would make that site work, and the list of what a site must satisfy today (the compatibility list that the quick start will state).

This is a spike: throw the scaffolding away, keep the table.

### 2.14b Decide how a site gets its dependencies — Must · `[user]` · after 2.14a

Options, to be weighed with 2.14a's table in hand:

| Option | How | For | Against |
|---|---|---|---|
| A. Workspace only (today) | The site builds with the CMS's `node_modules`; a site with other dependencies adds them to the workspace | Nothing to build; one Astro copy, as phase 1 chose | Only works for sites shaped like the workspace; a dead end for phase 4's container |
| B. The preview integration is a package installed into the site | The working copy runs its own install; `preview-render-server` resolves the site's Astro as a peer dependency | The standard Astro integration model; bundles become portable; phase 4 needs it anyway | Two installs to manage; install scripts are site code and need the scrubbed environment; a support range of Astro versions to state and test |
| C. Hybrid | Install the site's dependencies, but force the workspace's Astro through an override | Smaller step from today | Overrides hide version conflicts until a build fails |

My recommendation is B as the target and A for the MVP, with the MVP's quick start saying so plainly. The decision is logged as a new entry in SYSTEM-DESIGN section 11. Building B is phase 4 work; deciding it now keeps phase 3 from adding assumptions that fight it.

### 2.14c `schema.json` v2 for forms — Must · `[build]`

Today's export (flavor 1 of D3) was made for quick checks. Forms need more. In the renderer's schema pass:

1. **Dates.** A date field exports a marker, `{ "type": "string", "cms": "date" }`, instead of `{}`. Same approach as `image` and `reference`: the stub knows what it replaced.
2. **Discriminated unions.** Each `oneOf` carries `cms: { discriminator: "<key>" }`, and each branch its constant value, so a block picker lists the block types without guessing.
3. **Optional, nullable, default.** Check that all three survive the export for nested fields and array items; add a test per case.
4. **UI hints from the site config.** The sample stays free of CMS config, so hints live in the site config and are copied into `schema.json` under a `ui` key:

   ```ts
   fields: {
     'blog.title':       { label: 'Title' },
     'blog.description': { widget: 'textarea' },
     'homepage.banner.content': { widget: 'markdown' },
     'blog.image':       { widget: 'public-image' },
     'pages.layout':     { hidden: true },
   }
   ```

   Every hint is optional. Without hints, a form still renders: labels come from the key, and a string is a one-line input.
5. **A version.** `bundle.json` gets `schemaVersion: 2`. `cms-server` treats a bundle without it like a protocol mismatch (D14): one rebuild, then an error.

- **Done when:** the fixture bundle is regenerated; a test walks every field of every editable document of the sample and finds a known node kind or an explicit `unknown`; the `blog` collection's `date` exports the marker; the unit tests of the schema pass cover each new rule. Changed files meet the mutation floor.

### 2.14d `cms-contract`: API schemas and error codes — Must

- A leaf package (or an entry point of `preview-contract`; the builder picks, as in 2.0a) with a Zod schema and an inferred type for each route's request and answer, and one union of error codes with the HTTP status each maps to.
- `cms-server`'s routes parse and answer with these schemas instead of local types. The editor imports only this package and `preview-protocol` (a dependency-cruiser rule).
- The route and error tables of `CMS-SERVER.md` (2.13b) are generated from it, so prose and code cannot drift.
- Best done together with 2.11c, which is the first task to consume the answers of `PUT /api/changes` (see the waves rewrite).
- **Done when:** no route in `cms-server/src/http/` defines a response type of its own; a test fails if a route answers an error code that is not in the union.

### 2.14e Local origins, `Origin` check, same-site spike — Should

1. `cms.config.example.ts` uses `http://cms.localhost:4400` and `http://preview.localhost:4401`, as PHASE-2-DESIGN 5.7 decided.
2. Start-up logs a warning when `origins.cms` and `origins.preview` share a host.
3. Write routes also refuse a request whose `Origin` header is present and is not `origins.cms`. `Sec-Fetch-Site: same-site` passes today's check, and the JSON content type is the only thing between a same-site page and a write.
4. **Spike `[user]`:** `cms.avc.localhost` and `preview.avc.localhost` are same-site, so a `SameSite=Lax` preview cookie should work without third-party cookie support. Check Firefox on Windows (Playwright), and Safari on a real Mac if one is available. The result decides the Safari answer that phase 4 planned, and the browser line of the quick start.

- **Done when:** items 1 to 3 are merged with tests, and the spike's result is written into SYSTEM-DESIGN section 12 (the phase 4 cookie item).

### 2.14f Astro canary and the internals list — Should · `[ci]`

- A weekly workflow that installs `astro@latest` and the newest pre-release in turn and runs the e2e suite. It does not block anything; a failure opens an issue.
- A short section in PREVIEW-RENDER-SERVER.md that lists every Astro internal the renderer touches (`astro/container`, `astro/runtime/server/index.js`, `virtual:astro:manifest`, `virtual:astro:renderers`, `virtual:image-service`, the `astro:content` rewrite), with the file that touches it. An upgrade then has a checklist.
- **Done when:** the workflow has run once and the list matches a grep of the imports.

### 2.14g macOS smoke job — Should · `[ci]`

A weekly job on `macos-latest`, in the shape of `windows.yml`: unit tests of the process and git code, and the e2e start test. Testers of an MVP are likely to be on a Mac, and no run has ever happened there.

- **Done when:** the job is green once, or its failures are tasks.

### 2.14h Split the phase 2 work plan — Should · docs only

- `WORKPLAN-PHASE-2.md` keeps: sections 1 to 3, the open tasks, the done-when map, the measurements, the decisions. The status row becomes a table, one row per wave.
- `WORKPLAN-PHASE-2-LOG.md` gets the bodies of the finished tasks, unchanged, with the anchors kept so code comments that cite "WORKPLAN 2.5c" still resolve (the README map names the log).
- Rule for phase 3's plan: a task entry holds its goal, its inputs and its "done when". Review notes and results go to the log when the task closes.
- **Done when:** the live plan is under about 40 KB and no link in `DOCS/` is broken.

### 2.14i Gate profile for UI code — Should · `[user]`

Phase 3 writes browser UI. The current gates (one test file per source file, 80% per-file mutation on changed files) fit logic and fit views badly: a mutated label or class name is not a defect worth a test.

Proposal:

| Kind of code | Gates |
|---|---|
| Logic: form model, draft store, API client, message mapping, preview controller | as today: unit tests, coverage floors, `mutation-diff` at 80 |
| View components | type check, lint, coverage, and the browser suite; outside the mutation scope |
| The editor as a whole | a browser test per user journey of the phase's "done when" |

- **Done when:** the user decides; the Stryker scope and CI-PIPELINE.md say it.

### 2.14j Site context and actor seam — Should

Check first, change only if needed:

- Every route gets the site's state through one object (config, bundle source, working copy, repo, preview). If routes close over module-level state, move it into that object. Phase 5's `/sites/:site` then mounts the same routes once per site.
- One middleware sets an `actor` on the request context. Today it is a constant (the local user, with `git.author`). Saves and publishes take the commit author from it. Phase 4 swaps the middleware for sessions.
- **Done when:** the check is written down; if code changed, no behaviour changed and the tests pass untouched.

### 2.14k Reserve `base` in the render envelope — Could

The next time the protocol version is bumped (phase 3 bumps it for click-to-focus), the envelope schema accepts an optional `base: string` and ignores it. Phase 5 can then add the overlay cache of audit finding A8 without breaking older bundles. No behaviour, one line and one test.

### 2.14l Decide the backup ref for saves — Could · `[user]`

Decide whether phase 4 pushes `cms/work` to a hidden ref (`refs/cms/work`) and restores from it at start-up. If yes, it goes into SYSTEM-DESIGN section 12 under phase 4. No code now.

### 2.14m osv-scanner and docs-only pushes — Could · `[ci]`

`security.yml` runs on a schedule and on pull requests; a push to `main` that touches only `DOCS/` skips it by path. A new advisory then shows as a failed scheduled run, not as a red docs commit. This also answers the open call of the 2026-11-13 handoff: docs commits can keep going straight to `main`.

## 3. Not proposed

Considered and left alone, so they are not raised again without a reason:

- **Changing "the CMS change wins" (D18).** It is a product decision the user made, and the commit message records what was overwritten.
- **Replacing the git CLI with a library.** The CLI wrapper is tested and the dependency is one binary.
- **Caching listing routes (D7).** The measurement says no; the tripwire exists.
- **A database before phase 4.** Git as the store is the reason phase 2 has no migration story to maintain.
- **Raising the mutation thresholds.** 94% overall is already more than the stage needs.
