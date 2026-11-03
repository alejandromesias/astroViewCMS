# astroViewCMS docs

Start here. This page maps the documents, says which one is the authority,
and holds the working rules and commands that apply to every phase.

## 1. Document map

```text
 SYSTEM-DESIGN.md ─────────────── the authority: what we build and why, all phases,
   │                              decision log (D1 to D16), roadmap (section 9),
   │                              later-phase backlog (section 12)
   │
   ├─ phase design (only where a phase needs one)
   │    PHASE-2-DESIGN.md         cms-server, single tenant: decisions, contracts, step 2.0
   │
   └─ work plans (steps and tasks, one per phase)
        WORKPLAN-PHASE-0-1.md     phases 0 and 1: closed 2026-10-31, kept as the record
        WORKPLAN-PHASE-2.md       phase 2: current (58 tasks, with dependencies in the headlines)

 How the code works today        PREVIEW-RENDER-SERVER.md (the renderer, the bridge, the routes)
 Rules for code and tests        IMPLEMENTATION-RECOMMENDATIONS.md, TESTING-RECOMMENDATIONS.md
 Quality gates                   QUALITY-TOOLING.md (manual), QUALITY-TOOLING-PLAN.md (log)
 Working notes and analysis      MODULE-GRAPH.md, MUTATION-WEAK-SPOTS.md, VISUAL-CHECKS-ON-SAMPLE-SITE.md
 Session handoffs                Handoffs/ (history; never edited afterwards)
```

**Which one wins.** SYSTEM-DESIGN.md over a phase design, a phase design over
its work plan. A disagreement is fixed in the lower document, or, if the
higher one is wrong, by a new decision in SYSTEM-DESIGN's log (ask the user
first).

**What goes where.**

| Kind of content | Document |
|---|---|
| A decision that holds across phases | SYSTEM-DESIGN.md section 11 (decision log) |
| The design of one phase: contracts, flows, its own decisions | `PHASE-<n>-DESIGN.md` |
| Steps, tasks, status, measurements of one phase | `WORKPLAN-PHASE-<n>.md` |
| Work decided for a later phase, and known issues to carry | SYSTEM-DESIGN.md section 12, until that phase gets its plan |
| Rules, environment notes, gotchas, commands for every phase | this file |

When a phase starts, its items move out of SYSTEM-DESIGN section 12 into its
design or plan, and section 12 keeps a one-line pointer.

**Current phase: 2** (design approved, plan written, not started). Read SYSTEM-DESIGN.md (sections 1 to 6, 9, 11),
then PHASE-2-DESIGN.md, then WORKPLAN-PHASE-2.md. Older code comments say
"WORKPLAN task 1.x": those tasks are in WORKPLAN-PHASE-0-1.md.

The research that led here (Tina, AstroAdmin, Sveltia, Sitepins) is in the
parent folder: `../../HANDOFF.md`, `../../*-SYSTEM-OVERVIEW.md`, and the
`tinacms/`, `astroadmin/` and `sveltia-cms/` checkouts, which are reference
only.

## 2. Working rules

- **Ask before committing.** Finish, summarize, ask. The user reviews changes
  before they land in history.
- **Follow the design's units.** If a function outside rendering or DOM
  swapping is keyed by a region (or "island"), it's in the wrong place. See
  "When to think in regions, and when not" in SYSTEM-DESIGN.md.
- **The preview node never writes to the site** and holds no credentials.
- **TypeScript, no build step:** Node runs `.ts` by stripping types
  (`erasableSyntaxOnly`: no `enum`, no `namespace`; imports use `.ts`).
  Vite compiles what goes into the build. `tsc` only type-checks.
- **One test file per source file** (`*.test.ts` next to it), Vitest. Glue
  with top-level side effects (`build.ts`, `start.ts`) is
  covered end-to-end and left out of the coverage floors.
- **Real Astro in tests:** render real `.astro` fixtures through the Container
  API (`getViteConfig`), no mocked renderer. Pass dependencies in (`win`,
  `fetch`) instead of module mocking.
- **Comments:** brief but thorough, on every function and route.
- **Docs:** plain-text diagrams, concise system-level explanations. The user
  prefers step-by-step "how it works" overviews.
