# Handoff: astroViewCMS, the preview render server

Written 2026-10-25, after steps 1 and 2 of the plan, the TypeScript rewrite
and the test suites. This is the overview. For how things work, read
[DOCS/PREVIEW-RENDER-SERVER.md](DOCS/PREVIEW-RENDER-SERVER.md); it has the
diagrams, the request contract and all measurements.

The research that led here is in the parent folder
(`../HANDOFF.md`, `../*-SYSTEM-OVERVIEW.md`, and the `tinacms/`, `astroadmin/`
and `sveltia-cms/` checkouts, which are reference only).

## Goal

A Tina-style live preview without Tina: edit an Astro site's content and see
the real site update as you type, **without running `astro dev` per editor**.
The site is built once with its component code kept; a small Node process
re-renders components in memory with draft data, and a script in the
previewed page swaps the HTML in.

## Where we are

A working proof of concept, committed on `master` (9 commits, tree clean):

| | Status |
|---|---|
| Sample site cleaned up (local-only Astro 7 + Tailwind 4, no CMS or deploy config) | done |
| In-memory render route (`POST /__preview/<island>`) | done |
| Live preview in the browser: island markers, bridge script, test editor at `/__editor`, draft images | done, checked by hand |
| TypeScript rewrite (no build step) | done |
| Unit tests (115, Vitest) and end-to-end suite (15) | done, all passing |
| Saving drafts to the site | **not started** |
| A real editor (forms, auth, hosting) | **not started** |

Measured on this machine (details in the docs): the server uses about **80 MB**
against **~650 MB** for `astro dev` on the same site, and renders a change in
**~0.3 ms** (about 2 ms round trip).

## The pieces, in one paragraph

`astroViewCMS/` is an npm workspace with two packages. `sampleAstroProject/`
is the site; its only change from a plain Astro site is that the block loop
lives in `BlockList.astro`, because an island has to be a component.
`preview-render-server/` builds a site with Astro's own `build()` plus the
Node adapter and an integration of ours, which injects the routes, wraps each
island in a marker div by redirecting imports (the site's source stays
untouched), and adds the bridge script to every page. The output goes to
`preview-render-server/.build/`. `npm start` runs the built server. An editor
talks to the bridge in the iframe over `postMessage`; the bridge posts the
draft to `/__preview/<island>`, gets an HTML fragment and swaps it in.

## Decisions made, and why

| Decision | Why |
|---|---|
| Pattern copied from Tina's island route and bridge (Apache-2.0), not depended on | Tina's bridge speaks Tina's admin protocol. We have no Tina Cloud, so the editor sends complete data and there's no fetch-and-overlay step |
| Named **preview-render-server**, not "worker" | "Worker" suggests Cloudflare Workers; this is a Node process |
| **Node** (bundled option tested), not Bun or workerd | Bun gave no memory gain (342 MB private on Windows). workerd costs ~24 MB per site on top of its runtime, so it only wins with many sites in one process, and it loses `sharp`, filesystem access and some npm packages. Revisit only for many simultaneous previews |
| **Container API** over Astro's server islands | Server island props are encrypted with a build-time key; the browser can't send new ones |
| Marker added **at build time** by import redirection | Keeps the site's source and its production HTML clean |
| The **bridge does the fetch**, the editor only sends `postMessage` | Same origin, so no CORS. Any editor that speaks `src/protocol.ts` can drive the preview |
| Drafts are **stateless** on the server | They live only in the editor tab. Simpler, nothing to clean up. Saving belongs to the editor side. Uploaded draft images are the one thing kept |
| **One shared Astro copy** (npm workspace) | Avoids two Astro instances. Per-site isolation (Docker or similar) is deferred |
| **TypeScript without a build step** | Node 26 strips types; Vite compiles what ends up in the build; `tsc` only type-checks (`erasableSyntaxOnly`) |
| **Vitest**, not `node:test` or Suites | `node:test` is weak on module mocking; Suites is an auto-mocking layer for class-based DI, and our code is plain functions. Coverage is **reported, not gated** |
| Tests render **real `.astro` fixtures** through the Container API | No mocked renderer; `getViteConfig` gives tests Astro's own Vite setup |

## Working rules

- **Ask before committing.** Finish the work, summarize it, and ask first. The
  user reviews changes before they land in history.
- The user prefers concise, system-level overviews and explanations of how
  things work, step by step. They want TypeScript, a test file per source
  file, and brief but thorough comments on functions and routes.
- Docs use plain-text diagrams (they render in VS Code and on GitHub).

## Environment notes (this machine: Windows 11, Node 26, 16 GB RAM)

