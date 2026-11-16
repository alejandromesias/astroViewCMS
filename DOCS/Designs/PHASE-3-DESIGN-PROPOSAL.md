# Phase 3 design proposal: the editor, as an MVP

Written 2026-11-15. Status: **proposal, not approved.** [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) stays the authority. When the user approves this (with changes), it becomes `PHASE-3-DESIGN.md`, its decisions are logged in SYSTEM-DESIGN section 11 (D23 onward), and a `WORKPLAN-PHASE-3.md` turns section 7 into tasks.

Marks: **(proposed)** is my recommendation for the user to accept or change. **(changes a decision)** means it differs from something SYSTEM-DESIGN already decided, so it needs a new log entry.

It assumes phase 2 is closed and builds on three tasks of [WORKPLAN-PRE-PHASE-3.md](../Workplans/Proposals/WORKPLAN-PRE-PHASE-3.md): 2.14a (a second site), 2.14c (`schema.json` v2) and 2.14d (`cms-contract`). The reasons behind the scope are in [SYSTEM-DESIGN-AUDIT.md](SYSTEM-DESIGN-AUDIT.md).

## 1. Intent

Phases 1 and 2 built a preview that renders drafts and a server that saves and publishes them. The only way to use them is a page of JSON text areas.

Phase 3 builds **the first version a person can use and a tester can run**: an editor with real forms, on the sample site, started with one command on the tester's own machine.

It is an MVP on purpose. The aim is the smallest editor that covers every field of the sample without JSON, so that the product can be shown, tried and criticized. Where a complete answer is expensive, the MVP takes a simple one with a documented limit, and says so in the editor.

### Done when

1. **Editing without JSON.** On the sample site, a person who is not a developer changes a text, an image, a list of blocks (add, remove, reorder), a reference and a Markdown post body, saves and publishes, using forms only. A browser test covers the mechanics. One session with a real non-developer covers the rest `[user]`.
2. **Nothing is uneditable and nothing is silently changed.** A test walks every field of every editable sample document: each gets a typed widget or the JSON fallback (5.3). Opening a document and saving it without an edit sends nothing.
3. **Drafts survive a reload.** Close the tab mid-edit, reopen: the drafts are back, and a draft whose document changed underneath is flagged.
4. **The preview is correct on pages with script widgets.** After an edit on `landing/home-v2`, the three carousels work.
5. **A fresh machine reaches a working editor from the quick start,** on Windows and on macOS or Linux, with the time measured `[user]`.
6. **Ready for phase 4:** the checklist of section 8 holds.

## 2. Goals, non-goals, anti-goals

**Goals**

- An editor SPA on the CMS origin that replaces the test editor.
- Forms generated from `schema.json` v2, with a fallback for anything the generator does not know.
- Drafts in `localStorage`, live preview, save and publish with every answer of the API shown in plain words.
- Click a text in the preview, land on its field.
- The preview fixes that a first-time user would hit (audit finding A4).
- One-command local start, a quick start, and a way to report a problem.

**Non-goals (later, with where they go)**

| Item | Goes to | Note |
|---|---|---|
| Restricted MDX renderer (D11) | after the MVP, still phase 3's backlog | **(changes a decision)**: D11 planned it for phase 3. The limit `mdx-body` stays: "body preview after save". The sample has one MDX file |
| Markdown plugins without the whole config (D2) | phase 5 preparation | **(changes a decision)**: it is a memory lever for many tenants, and changes nothing for one local user |
| Rich-text (WYSIWYG) editing of Markdown | later | The MVP edits Markdown as text, with a live preview next to it, which is the product's point |
| Uploads into `public/` string fields, with a picker | later, if testers ask | D22 stands: text fields |
| Delete dialog that rewrites references | later | The MVP shows the referrers and explains; the API already supports the rest |
| Hover outlines and other region affordances | later | Regions are frozen (audit A13), if the user agrees |
| Island reset by a block inserted before it, the 60 px scroll shift (D6) | later | Stay as pinned limits |
| Auth, container, webhooks | phase 4 | |
| Server drafts, several editors, locks | phase 5 | |
| Writing to a renamed document's new path (audit A18) | later | The 2.10j warning stays |

**Anti-goals**

- A field the editor cannot show blocks the document, or is dropped on save.
- The editor needs a setting in the site's own repo to work. Hints are optional and live in the site config.
- An editor dependency reaches the preview node or the site build.
- A tester needs to understand git, the bundle or the overlay to try it.
- The editor grows a second source of truth for anything the server already knows (the changeset, revisions, the build state).