- **Keep the sample site free of CMS config.** Everything CMS-specific lives
  in `preview-render-server/sites/<site>.config.ts`.
- **The sample site is a realistic stand-in, not the spec** (reworded
  2026-10-31). The floor: for every pattern in the sample, the CMS never
  breaks or silently corrupts the site. Each part previews and saves
  correctly, or is read-only or simplified, with a documented limit. Full
  support goes to patterns common across Astro sites, not to what one
  template happens to do. Grow the sample with common patterns it lacks,
  rather than shaping the CMS around its quirks. Prefer adding complexity
  to the sample over simplifying it.

## 3. Environment notes (Windows 11, Node 26, 16 GB RAM)

- **Astro 7 detects AI agents** and backgrounds `astro` commands. From an
  agent, unset the markers:

  ```sh
  env -u AI_AGENT -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_AGENT_SDK_VERSION <cmd>
  ```

  The end-to-end setup already does this for its child processes. A person
  in a terminal doesn't need it.
- **Memory is tight,** often under 1 GB free. Measure **private memory**,
  not working set, because Windows trims the latter. Avoid parallel installs
  and builds.
- **npm installs are slow here:** bigspring took 8.5 minutes and 564 MB of
  `node_modules` standalone.
- **npm 11 blocks install scripts** unless approved
  (`npm install-scripts approve <pkg>`). No Corepack; for pnpm use
  `npx --yes pnpm@<version>`.
- **`localhost` resolves to IPv6** for servers started without
  `HOST=127.0.0.1`. Use matching hosts when polling.
- **Python 3.12 is installed** as `py` and `python` (`C:\Python312`).
  `python3` is the Microsoft Store placeholder and fails, so don't use it.
  Prefer Node for project scripts, since the project is Node-only.
- **Heredocs in the agent's Bash tool can lose backslashes.** Write files
  that contain them with the file-writing tool.
- **Chrome DevTools automation has hung before.** Ask the user to check UIs
  in their own browser.

## 4. Gotchas already hit

- **The build folder must be inside the workspace.** Prerendering and the
  built server resolve packages from `node_modules`. A build in the OS temp
  folder fails.
- **A relative `outDir` resolves against the site root,** not the render
  server. `site-config.ts` makes every path absolute.
- **The virtual module exists only during a build.** Unit tests alias it to a
  fillable double (`test/fixtures/virtual-preview-islands.ts`).
- **Swapped-in HTML doesn't re-run component `<script>`s,** and the container
  writes dev-only script references that the route strips.
- **Under happy-dom, `URL` is the DOM's,** which `node:fs` rejects. Use paths.
- **`experimental_AstroContainer` can change in any Astro release.** Tina has
  the same exposure.
- **`resolveId` never sees `astro:content`** (Astro resolves it first). The
  overlay works with a `transform` hook, `enforce: 'post'`, that rewrites the
  import in modules under the site's `src/`.
- **Bigspring's `astro-auto-import@0.5.1`** declares peers only up to Astro 6.
  pnpm ignores that; npm needs `--legacy-peer-deps`. It works with Astro 7 in
  practice (the template builds).

## 5. Running things

```sh
cd astroViewCMS && npm install      # once: workspace install
cd preview-render-server
npm run build:sample   # preview build of sample-site, with the editor's data route (~10 s warm)
npm run start:sample   # http://localhost:4401, test editor at /__editor
npm run typecheck
npm test               # unit tests (1039 on 2026-10-31)
npm run coverage       # unit tests + coverage report, with floors
npm run test:e2e       # builds into .build/e2e-*, real server, HTTP checks and budgets
npm run test:browser   # Chromium browser tests (the iframe, the bridge, hydration)
```

From the repo root, `npm run check` runs every quality gate (`-- --e2e` adds
the end-to-end and browser suites, `-- --all` adds Stryker; timings in
[QUALITY-TOOLING.md](QUALITY-TOOLING.md)). `npm run graph` draws the module
graph, `npm run measure:memory` and `npm run measure:listing -- --posts=N`
repeat the measurements of WORKPLAN-PHASE-0-1.md section 10. `npm run build`
and `npm start` in `preview-render-server` build and serve `sample-site`.

From an agent, prefix build and test commands with the `env -u …` line from
section 3.