- **Astro 7 detects AI agents** and backgrounds `astro` commands. When an
  agent runs the build or tests, unset the markers:
  `env -u AI_AGENT -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_AGENT_SDK_VERSION <cmd>`.
  The end-to-end setup already does this for its child processes. A person
  running the commands in a terminal doesn't need it.
- **Memory is tight** (often under 1 GB free). Measure **private memory**, not
  working set: Windows trims the latter.
- **`localhost` resolves to IPv6 here** for servers started without
  `HOST=127.0.0.1`; use matching hosts when polling.
- Python isn't installed; use Node for scripting.
- Chrome-devtools automation has hung before; ask the user to check UIs in
  their own browser.

## Gotchas already hit

- **The build folder must be inside the workspace.** Prerendering and the
  running server resolve npm packages from `node_modules`, so a build in the
  OS temp folder fails. (Why bundling needs care too; see the docs.)
- **A relative `outDir` resolves against the site root**, not the render
  server. `site-config.ts` makes every path absolute.
- **`virtual:preview-islands` exists only during a build.** Unit tests alias it
  to a fillable double (`test/fixtures/virtual-preview-islands.ts`).
- **Swapped-in HTML doesn't re-run component `<script>`s**, and the container
  writes dev-only script references that the route strips.
- **Under happy-dom, `URL` is the DOM's**, which `node:fs` rejects; use paths.
- `experimental_AstroContainer` can change in any Astro release. Tina has the
  same exposure.

## Next steps, according to the plan

> **Superseded (2026-10-26):** read [DOCS/SYSTEM-DESIGN.md](DOCS/SYSTEM-DESIGN.md)
> first. It replaces this list. Documents, not islands, are the unit of
> editing and saving. The preview renders whole pages with a content
> overlay, and the preview server stays read-only. Section 7 there lists
> what to change in the current code, including the uncommitted per-island
> save work. The list below is kept for history.

In rough priority order; the first two matter most.

1. **Saving.** Write the edited props back to the content file (`home.json`),
   move uploaded draft images into the site (`src/content/assets/images/`) and
   fix the paths, then git commit and push, AstroAdmin-style. Open question:
   does the render server own this, or does the editor? (Current thinking:
   the editor side; the server stays stateless.)
2. **A real editor instead of the JSON textbox.** AstroAdmin converts the Zod
   schemas in `content.config.ts` to JSON Schema to generate forms; that is
   the natural model. Alternatives: a Sveltia `registerPreviewTemplate` that
   posts entry data to the bridge (it already speaks plain `postMessage`), or
   our own editor. Includes draft persistence in the editor (`localStorage`).
3. **Click-to-focus.** Blocks already carry `data-block-index`; AstroAdmin's
   `focusBlock` / `fieldFocus` messages are the model. Needs new protocol
   messages and optional `data-field` markers in preview builds.
4. **More islands.** Only `blocks` exists. The navbar is the next candidate
   (needs the site config entry and a component that takes props).
5. **A `--bundle` build option.** Tested and works (1.07 MB server, no
   `node_modules` at runtime except `sharp`); not yet a flag.
6. **Per-site isolation and multi-site.** Docker or another lightweight
   isolation, one Astro copy per site. Decide with the hosting model.
7. **Tooling.** A linter and formatter (Biome is the suggestion; Tina uses it)
   and a CI workflow (typecheck, unit, end-to-end) once the repo has a remote.
8. **Smaller items.** Cleanup of old uploads in `.build/<site>-media/`;
   re-running component scripts after a swap; pinning or tracking the
   experimental Container API.

## Running things

```sh
cd preview-render-server
npm run build       # preview build of sampleAstroProject (~25 s, only after code changes)
npm start           # http://localhost:4400, editor at /__editor
npm run typecheck
npm test            # 115 unit tests, ~2 s
npm run coverage    # unit tests + coverage report (reported only)
npm run test:e2e    # builds into .build/e2e-*, real server, HTTP checks (~7 s)
```

Run `npm install` in `astroViewCMS/` first. The server isn't running now.

## Commit history

```text
f3c25b2 Document the preview render server code
76d59aa Update docs for the TypeScript and test structure
05604de Replace smoke script with a Vitest end-to-end suite
c9091d1 Add Vitest unit tests for the preview render server
5c0a6bc Rewrite preview render server in TypeScript
8975288 Add live preview: island wrappers, bridge, test editor, draft images
772d23b Add preview render server for in-memory Astro component rendering
78d67aa Extract BlockList component from the home page
ee3ccd0 simple astro sample project to work on initialized
```
