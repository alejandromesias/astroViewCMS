# System design audit

Written 2026-11-15, with `main` at `7dd6bff` (waves 1 to 10 of phase 2 closed). Status: **a consultant's review, not a decision.** Nothing here changes [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) until the user accepts a finding and it is logged there.

It reviews the system design and what phases 0, 1 and 2 (up to wave 10) built. The proposals that follow from it are in three other documents:

- [WORKPLAN-PRE-PHASE-3.md](../Workplans/Proposals/WORKPLAN-PRE-PHASE-3.md): what to revisit before phase 2 closes or phase 3 starts.
- [WAVES-11-14-REWRITE.md](../Workplans/Proposals/WAVES-11-14-REWRITE.md): a reordered tail for phase 2.
- [PHASE-3-DESIGN-PROPOSAL.md](PHASE-3-DESIGN-PROPOSAL.md): phase 3 as an MVP that can be shared.

**Basis.** I read SYSTEM-DESIGN.md and PHASE-2-DESIGN.md in full, the open tasks and sections 1 to 3 and 5 to 7 of WORKPLAN-PHASE-2.md, section 10 of WORKPLAN-PHASE-0-1.md, the README and the last two handoffs. I sampled the code to check specific claims; I did not review it line by line. Each finding says whether it is **verified in code** or **from the documents**.

## 1. Verdict

The architecture is sound and I would not change its core. The five decisions (document, page, region, read-only preview node, changeset) are the right units, and the code kept to them through ten waves, which is rare.

The main weakness is not in the architecture. It is in what has been proven so far:

- **Technical risk is retired, product risk is untouched.** After two phases the only editor is a set of JSON text areas. No one who is not a developer has used the product.
- **It has only ever run one site.** `sample-site` is a workspace member and builds with the workspace's packages. "Works against a real remote" is proven; "works against someone else's Astro site" is not.
- **The preview's known limits are larger than they read.** A page with a script-initialized widget is broken by the first render after load, before any edit.
- **The process is heavy for the stage.** A 390 KB work plan and a mutation gate on a throwaway test editor cost more than they return now.

None of these needs a redesign. They need a different order of work, which the three other documents propose.

## 2. Scorecard against the product goals