## 3. Constraints

Unchanged from SYSTEM-DESIGN and the README: TypeScript with no build step on the server, one test file per source file, LF only, Zod at boundaries, hostile keys, the import rules of decision 4.

New for this phase:

- **The editor is browser code and needs a bundler.** `cms-server` already bundles `editor.ts` with rolldown at start-up (`src/editor/page.ts`). The MVP keeps that: no dev server, no second toolchain.
- **Memory.** Bundling at start-up must not move `cms-server`'s rest figure much. Measure it against 2.13a-1 and, if it does, bundle once into `.cms/` and serve the files.
- **The preview renders only valid drafts.** A draft that fails the schema answers `422`, so while a required field is empty the preview keeps the last good render. The editor must make that state obvious (5.5).
- **Gates:** the profile of 2.14i, if accepted. Logic modules under the mutation gate, views under the browser suite.

## 4. The shape

```text
 CMS origin (cms.localhost)                         preview origin (preview.localhost)
 ┌───────────────────────────────────────────┐      ┌──────────────────────────────┐
 │ editor SPA                                │      │ site page + bridge           │
 │ ┌───────────┐ ┌────────────────────────┐  │      │                              │
 │ │ side panel│ │ preview frame          │◀─┼──────┼─ ready / rendered / click    │
 │ │ documents │ │ <iframe>               │──┼──────┼▶ draft { documents, media }  │
 │ │ of this   │ └────────────────────────┘  │      └──────────────┬───────────────┘
 │ │ page;     │  status bar: saved changes, │                     │ POST /__preview/render
 │ │ forms     │  build state, messages      │                     ▼
 │ └───────────┘                             │              preview node (unchanged
 │   model: field tree, draft store          │              but for step 3.2)
 │   api: cms-contract client                │
 └──────────────┬────────────────────────────┘
                │ /api/*  (unchanged but for small additions, 5.8)
                ▼
            cms-server
```

The server side barely moves. Phase 3 is an editor, three changes in the bridge, and packaging.

### How a session goes

1. The editor loads, asks `GET /api/preview-url?path=/` and shows the site in the frame.
2. **The preview is the navigator.** The user browses the site inside the frame; links work. On each page the bridge announces `ready { path }`, the editor answers with the overlay, and the render answers with the documents that page read.
3. The side panel lists those documents. The user opens one and gets its form.
4. Each change updates the draft store, which sends the overlay to the bridge after 120 ms. The preview patches.
5. Save sends the dirty documents. Publish sends the saved changeset. The status bar shows what the server says.
6. A second view, **Content**, lists collections and their entries, for documents no page links to, and for creating and deleting.

Page-first navigation needs no list of routes and no mapping from documents to pages: the render's read log already says which documents a page uses.

## 5. The parts

### 5.1 Framework and package (proposed; D23 if accepted)

| Option | Trade-off | Verdict |
|---|---|---|
| **A. Preact with signals, bundled by rolldown** | About 5 KB with signals. JSX is compiled by the bundler already in the server. Signals fit a draft store that many fields read. Tests run under happy-dom, as today | **Recommended** |
| B. Stay with plain DOM code | Nothing new, but nested forms (arrays of unions of objects) by hand is where bugs breed, and `editor.ts` is already 567 lines for text areas | Rejected |
| C. React | Familiar and proven; about ten times the size; the workspace's React belongs to the sample site, and the editor should not share a version with a tenant's site | Fallback if A disappoints |
| D. Svelte 5 | Small output, pleasant forms; needs its compiler in the bundle step and in the test run | Rejected for now |
| E. Astro or SvelteKit in server mode | A second build and server, and D17 already weighed and declined it for phase 2 | Rejected |
| A form library (RJSF and similar) | Fast start; poor fit for block lists and discriminated unions, and its markup is hard to restyle | Rejected: write the field renderer |

A new workspace package, **`cms-editor/`**, holds the SPA. `cms-server` bundles and serves it, and never imports it. A dependency-cruiser rule: `cms-editor` imports only `cms-contract` and `preview-protocol`.

```text
cms-editor/
├─ src/
│  ├─ api/        api.ts, messages.ts, media.ts, status.ts   (from 2.11c and 2.11d, moved here)
│  ├─ model/      field-tree.ts, draft-store.ts, paths.ts, persist.ts
│  ├─ preview/    controller.ts (protocol, debounce, newest wins), focus.ts
│  ├─ ui/         fields/*, panels/*, app.tsx
│  └─ strings.ts  every user-facing text, in English
└─ test/          browser journeys
```

### 5.2 From `schema.json` to a field tree

A pure function turns a collection's schema (with 2.14c's markers and `ui` hints) into a tree of field nodes. The view renders nodes; it never reads JSON Schema.

| Schema | Node | Widget |
|---|---|---|
| `string` | `string` | one-line input |
| `string` with `ui.widget: 'textarea'`, or a value with a line break | `text` | multi-line |
| `string` with `ui.widget: 'markdown'` | `markdown` | monospace text area |
| `string` with `enum` | `enum` | select |
| `cms: 'date'` | `date` | date input, written back in the file's own form |
| `cms: 'image'` | `image` | thumbnail, upload, clear |
| `cms: 'reference'` | `reference` | select filled from `GET /api/documents?collection=` |
| `number`, `integer` | `number` | number input |
| `boolean` | `boolean` | checkbox |
| `array` | `list` | items with add, remove, move up, move down |
| `object` | `group` | collapsible section |
| `oneOf` with a discriminator | `union` | "add block" menu by type; each item shows its type's fields |
| anything else, or a collection whose schema failed to export | `json` | the fallback of 5.3 |

- **Labels:** `ui.label`, else the key made readable (`meta_title` becomes "Meta title").
- **Order:** the schema's property order.
- **A document's name in lists:** `title`, else `name`, else the first string field, else the id.
- **The body** of a Markdown or MDX document is one more `markdown` node, outside `data`. For MDX the form says "body preview after save".
- **Build-time fields** (D1) carry an "applies after rebuild" note, from `buildTimeFields`.
- **Read-only documents** (`editable: false`) open with every widget disabled and the reason shown.

### 5.3 The JSON fallback

The rule that makes an MVP safe: **any node the generator does not understand becomes a small JSON editor for that field alone.** The rest of the document keeps its typed widgets.

- The fallback parses on each change; invalid JSON keeps the last valid value in the draft and shows the error under the field.
- A value that does not match its node (a string where the schema says object) also falls back, for that field, with a note.
- Keys present in the file but absent from the schema are kept and shown under "Other fields" as JSON. The codecs already preserve them; the editor must not drop them when it rebuilds the value.

This is what lets "done when" item 2 be a test and not a hope.

### 5.4 Drafts

- **Store:** one entry per document key: `{ baseRevision, value, dirty }`. Signals, so a field re-renders only when its own path changes.
- **Persistence:** `localStorage`, key `avc:<site>:<document key>`, written after a pause in typing. If the quota is hit, the store goes on in memory and the status bar says drafts are not being kept.
- **On load:** each stored draft is checked against the server's revision. Same revision: restored. Different: restored and flagged "changed since you started", with "keep mine" and "discard mine". This is the same choice a `409` offers at save, shown earlier.
- **The overlay sent to the bridge** is `GET /api/overlay` merged with the dirty drafts, drafts winning; the media map likewise. This is the test editor's rule, kept.
- **Undo:** the browser's own, per field. A "discard changes" per document. Nothing more in the MVP.

### 5.5 Validation and the frozen preview

- The render route already validates every draft and answers `422` with field paths. With a 120 ms debounce that is live validation, so the MVP adds **no client-side schema validator**. The editor checks only `required`, so an empty required field is marked before the round trip.
- A `422` maps each path to its field (`messages.ts`), opens the group that holds it, and puts the preview in a visible "showing the last valid version" state until a render succeeds.
- A save's `422` uses the same mapping, so an error looks the same wherever it comes from.

### 5.6 Preview fidelity (changes in the bridge)

Three changes, in `preview-render-server/src/client/`. They are the part of the phase that touches phase 1 code.

1. **No patch when nothing differs.** If the envelope the editor sends is empty (no documents, no media), the bridge still renders, to learn the page's documents, but does not patch. The built page already is the saved content. After a publish and its rebuild this is the usual first load, and it is the load that breaks script widgets today.
2. **A reload mode for script-dependent pages.** `patch.ts` morphs. Morphing cannot bring a script-initialized widget back. For pages (or regions) marked `reload` in the site config, the bridge replaces the whole document with the rendered one, so every script runs as on a normal load.
   - **Spike first (step 3.2a).** Two ways to do it: write the rendered HTML into the frame's document, or navigate the frame with a form post to a render route that answers a full document. Pick by what survives hydration and view transitions on the sample.
   - **A baseline, not the live DOM.** After a reload the bridge keeps the HTML it loaded from and compares the next render with that, not with a DOM that scripts have changed. Equal means do nothing. This is the comparison D6 wanted; a component that prints a random class on every render makes each edit a reload, which is slower and still correct.
   - **A longer pause** before a reload render (about 600 ms) so typing does not flicker.
   - **A "Reload preview" button** in the editor, always there, for pages nobody marked.
   - Marking is manual in the MVP. Detecting it (a `MutationObserver` between load and the first patch) is a later refinement.