| Goal (SYSTEM-DESIGN, in the user's order) | State | Comment |
|---|---|---|
| 1. Affordable and convenient to self-host | Affordable: on track. Convenient: unproven | About 100 MB for an idle preview node against 650 MB for `astro dev`. `cms-server`'s own memory is still unmeasured (2.13a). Convenience needs a site that is not in the workspace, and a one-command start; neither exists (findings A2, A12) |
| 2. A visual preview in the editor | The render path is strong; fidelity has holes | 2 to 17 ms renders, whole-page overlay, morph patching. Holes: script widgets, MDX bodies, JSON-LD piling up (A4) |
| 3. Scalable to many tenants | Design only, as planned | The interfaces are kept tenant-ready on paper. Two seams should be cut now while it is cheap (A9, A10) |
| 4. Lightweight with many tenants editing at once | At risk | 200 to 280 MB per active site, so 11 to 13 sites on a 4 GB host. The levers that lower it (D2's plugin setting, idle stop) are unbuilt, and the overlay travels whole on every keystroke (A8) |

## 3. What is strong and should stay

- **The units.** Document for editing and saving, page for rendering, changeset for publishing. The rule "a function keyed by a region outside rendering is in the wrong place" is the kind of test a design needs.
- **The preview node is read-only, stateless and behind a process boundary.** `cms-server` never imports site code. This is what makes phase 5's sandboxing possible at all.
- **Re-apply per document instead of `git rebase`.** No conflict state to get stuck in, and the changeset state lives in git itself (base revisions derived, overwrites in commit trailers) with no side file to drift.
- **Measured, dated claims.** Nearly every number in the design has a date, a method and a script that repeats it. The decision log records corrections instead of rewriting history.
- **Contracts at the boundaries.** `preview-protocol` and `preview-contract` as leaf packages, Zod on every request, dependency-cruiser rules that mirror decision 4.
- **Honest limits.** Known gaps are pinned by tests (`GAP` tests, `limits` in the render answer) instead of being hidden.

## 4. Findings

Severity: **High** blocks the MVP or a later phase; **Medium** costs real work later if left; **Low** is hygiene. "Where" says which proposal picks it up.

| # | Finding | Severity | Basis | Where |
|---|---|---|---|---|
| A1 | No real user has used the product; the real editor is the last thing built | High | documents | Phase 3 proposal; waves rewrite (manual run moved forward) |
| A2 | Only a workspace-member site has ever run | High | documents and code | Pre-phase 3, 2.14a and 2.14b |
| A3 | `schema.json` is not ready to drive forms | High | code | Pre-phase 3, 2.14c |
| A4 | Preview fidelity: priming breaks script widgets | High | documents | Phase 3 proposal, step 3.2 |
| A5 | The publish, sync and build flow has no single model | Medium | documents | Waves rewrite, 2.10e-B |
| A6 | No shared API contract; error codes live in work plan prose | Medium | code | Pre-phase 3, 2.14d |
| A7 | The example config contradicts the local-origins decision | Medium | code | Pre-phase 3, 2.14e |
| A8 | The whole overlay travels on every keystroke | Medium (phase 5) | documents | Pre-phase 3, 2.14k (reserve the field only) |
| A9 | Saved work exists only in one local clone | Medium (phase 4) | documents | Pre-phase 3, 2.14l (decide); phase 4 builds it |
| A10 | Single-site and no-auth assumptions have no named seam | Medium | not verified; check | Pre-phase 3, 2.14j |
| A11 | Astro internals are used with no early warning | Medium | code | Pre-phase 3, 2.14f |
| A12 | Browser and OS coverage is Chromium and Linux CI, Windows weekly | Medium | code | Pre-phase 3, 2.14e and 2.14g |
| A13 | Regions are carried but unused by the sample | Low | code | Decision for the user (section 6) |
| A14 | Throwaway work under full gates: the test editor | Medium | documents and code | Waves rewrite, 2.11c and 2.11d |
| A15 | The work plan is too large to be a working document | Medium | code | Pre-phase 3, 2.14h |
| A16 | Three small files have sat under the mutation floor for five waves | Low | documents | Waves rewrite, 2.13d |
| A17 | Documents trail the code | Low | documents | 2.13b, widened |
| A18 | Identity is the file path: an upstream rename duplicates a document | Low for the MVP | documents | Phase 3 backlog |
| A19 | Docs pushes bypass branch protection and can leave `main` red | Low | documents | Pre-phase 3, 2.14m |

### A1. No real user has used the product

Roadmap order is preview, then server, then editor. That retired the hard technical risks first, which was right for phase 1. But phase 2's "done when" is machine-checked end to end, and the one manual run (2.12c) is the last task of the last wave. The editor today is one JSON text area per document (`cms-server/editor/index.html`), with no draft persistence.

The risk: whether a non-developer can edit a page is the product. Problems of that kind (how blocks are added, what a reference looks like, what happens when a field is invalid mid-typing) change API shapes, and they are found late.

Proposal: move a first manual run forward, and make phase 3 an MVP that reaches a tester quickly instead of a complete editor.

### A2. Only a workspace-member site has ever run

PHASE-2-DESIGN section 3 says the working copy lives in `.cms/` inside the workspace and uses the workspace's packages; installing a site's own dependencies is phase 4. `sample-site` is in the root `package.json` workspaces, and both it and `preview-render-server` ask for `astro ^7.4.5`. The site's CMS settings are split across two files in this repo (`cms.config.ts` and `preview-render-server/sites/<site>.config.ts`).

So three things are unproven: a site with dependencies the workspace lacks, a site on another Astro minor, and a site whose structure differs from bigspring's. The first one decides how phase 4's container is built, because the standard answer (the preview integration is a package installed into the site) conflicts with the "one shared Astro" setup that phase 1 kept on purpose.

This is the item most likely to hurt if left to phase 4. A two-day spike against one unrelated site answers most of it.

### A3. `schema.json` is not ready to drive forms

Checked in `cms-server/test/fixtures/bundle/schema.json`, the `blog` collection:

- `date` is exported as `{}`. `unrepresentable: 'any'` drops the type, so a form cannot tell it is a date.
- No labels, descriptions or widget hints. The sample must stay free of CMS config, so hints need a home in the site config.
- `image` (a `public/` path) and `cover` (an `image()` field) are both strings; only the second has a marker. D22 covers this, but a form needs to know a string is a path, long text or Markdown.
- Discriminated unions arrive as `oneOf`. A block picker needs the discriminator key and each branch's name stated, not inferred.

Phase 3 is "forms from `schema.json`", so this file is its foundation. It is produced by the renderer at build time, so changing it changes the bundle. Better done once, before the editor is written against it.

### A4. Preview fidelity: priming breaks script widgets

D6 records that the first render after load morphs script-initialized markup back to server markup: the three Swiper carousels on `landing/home-v2` go from initialized to not, and stay broken until a reload. This happens on load, before any edit, so the preview is worse than the static page it replaced.

Carousels, mobile menus and accordions driven by a component `<script>` are common in marketing templates, which is the target market. A tester will hit this in the first minute. The other limits (piling JSON-LD and `define:vars` scripts, an island reset by a block inserted before it, no live MDX body, a 60 px scroll shift) matter less, in about that order.

Two cheap rules remove most of it: skip the priming patch when nothing differs from the bundle, and reload the document instead of morphing when a page is marked script-dependent. The phase 3 proposal specifies both.

### A5. The publish, sync and build flow has no single model

`POST /api/publish` can answer `200`, `409` (three codes once 2.10e lands), `422`, `424`, `502` and `503` (four codes). The flow grew through review rounds: retries on push races, a lock released during the rebuild wait, and with 2.10e a build that runs with no lock held while saves, syncs and the poll loop continue.

Each rule is reasonable. What is missing is one place that lists the states (`idle`, `syncing`, `validating`, `building`, `pushing`, `reconciling`), the events, and the invariants that must hold across them. Without it, 2.10e's unlocked window is reviewed against prose spread over four task entries. The rewrite asks for that table and a test that drives random event orders against it, as part of 2.10e.

I am not proposing to change the flow the user settled on 2026-11-13. I am proposing to write it down as a state machine before building its hardest part.

### A6. No shared API contract

The render envelope and the manifests have Zod schemas in `preview-contract`. The CMS API does not: response types are defined inside `cms-server/src` (for example in `sync/publish.ts` and `save/context.ts`), and the catalogue of error codes exists only as prose in the work plan. The editor imports `RenderRequest` from `preview-contract` and nothing for the CMS routes.

A real editor needs a typed client and one list of errors to show. Phase 5 needs the same list to add `/sites/:site`. A small `cms-contract` package (or an entry point in `preview-contract`) fixes both, and the route table of `CMS-SERVER.md` can be generated from it.

### A7. The example config contradicts the local-origins decision

PHASE-2-DESIGN 5.7 decides on `cms.localhost` and `preview.localhost`, because cookies ignore the port. `cms.config.example.ts` ships `http://127.0.0.1:4400` and `http://127.0.0.1:4401`: one host, two ports.

With that config the previewed site's scripts are same-site with the CMS, and `crossSiteRefusal` in `http/guard.ts` only refuses `Sec-Fetch-Site: cross-site`. Today the damage is nil: there is no CMS cookie to steal, and the JSON content type forces a CORS preflight that the server never answers. In phase 4 a session cookie arrives, and it would be shared with site code on the other port.

Fix now: the example uses the `.localhost` hosts, start-up warns when the two origins share a host, and write routes also check the `Origin` header against `origins.cms`.

### A8. The whole overlay travels on every keystroke

Decision 4 makes the node stateless, so each render request carries every document that differs from the bundle: drafts, plus everything saved since the last build. Measured worst case on the 200-post sample: 1.06 MiB.

Locally this is free. In phase 5 the request crosses the internet from the browser to a preview host, on each debounced keystroke. The usual case is small because a publish rebuilds the bundle, but a site that saves for a week without publishing pays it.

The fix keeps the node stateless in the sense that matters (no source of truth): the node may keep a soft cache of base overlays by hash, the request sends `{ base: <hash>, documents: <drafts only> }`, and a miss answers "resend in full". Nothing to build now. Reserve the optional `base` field in the envelope's next version so it is not a breaking change later.

### A9. Saved work exists only in one local clone

A save is a local commit on `cms/work` that is never pushed. Losing `.cms/<site>/repo/` loses every unpublished save. On a developer's laptop that is acceptable. In phase 4's container it means a restart without a volume destroys an editor's work.

A cheap remedy that fits the git model: push `cms/work` to a hidden ref on the remote (`refs/cms/work`, which no host deploys and no branch list shows) after a save or on a timer, and restore from it at start-up. It also becomes the hand-over point between two instances later. Decide now, build in phase 4.

### A10. Single-site and no-auth assumptions have no named seam

I did not verify how `run.ts` and `http/app.ts` hold the site's state. The routes are registered with `bundle`, `workingCopy` and `repo` passed in, which is a good sign. Two things are worth a check before the editor is built on top:

- one **site context** object that every route receives, so `/sites/:site` in phase 5 is a mount, not a rewrite;
- an **actor** on every write (today a constant: the local user and `git.author`), set by one middleware, so phase 4's sessions replace one function.

### A11. Astro internals are used with no early warning

The renderer imports `astro/container` (experimental), `astro/runtime/server/index.js`, `virtual:astro:manifest` and `virtual:astro:renderers`, replaces `virtual:image-service`, and rewrites `astro:content` imports with a `post` transform. That is the cost of the design and it is accepted.

What is missing is a signal. On 2026-11-13 an advisory forced an Astro bump within a day. No workflow runs the suite against the next Astro release (checked: `.github/workflows/` has none). A weekly, non-blocking run of the e2e suite on `astro@latest` and the next pre-release turns a surprise into a week's notice.

### A12. Browser and OS coverage

CI is Ubuntu, with a weekly Windows job; development is on Windows. No macOS run exists, and the tree-kill on Windows is pinned by a unit test only. The preview cookie is proven in Chromium only; a WebKit smoke test dropped it in every variant, so Safari is expected to fail, and Firefox is untested.

For anything shared with testers this decides who can try it. The Safari fallback is planned for phase 4, but one variant is cheap to try now: `cms.avc.localhost` and `preview.avc.localhost` share the registrable domain `avc.localhost`, so they are same-site and a `SameSite=Lax` cookie needs no third-party cookie support. Whether Safari resolves those names needs a real Mac.

### A13. Regions are carried but unused by the sample

`preview-render-server/sites/sample-site.config.ts` declares `regions: {}`. Every preview on the sample runs through the body morph. Region code is unit-tested, but nothing on the rich sample exercises it.

Decision 3 made regions optional, and the measurements show the body morph is fast enough. So either mark two or three regions in the sample to keep the path honest, or freeze the feature: keep the code, add nothing, and bring it back when a real page shows a problem the morph cannot solve. I would freeze.

### A14. Throwaway work under full gates

2.11c and 2.11d add Save and Publish to the test editor, with a unit test per response and an 80% per-file mutation gate on `editor.ts` (2.11e). Phase 3 replaces that editor.

The logic is not throwaway: calling the API, mapping each answer to a message, swapping staging URLs after a save. If those live in framework-free modules, phase 3 imports them unchanged and only the thin DOM glue is discarded. The rewrite restructures the two tasks that way.

### A15. The work plan is too large to be a working document

WORKPLAN-PHASE-2.md is 390 KB. Its status row is one table cell of about 3,000 characters. The handoff of 2026-11-09 records agents running out of context on reading lists. Every session pays to load history it does not need.

Split it: a live plan (status, open tasks, done-when map) and a log of finished task bodies. Give phase 3's plan a size rule from the start.

### A16 to A19. Smaller items

- **A16.** `preview-contract/src/schema.ts` (57%), `preview-render-server/src/bundle.ts` (45%) and `overlay/errors.ts` (57%) are small files that have been listed under the floor since wave 6. Repeating them in every status line costs more than fixing them. One task.
- **A17.** SYSTEM-DESIGN's phase table says phase 2 is "not started", its section 7 describes pre-phase-1 code, and README section 5 documents the phase 1 start command and `/__editor`, with no way to start `cms-server`. 2.13b covers most of it; add a quick start.
- **A18.** A document renamed upstream and edited in the CMS is recreated at its old path (accepted limit, warned by 2.10j). Fine for the MVP. It becomes a data-quality issue once several people use a site.
- **A19.** The wave 10 close commit reached `main` through the admin bypass with a red check, caused by an advisory published that day. The check was right and the commit was innocent. A time-dependent gate should not judge a docs-only commit: run osv-scanner on a schedule and on pull requests, and let docs-only pushes skip it by path.

## 5. Risk register

| Risk | Likelihood | Impact | Mitigation proposed |
|---|---|---|---|
| A tester's own site does not build under the workspace | High | High: nothing to test | 2.14a spike, 2.14b decision, a stated compatibility list |
| The editor's forms need a schema shape the bundle lacks | High | Medium: bundle and protocol churn mid-phase | 2.14c before phase 3 starts |
| A race in the unlocked build window loses or double-publishes a save | Medium | High: the anti-goal "a CMS user loses saved work" | State table and an event-order test in 2.10e-B |
| An Astro release breaks the Container API path | Medium | High: no preview | 2.14f canary; the internals listed in one place |
| Safari users cannot open the preview | High | Medium for a local MVP | 2.14e same-site spike; state the supported browsers |
| Per-site memory makes multi-tenant uneconomic | Medium | High in phase 5 | Measure `cms-server` early (2.13a-1); keep D2's lever on the phase 5 list |
| Process cost slows phase 3 | High | Medium | 2.14h, 2.14i: smaller plan, gates by code kind |

## 6. Decisions I am asking the user for

Each has my recommendation. None is forced; the proposals mark what depends on them.

1. **Phase 3 as an MVP** with the cuts listed in the phase 3 proposal (restricted MDX renderer and D2's plugin setting move out of phase 3). Recommended: yes.
2. **Editor framework.** Recommended: Preact with signals, bundled by the rolldown already in `cms-server` (phase 3 proposal, section 5.1).
3. **How a site gets its dependencies** (A2). Recommended: decide after the 2.14a spike, not before.
4. **Regions** (A13). Recommended: freeze.
5. **Slim 2.10f**: drop the "same file and message" error comparison (waves rewrite, section 3). Recommended: yes.
6. **Gates for UI code**: mutation gate on logic modules only (2.14i). Recommended: yes.
7. **A hidden backup ref for saves** in phase 4 (A9). Recommended: yes, decide now, build then.
8. **Editor language.** The sample's content is Spanish. Recommended: English strings in one module, so a Spanish table is a small later task.