3. **JSON-LD and `define:vars` scripts are replaced, not appended** (D6's own planned fix). A long session then no longer leaves stale structured data in the page.

The bridge's debug log goes behind a flag (carried from task 1.6a).

### 5.7 Click-to-focus

- **In the bridge:** an "edit clicks" mode, switched by the editor. While on, a click does not navigate; the bridge sends `preview:click { text, tag }` with the clicked element's own text.
- **In the editor:** find the string fields of the page's documents whose value equals the text, or contains it. One match: open that document, scroll to the field, focus it. Several: list them. None: say so.
- No change to the site and no marker in the HTML. It works for text, which is most of what people click. Images and structure are not covered in the MVP.
- This adds a message, so `PROTOCOL_VERSION` goes up and old bundles rebuild once (D14). That exercises the mismatch path for the first time with a real change, and is the moment to add 2.14k's reserved `base` field.
- **Later, if text matching proves weak:** carry field paths in the render itself (invisible markers in string values, the "stega" technique of other visual editors). It is more exact and it can break string comparisons in site code, so it is not for the MVP.

### 5.8 Server additions

Small, and all in `cms-contract` first:

- `GET /api/documents?collection=` answers a display name per entry (5.2's rule, computed server-side so lists do not load every document).
- `GET /api/site`: the site's name, the preview origin, the editor's settings from the site config, and the versions. One call at start instead of four.
- `GET /api/diagnostics`: what a problem report needs and nothing else: versions, the bundle's identity, the build and sync state, the last errors. No content, no paths outside the site, no secrets.

No route changes shape.

### 5.9 Running it and sharing it

The audience is a tester on their own machine.

- **`npm run demo`:** one command at the repo root. It checks the prerequisites, makes a local bare remote from `sample-site` (today's `dev:remote`), builds, starts, and prints the URL. A second run reuses what exists.
- **`npm run doctor`:** Node version, git version, the two host names resolving, the ports free, the remote reachable. Each failed check prints the fix.
- **`QUICKSTART.md`:** prerequisites, the one command, a five-minute tour (edit a text, add a block, upload an image, save, publish, see the commit), the known limits, and how to report a problem.
- **Supported browsers** are stated from 2.14e's result. Without it: Chromium-based browsers, and Firefox once checked.
- **"Report a problem"** in the editor downloads the diagnostics as a file for the tester to send. Nothing leaves the machine by itself.
- **Your own site** is described as experimental, with the compatibility list of 2.14a and the dependency rule of 2.14b.
- **A release** is a git tag and release notes. No npm package and no container: that is phase 4.

## 6. Measured at the end of the phase

- Editor bundle size, raw and compressed. Set a budget from the first build, then gate it like the render budgets.
- Time from a keystroke to the patched preview, end to end in the browser, on `landing/long`: median and p95, against the existing 60 ms and 100 ms.
- `cms-server` rss at rest with the editor served, against 2.13a-1.
- Time for a first-time tester to get from a clone to an edit, on two operating systems `[user]`.
- `npm run measure:listing` (D7's review at the start of phase 3, as decided).

## 7. Steps

Sized as steps, not tasks; the work plan splits them.

| Step | Work | Depends on | Notes |
|---|---|---|---|
| 3.0 | Package `cms-editor`, the bundle step in `cms-server`, guardrails, the gate profile | 2.14d, 2.14i | The QUALITY-TOOLING checklist for a new package, from the first commit |
| 3.1 | Field tree and draft store (pure, no view) | 2.14c | The core; fully under the logic gates |
| 3.2 | Preview fidelity: 3.2a reload spike, then the three bridge changes | none | Renderer side; can start on day one, beside 3.0 and 3.1 `[build]` |
| 3.3 | The shell: frame, page documents panel, status bar, preview controller | 3.0 | The test editor's message handling, moved |
| 3.4 | Field widgets: scalars, then list and group, then union, image, reference, the JSON fallback | 3.1, 3.3 | The widgets are independent of each other and parallelize |
| 3.5 | Save, publish, changeset panel, conflicts, drafts restored | 3.3, the modules of 2.11c and 2.11d | Mostly wiring |
| 3.6 | Content view: collections, create, delete with referrers | 3.4 | |
| 3.7 | Click-to-focus and the protocol bump | 3.3, 3.2 | One protocol change for the phase |
| 3.8 | `demo`, `doctor`, quick start, diagnostics | 3.5 | |
| 3.9 | Done-when tests, the non-developer session, measurements, documents | all | `[user]` `[build]` |

```text
 3.0 ─▶ 3.3 ─┬─▶ 3.5 ─▶ 3.8 ─┐
 3.1 ────────┼─▶ 3.4 ─▶ 3.6 ─┼─▶ 3.9
 3.2 ────────┴─▶ 3.7 ────────┘
```

**A first usable cut** is 3.0, 3.1, 3.3, the scalar widgets of 3.4 with the fallback, and 3.5. At that point every sample document is editable (through typed fields or the fallback) and can be saved and published. Show it to the user then, before the rest: it is the earliest moment the product can be judged, and what is learned there should reorder 3.4, 3.6 and 3.7.

## 8. Ready for phase 4

Phase 4 is the container, auth and webhooks. The MVP should leave it nothing to undo:

| Phase 4 needs | Phase 3 leaves |
|---|---|
| Serving the editor from one image | The editor is static files that `cms-server` serves; no dev server, no second process |
| Sessions and one admin account | One middleware sets the `actor` (2.14j); the editor's `api.ts` handles a `401` in one place |
| A session cookie safe from site code | The origins rule and the `Origin` check of 2.14e; the Safari answer from its spike |
| A site with its own dependencies | The decision of 2.14b, and no new code in phase 3 that assumes the workspace's packages |
| Surviving a container restart | All state under `.cms/<site>/` and the browser; the backup-ref decision of 2.14l |
| Configuration from the environment | `GET /api/site` is the editor's only source of settings, so the server can read them from anywhere |
| Bundles that move between machines | Unchanged from phase 2; phase 3 adds nothing to the bundle but `schema.json` v2 and the bridge changes |

## 9. Risks

| Risk | Likelihood | What it would cost | Answer |
|---|---|---|---|
| `schema.json` cannot express a pattern the sample uses | Medium | Fields fall back to JSON; the MVP looks unfinished there | 2.14c before the phase; the fallback keeps it working; each fallback hit on the sample is a listed gap |
| The reload mode fights hydration or view transitions | Medium | Script pages stay broken after edits | The 3.2a spike decides the mechanism early; the "Reload preview" button is the floor |
| Text matching for click-to-focus is too often ambiguous | Medium | The feature feels unreliable | List the matches instead of guessing; the marker approach is the stated next step |
| Forms for deep block lists are slow | Low | Typing lags on `landing/long` | Signals keep updates local; measure in 3.4 on the 44-block page |
| `localStorage` fills on a large changeset | Low | Drafts are not kept | Detected and said; drafts are per document, so only dirty ones are stored |
| Testers cannot run it | High without 2.14a, 2.14e, 2.14g | No feedback at all | The three pre-phase tasks, `doctor`, a stated browser and OS list |
| The MVP's cuts are mistaken for the product's limits | Medium | Wrong feedback | The quick start lists what is cut and why; `limits` are shown in the editor in plain words |

## 10. For the user to decide

1. The MVP scope, in particular the two **(changes a decision)** rows: the restricted MDX renderer and D2's plugin setting leave phase 3.
2. Preact with signals, in a new `cms-editor` package (5.1).
3. Page-first navigation with a Content view beside it (4).
4. Click-to-focus by text matching for the MVP (5.7).
5. The reload mode with manual marking (5.6), after the 3.2a spike reports.
6. English strings in one module, Spanish later (audit, decision 8).
7. Whether the first usable cut (section 7) is a formal checkpoint with the user.

## 11. Left to the builder

- File names inside `cms-editor/`, and whether the bundle is made at start-up or once into `.cms/`.
- The look: one stylesheet, no component library, system fonts. It should be plain and legible, not designed.
- The debounce values, within "typing does not flicker".
- How the status bar words each state, as long as every string is in `strings.ts`.
- The order of the widgets in 3.4, after the scalars and the fallback.
