# Phase 2 design: `cms-server`, single tenant

Written 2026-10-31. Status: **approved by the user on 2026-10-31**, with every call below. [WORKPLAN-PHASE-2.md](WORKPLAN-PHASE-2.md) turns it into steps and tasks, and the
decisions in section 4 are SYSTEM-DESIGN.md's D17 to D22.

[SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) stays the authority; its roadmap (section 9) links here, and [README.md](README.md) maps every document. This document adds
what phase 2 needs and the design left open. Where they disagree, this one
says so and points to the decision.

Marks used below: **(user)** means the user decided it in the 2026-10-31
conversation. **(call)** means the author decided it, and the user should
check it while reading.

## 1. Intent

Phase 1 built the preview: a read-only node that re-renders whole pages with
draft documents. Nothing can be saved or published yet. Phase 2 adds the
**CMS app** that owns everything the preview node must not own: reading and
writing the site's files, revisions and conflicts, validation before a save,
media, git and publishing, and supervising the preview node.

It's the riskiest code in the system: it holds the git credentials and
writes to the site. So it starts inside the quality guardrails, parses
every request with Zod, and runs no site code in its own process.

Done when (SYSTEM-DESIGN section 9, plus what this design adds):

- Edit two documents, save, reload: the preview shows the saved content
  without a rebuild.
- A save with a stale `baseRevision` answers `409`.
- Publish creates one commit on the remote.
- A developer's push that touches a saved document, then a publish: the
  CMS version reaches the remote, and the commit message names what it
  overwrote (section 4.2).
- Deleting a referenced document is refused unless the same save fixes
  every referrer (section 4.3).
- With `publish.buildCheck` on, a changeset that breaks the build is not
  pushed (section 4.4).
- The test editor runs on the CMS origin and drives the preview on its own
  origin, through the preview token and cookie.
- `cms-server`'s memory at rest and during a session is measured.
- Acceptance **(call):** the e2e suite uses a local bare repo as the remote.
  Once, by hand, the user runs a save and a publish against a throwaway
  GitHub repo with no deploy attached, not against `astroViewCMS` itself.
- **`siteDir` (call):** the site may sit in a subfolder of its repo. Every
  repo path (documents, codec writes, content paths, worktree builds) is
  joined with it from the start, because adding it later touches
  everything.

## 2. Goals, non-goals, anti-goals

**Goals**

- The CMS API of SYSTEM-DESIGN section 4, single tenant, working against a
  real git remote.
- The remote (GitHub) is the source of truth **(user)**. The working copy
  is a cache of it plus the saved changes.
- Two origins with the preview token, `frame-ancestors` and `__Host-`
  cookies (D14).
- Interfaces that phase 5 can keep: the same API with `/sites/:site` added,
  the same bundle layout, the same render contract.

**Non-goals (later phases)**

- Real editor UI, forms, drafts in `localStorage`: phase 3. The phase 1
  test editor is moved and adapted, not redesigned.
- Auth: phase 4. Phase 2 listens on `127.0.0.1` only.
- Push webhooks, container image, `--bundle`: phase 4. Phase 2 polls the
  remote.
- Tenants, a database, object storage, sandboxed build workers: phase 5.
- Field-level merging, live co-editing, locks.

**Anti-goals (a failure even if it works)**

- The preview node writes, holds a credential, or gains a write route.
- `cms-server` imports and runs site code (`content.config.ts`, components)
  in its own process.
- A CMS user loses saved work, or has to understand git, to get past a
  conflict.
- A CMS user's change is held back for a developer to merge **(user)**.
- `cms-server` at rest costs memory comparable to `astro dev` (~650 MB).

## 3. Constraints

From the repo and SYSTEM-DESIGN, unchanged:

- TypeScript without a build step (Node 26 type stripping, `.ts` imports, no
  `enum` or `namespace`). One `*.test.ts` per source file. Comments on every
  function and route. LF only.
- [IMPLEMENTATION-RECOMMENDATIONS.md](IMPLEMENTATION-RECOMMENDATIONS.md):
  hostile keys (`Map`, `Object.hasOwn`, `Object.fromEntries`), validate the
  shape of everything read, guards with visible effects, dependency
  injection with real defaults.
- [QUALITY-TOOLING.md, "Adding a workspace package"](QUALITY-TOOLING.md#adding-a-workspace-package):
  every line of the checklist from the first commit. The guardrails list
  their scope by path, so a package they don't list is unchecked
  (quality-tooling review, 2026-10-29, QUALITY-TOOLING-PLAN.md step 10; this
  and the import rules below were SYSTEM-DESIGN's "Before phase 2").
- Import rules (SYSTEM-DESIGN "Before phase 2"): the renderer never imports
  `cms-server`; only `cms-server` uses `child_process` and git;
  `cms-server` imports `preview-protocol` (and the new contract types,
  section 5.1) but never the renderer's internals.
- `cms-server` starts the renderer's `build.ts` and the preview node as
  **child processes**, never by import. A process boundary is the only way
  the CMS app touches site code.
- **The build folder must be inside the workspace** ([README.md](README.md) section 4, gotchas):
  builds resolve packages from `astroViewCMS/node_modules`. So in phase 2
  the site's working copy lives in the workspace, in a gitignored `.cms/`
  folder, and uses the workspace's packages. Installing a site's own
  dependencies in its working copy is phase 4.
- Memory is tight on the development machine. One build at a time.

## 4. Decisions from the conversation

### 4.1 HTTP layer: Hono plus plain modules (user)

Approaches considered:

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Hono for routing, plain TypeScript modules for the work** | Web-standard `Request`/`Response` like `render/handlers.ts`, about 14 KB, runs with type stripping (no build), Zod validator, cookie helpers with the `__Host-` prefix, secure headers and static serving included. We choose the structure ourselves | **Picked** |
| B. Astro in server mode | Familiar, with middleware, sessions and actions. But the server needs a Vite build, its Astro is tied to the sites' through the shared workspace, and git or process code is clumsier to test through endpoints | Reconsider for the editor shell in phase 3 |
| C. SvelteKit or React Router 7 | Good structure for an editor, but it picks phase 3's UI framework early, ties a webhook-facing API to a UI framework, and adds a build | Rejected for phase 2 |
| tRPC | The API is called by non-TypeScript clients (webhooks, curl), and D10 wants plain HTTP with query keys. Hono's typed client (`hc`) covers the TypeScript case | Rejected |
| Expo Router | For mobile apps | Rejected |

Hono only routes. Each route parses its input with Zod, calls a module and
maps the result to a response. The modules don't import Hono, so they are
tested without HTTP.

Database and auth: **none in phase 2**. Git and files are the store. Phase
4 adds one admin with sessions (`node:sqlite`, which ships with Node, plus
argon2). Phase 5 uses Postgres, with Drizzle or a similar layer, and
evaluates an auth library for tenants and roles **(call)**.

### 4.2 Git: remote is truth, the CMS change wins (user)

**Situation.** A CMS user and a developer changing the same repo at the
same time is treated like two developers pushing to one remote. It's a rare
edge case: in single-tenant use, mostly a developer racing the system on
purpose; in multi-tenant use, a developer pushing a batched update to many
sites while some tenants are editing. The failure goes to the actor who
copes best with it, the developer. On a same-document conflict **the CMS
change reaches the site**; the developer waits, fixes and retries **(user)**.

**Model (call).**

```text
 origin/main ──●────●────────●  (developer pushes)
                \             \
 cms/work        ○ save ○ save  ○' re-applied saves      ○ = local commit, never pushed
                                 \
 publish                          ◆ one commit on top of origin/main, pushed
```

- **Working copy:** `.cms/<site>/repo/`, a clone of the remote. Local branch
  `cms/work`.
- **Save = one local commit** on `cms/work` with the changed files
  (`cms: save pages/home, navbar/navegacion`). Atomic, survives a crash,
  never pushed by itself.
- **The saved changeset** is the set of documents that differ between
  `origin/main` and `cms/work`: each with its saved value, or deleted, plus
  the **base revision** it was saved over.
- **Sync** (a poll of the remote every 60 s while a session is open, and
  always before publish): `git fetch`. If `origin/main` moved, rebuild
  `cms/work` as `origin/main` plus the saved changeset **re-applied per
  document**, not with `git rebase`:
  - for each saved document, write its saved value into the **upstream**
    version of its file with its codec (section 5.4). For a `file()` entry
    only that entry changes, so a developer's edits to other entries of the
    same file survive;
  - a deleted document is removed from the upstream file (or the file is
    deleted);
  - if upstream changed that document since its base revision, the CMS
    value still wins and the document is recorded as **overwritten**, with
    the upstream commit;
  - the result is one local commit, `cms: saved changes (re-applied on
    <sha>)`. If anything outside content paths changed upstream, the
    preview rebuilds (section 4.4).
- **Publish:**
  1. sync;
  2. validate the whole changeset against the preview node that matches
     the new code (section 5.6). **If the developer's new code doesn't
     build (call):** sync already tried to build it (4.4), so that is
     known. The breakage is the developer's, and the host keeps the last
     good deploy, so the CMS change isn't held back. Validate against the
     last good bundle, push, and report `upstreamBuildFailed` in the
     publish answer and in `GET /api/status`. With `buildCheck` set, the
     check compares against upstream alone: it blocks the push only if the
     changeset adds a failure that upstream didn't have;
  3. run the build check if configured (section 4.4);
  4. squash `cms/work` into one commit on top of `origin/main`. The message
     lists the documents, and the overwritten ones with the commit they
     replaced: `cms: publish 3 documents (overwrote pages/home from a1b2c3d)`;
  5. push without force. If the push is rejected because the remote moved,
     go back to step 1, at most 3 times, then fail with a plain error. The
     saves stay saved;
  6. reset `cms/work` to the pushed commit and rebuild the preview, so the
     overlay drops back to empty.
- **Why re-apply instead of rebase:** a rebase resolves conflicts by text
  hunk, and modify or delete conflicts stop it. Re-applying works per
  document, which is the design's unit, and has no conflict state to get
  stuck in.
- **What developers see:** a normal commit on top of theirs. Their version
  stays in the history, and the commit message names it. A comment through
  the GitHub API is optional, phase 4 or later.
- **Schema changes are the exception.** If the developer's push changed a
  schema and the saved content no longer fits, publishing would break the
  site's build. Step 2 catches it, publish stops, and the user gets
  ordinary field errors to fix in the form.
- **Git is the CLI**, run with `child_process.execFile` and fixed arguments,
  never a shell **(call)**. It needs `git` on the machine; a library adds
  dependencies for little gain. Credentials come from the environment:
  the SSH agent, or a token in a credential helper. `cms-server` never
  stores them.

### 4.3 Deleting a referenced document (user, closes D3's TBD)

Whether a dangling reference breaks the site depends on the site's code. In
the sample the author is optional and the template checks for it, so the
build passes and the posts lose their author. A template that reads
`author.data.name` unchecked fails the build. The CMS user can't fix either.

**Decision: block, but the user can resolve it in the same save.**

- `cms-server` keeps a **reference index**: for each document, the documents
  that point at it. It's built by walking each document's data along the
  `reference` markers in `schema.json` (`{ cms: 'reference', collection }`),
  through objects, arrays and `oneOf` branches. No site code runs. It's
  rebuilt at startup, after a sync, and updated on each save.
- `PUT /api/changes` with a deletion answers `409` with
  `{ error: 'referenced-by', document, referrers: [keys] }`, unless the same
  changeset changes or deletes every referrer so that it no longer points
  at the deleted document. The whole changeset is then written as one save.
- Publish runs the check again after its sync, because a developer may have
  pushed a new referrer in the meantime.
- If a referrer is read-only (`editable: false`), the error says it needs a
  developer. There is no force delete in phase 2.
- Phase 3's delete dialog lists the referrers and offers to replace the
  reference, clear it (only if the schema marks the field optional), or
  cancel, then builds the combined changeset. The API doesn't change.

### 4.4 Builds, and the optional build check (user)

The preview build (`build.ts`) is a full `astro build` plus the preview
extras. Content edits and saves never need one, except for build-time
fields (D1). `cms-server` runs a preview build:

| Trigger | Why |
|---|---|
| The site has no bundle yet | first start |
| `origin/main` moved outside content paths (seen by sync) | code changed: markup, CSS, schemas |
| A save touched a build-time field (D1) | build code reads it |
| The bundle's protocol version differs from `cms-server`'s (D14, section 5.6) | old bundle, at most once per bundle id |
| After a publish | keeps the overlay small; free if the build check already ran |

**Build check before push: optional, by configuration (user).**
`publish.buildCheck`:

- `always`: build the candidate commit, push only if the build passes;
- `never`: push at once, rebuild the preview afterwards;
- `auto`, the default **(call)**: build first only when the preview can't
  vouch for the changeset itself:
  - an MDX body changed (the preview never compiles it, D11);
  - a build-time field changed (D1);
  - validating a changed document hit a refinement that threw (D3; see
    5.1 item 9). `cms-server` only calls validate, never render, so
    render-only limits such as `markdown-plugins` are not triggers. A
    Markdown body that renders in the preview runs the same plugins in the
    build;
  - code changed upstream since the current bundle.

The candidate builds in a separate git worktree under `.cms/<site>/`. When
it passes, its bundle becomes the new preview bundle, so a checked publish
costs one build, not two. When it fails, nothing is pushed, the saves stay,
and the user sees "the site wouldn't build" with the first failing file. The
full log goes to `.cms/<site>/logs/` for the developer.

**Builds run site code.** In single tenant it's the owner's own site, but
the child process still gets a scrubbed environment: no `SSH_AUTH_SOCK`, no
`GIT_*` variables, no tokens, no `cms-server` secrets **(call)**. Sandboxed
build workers are phase 5.

### 4.5 D15: collections without a loader (call)

Kept as it is: a schema entry in `schema.json` and no documents. A
`documents.json` test pins it (step 2.0).

## 5. What gets built

### 5.1 Step 2.0: adjust phase 1 first

All of these are in the renderer or the shared packages, and all of them
come before `cms-server` reads a bundle:

1. **Shared contract types.** `DocumentRecord`, `RouteRecord` and
   `BuildTimeFields` (`preview-render-server/src/manifest/types.ts`) and
   the render and validate request envelope (`{ documents, media }`, today
   checked in `render/envelope.ts`) move to a leaf package that both sides
   import. Either `preview-protocol` grows a `bundle` entry point, or a new
   `preview-contract` package holds them; the builder picks. Zod schemas for
   the envelope and the manifests live there too, so `cms-server` parses the
   bundle's files instead of casting.
2. **Bundle identity.** The build writes `bundle.json`:
   `{ bundleId, siteCommit, protocolVersion, astroVersion, builtAt }`.
   `bundleId` is unique per build. `siteCommit` is the commit of the
   checkout that was built, or `null` if it wasn't a git checkout.
3. **Revisions in the manifest.** Each `DocumentRecord` gets `revision`:
   the revision of the document as built (section 5.3). The manifest also
   lists the images under `src/` with their content hash, so `cms-server`
   knows which saved images the bundle lacks (D12).
4. **Manifests inside `outDir`, paths relative.** `manifestDir` and
   `mediaDir` stop being absolute build-machine paths baked into the virtual
   module. The manifests move into the bundle's folder and are found
   relative to the server entry. This is the portability item of SYSTEM-DESIGN section 12
   (planned for phase 4), brought forward because `cms-server` becomes the first reader of
   the bundle's layout.
5. **`build.ts` and `start.ts` take overrides** for the site root, the
   output folder and the port (arguments or environment variables), so
   `cms-server` can build any checkout into any folder and run two nodes
   side by side (section 5.6).
6. **The preview node's front server** (section 5.7). It's the renderer's
   code, not `cms-server`'s.
7. **Review the security warnings:** the 6 moderate `npm install`
   advisories and the unreviewed osv-scanner ignores (`postcss-selector-parser`,
   the four `qs` entries), before the package that holds credentials exists.
8. **Record in WORKPLAN-PHASE-0-1.md section 10** that the 5 ms render goal was measured and not
   met (7 to 9 ms median on `landing/long`), and accepted under the e2e
   budgets (60 ms median, 100 ms p95).
9. **Validate tells real errors from refinements that threw (call).** Today
   `handleValidate` turns a throwing refinement into a plain `422`, so a
   save would be refused for a cause that is often our own stubbed
   metadata, not the user's content. Each error in `ValidationResponse`
   gets `kind: 'invalid' | 'refinement-threw'`. When every error is
   `refinement-threw`, `cms-server` saves, and the changeset becomes an
   `auto` build-check trigger (4.4), so the real build is the final check,
   as D3 says. The render route keeps answering `422` for them.

### 5.2 Package layout (call; the builder may regroup)

```text
cms-server/
├─ src/
│  ├─ server.ts            entry: config, Hono app, listen on 127.0.0.1
│  ├─ config.ts            cms config schema (Zod) and loading
│  ├─ http/                one file per route group: parse with Zod, call a module, map the result
│  ├─ bundle/              read and validate bundle.json, documents.json, schema.json, routes.json
│  ├─ documents/           document store: read a document, revisions, changesets, save
│  ├─ codecs/              json.ts, yaml.ts, frontmatter.ts, file-entries.ts (D13)
│  ├─ references/          the reference index and the delete guard (4.3)
│  ├─ media/               staging, measuring with sharp, metadata cache by content hash
│  ├─ git/                 execFile wrapper, sync, re-apply, publish (4.2)
│  ├─ preview/             supervising nodes, the build queue, tokens, validate and warm calls
│  └─ overlay.ts           GET /api/overlay: working copy against the bundle
└─ test/                   fixtures, a bare git repo helper, e2e
```

The test editor (`preview-render-server/test-editor/`) moves to `cms-server`
as static files on the CMS origin (section 5.8).

### 5.3 Documents, revisions, saving

- **Reading.** `cms-server` knows the documents from the current bundle's
  `documents.json` (key, file, format, `entryKey`, editable, build-time
  flags), and reads the values from the working copy through the codecs.
  It moves today's `/__dev/documents` parsing, YAML with `merge: true`
  included, into the codecs.
- **Revision** **(call)**: a SHA-256 of the document's canonical text,
  shortened. For a document that has a file to itself, the file's bytes.
  For a `file()` entry, the canonical form of that entry's parsed value alone
  (JSON with sorted keys, dates as ISO strings; refined in the work plan,
  task 2.0c, so the build and `cms-server` agree without sharing a codec). So
  editing two different entries of `testimonials.json` doesn't conflict.
  The same function runs in the build (5.1 item 3) and in `cms-server`, so
  it lives in the shared contract package.
- **`PUT /api/changes`** (SYSTEM-DESIGN section 4), in this order:
  1. parse the body with Zod;
  2. check every `baseRevision` against the working copy. Any mismatch:
     `409 { error: 'conflict', documents: [{ key, revision, value }] }`. The
     client may send the document again with the new revision to overwrite
     it, which phase 3's editor offers as "keep mine";
  3. the delete guard (4.3);
  4. write the changed files into a scratch copy of the affected files,
     then call `POST /__preview/validate` with the new values and
     `cms-server`'s own media map, not the editor's (D12). Errors of kind
     `invalid` answer `422` with field paths. Errors of kind
     `refinement-threw` don't block the save (5.1 item 9);
  5. write each file atomically (temp file and rename) with its codec,
     move staged images into place (5.5), commit on `cms/work`;
  6. answer `200 { revisions: { key: revision } }`. If a build-time field
     changed, add `rebuild: true` and queue a build.
- **`GET /api/changes`**: the saved changeset (documents that differ
  between `origin/main` and `cms/work`), with each document's base revision
  and whether it was overwritten in the last sync.
- **`GET /api/documents?key=`**: `{ key, value, revision, file, format,
  editable, buildTime, buildTimeFields }`. `value` is the raw object, or
  `{ data, body }` for Markdown and MDX (D2), as the overlay wants.
- **New documents** use the collection's `newEntryFormat`, or else the first
  extension of its loader pattern (D13). Their path comes from the loader's
  `base` and the id.

### 5.4 Codecs (D13)

One per format. Each parses text into a value and writes a value back into
the original text, keeping what it can:

- **JSON:** key order, the file's indentation (2 spaces for a new file), the
  final newline.
- **YAML:** comments (including the one inside a list in the sample), key
  order and quoting, through the `yaml` package's Document API. Dates stay
  as the file wrote them unless the value changed.
- **Markdown and MDX:** frontmatter through the YAML codec; the body
  written exactly as given. The body stays byte for byte when only the
  frontmatter changed. A file gets frontmatter only if the data isn't
  empty.
- **`file()` entries:** rewrite only the entry found by `entryKey`; every
  other entry stays byte for byte.
- A save never converts a format. Read-only formats (`editable: false`) are
  refused with `422`.

Round-trip tests run on copies of the sample's own files.

### 5.5 Media (D5, D12)

- **`POST /api/media`**: the upload is capped (10 MB, as today), measured
  once with `sharp`, and stored as `.cms/<site>/staging/<sha256>.<ext>`. The
  answer is `{ id, url, width, height, format }`. The `url` is on the CMS
  origin (`/media/staging/<sha256>.<ext>`). It can't be guessed and needs
  no cookie, so the preview iframe can load it **(call)**.
- **Saving an image:** a draft value holding a staging URL is rewritten to a
  path relative to **the file that holds the document** (D5). The image is
  copied to the site's media folder: `media.folder` in the cms config,
  default `src/assets/uploads/` **(call)**. A file with the same content
  hash is reused.
- **Metadata cache:** `.cms/<site>/media.json`, image path and content hash
  to `{ width, height, format }`. `GET /api/overlay` returns entries for
  images saved since the bundle (by the bundle's image list, 5.1 item 3).
- **Plain-string image fields (user, 2026-10-31).** Many sites, the sample
  included, store images as strings into `public/` (`"/images/cta.png"`):
  13 fields and 163 values in the sample, against 4 `image()` fields. Phase
  2 treats them as **text fields**: the path can be changed, but nothing can
  be uploaded into them. Uploads go only into `image()` fields. A save
  **warns, without blocking**, when a string that looks like an image path
  (starts with `/`, ends in an image extension) has no matching file under
  `public/`. That is the one way such a field breaks the site. Uploads into
  string fields, with a picker of the site's existing images, are a phase 3
  option if real use asks for them. This follows the reworded sample rule
  in README.md section 2.
- **The preview node's stopgap upload route** (`media-route.ts`) is removed
  at the end of phase 2. Its tests move to `POST /api/media`, including the
  near-miss file names (D15).

### 5.6 Supervising the preview node

- `cms-server` starts the node as a child process (`start.ts` with the
  overrides of 5.1 item 5), with this environment:
  - `PREVIEW_EDITOR_ORIGINS`: the CMS origin;
  - `PREVIEW_TOKEN_SECRET`: shared with `cms-server`, never with the browser;
  - `PREVIEW_INTERNAL_SECRET`: for `cms-server`'s own calls (below);
  - none of `cms-server`'s other secrets.
- **Readiness:** poll `GET /__preview/config` until it answers, with a
  timeout. **Crashes:** restart with backoff (1 s, 2 s, 4 s, then up to
  30 s). After 5 failures in a row, show the error in `GET /api/status`.
- **Swap after a rebuild (call):** the preview origin never changes. Builds
  go to a new folder (`.cms/<site>/bundles/<bundleId>/`) while the old node
  keeps serving; that covers the 10 to 25 s build. When the build passes,
  stop the old node and start the new one **on the same port**. The gap is
  the node's cold start (~230 ms, plus about 1 s for the first render), and
  the editor reloads the iframe after a bundle change anyway. Running two
  nodes at once would need a proxy in front, either in the credential-holding
  `cms-server` or as one more process. Not worth it in single tenant; phase
  5's preview router takes this role. Keep the last two bundles. One build at a time; a trigger that
  arrives during a build queues one more, and further triggers merge into
  it.
- **Protocol mismatch (D14), simplified (call):** after each build and at
  startup, `cms-server` compares `bundle.json`'s `protocolVersion` with its
  own `PROTOCOL_VERSION`. On a mismatch it builds once per `bundleId`. If
  the new bundle still mismatches, `GET /api/status` reports the error. The
  test editor's `protocolMismatch` check on `ready` stays, as a second line.
- **Server-to-server calls** (`/__preview/validate`, `/__preview/warm`) go
  to `127.0.0.1` with `Authorization: Bearer <PREVIEW_INTERNAL_SECRET>`.
  The node's front server accepts either that header or the preview cookie
  **(call)**. Warm-up is called by `cms-server` when an editing session
  opens (the first `GET /api/preview-url`), not by the browser, because a
  cross-origin POST from the editor would need CORS **(call)**.
- `GET /api/status`: bundle id and commit, build state, node state, last
  sync, saved changeset size.

### 5.7 The preview node's front server (renderer side, D14)

Checked 2026-10-31: `@astrojs/node`'s `staticHeaders` only writes the CSP
of Astro's own CSP feature into a file, at build time. It can't add a
runtime `frame-ancestors`. So the preview build switches the adapter to
`mode: 'middleware'`, and a small Node server in `preview-render-server`
fronts it:

1. **Token exchange:** a request with `?preview_token=` checks the token,
   sets `__Host-preview` (HttpOnly, Secure, SameSite=Lax, `Path=/`, about
   12 h) and redirects to the same URL without the token.
2. **Gate:** every other request needs the cookie or the internal bearer
   header, or it gets `401`.
3. **Header:** every response carries `Content-Security-Policy:
   frame-ancestors 'self' <PREVIEW_EDITOR_ORIGINS>`.
4. Then the adapter's handler: static pages, `/_astro/*`, the preview routes.

- **Token** **(call):** `base64url(payload).base64url(HMAC-SHA256)`, where
  the payload is `{ site, exp }` and `exp` is 60 s ahead. `cms-server` mints
  it in `GET /api/preview-url?path=`, which answers the iframe URL.
- **`GET /__preview/config`** answers `{ editorOrigins }`. The bridge
  fetches it before its first `ready`. `SiteConfig.editorOrigins` and the
  build-time argument of `bridgeScript()` go away.
- The bridge drops a `preview_token` parameter from the `path` it sends,
  keeps its `event.source === window.parent` check and its "never `'*'`"
  rule (D14).
- **Local origins** **(call, to verify first):** cookies ignore the port,
  so `localhost:4400` and `localhost:4401` share a cookie jar, and a site
  script on the preview port could set cookies the CMS receives. `__Host-`
  doesn't separate ports. Use hostnames instead: `cms.localhost` and
  `preview.localhost` (browsers resolve `*.localhost` to the loopback
  address). Verify in Chromium that `Secure` cookies work on plain HTTP
  there, as they do on `localhost`. If not, use local TLS (mkcert).

### 5.8 The test editor on the CMS origin

It moves to `cms-server` and is served at `/` on the CMS origin. It keeps
its forms and its message handling, with new data sources:

| Today (phase 1) | Phase 2 |
|---|---|
| iframe of the same origin | iframe URL from `GET /api/preview-url?path=` |
| `GET /__dev/documents?key=` | `GET /api/documents?key=` |
| `POST /__preview-media/new` | `POST /api/media` |
| starts with an empty overlay | starts with `GET /api/overlay`, merged with its drafts |
| calls `/__preview/warm` | `cms-server` warms when it hands out the preview URL |
| no saving | **Save** (`PUT /api/changes`, shows `409` and `422`), **Publish** (`POST /api/publish`), saved changeset list |
| `postMessage` to its own origin | to the preview origin from the URL it received |

`/__dev/documents` and `/__editor` are removed from the preview build at the
end of phase 2, with their tests moved or rewritten against the new routes.

### 5.9 API (SYSTEM-DESIGN section 4, completed)

| Route | Does |
|---|---|
| `GET /api/schema` | collections and JSON Schema, from the bundle |
| `GET /api/documents?collection=` | list: key, file, revision, format, editable, title if the data has one |
| `GET /api/documents?key=` | 5.3 |
| `POST /api/media` | 5.5 |
| `PUT /api/changes` | 5.3: `200` (with `warnings`, e.g. a missing `public/` image, 5.5), `409 conflict`, `409 referenced-by`, `422` |
| `GET /api/changes` | 5.3 |
| `POST /api/publish` | 4.2: `200 { commit, overwritten: [...] }`, `422` validation, `424 build-failed`, `502` push failed after retries |
| `GET /api/overlay` | `{ documents, media }`: working copy against the current bundle (by revision), plus images the bundle lacks |
| `GET /api/preview-url?path=` | iframe URL with a fresh token; opens a session (warm-up) |
| `GET /api/status` | 5.6 |

- Every request is parsed with Zod; nothing is cast. Errors are
  `{ error: '<code>', message, ... }` with codes the test editor can show.
- Keys travel as query parameters (D10), and every key-indexed table uses
  `Map` or `Object.hasOwn` (D15).
- Write routes need `Content-Type: application/json` (or multipart for
  media) and refuse `Sec-Fetch-Site: cross-site`, as the preview routes do.
  With no auth until phase 4, this and the `127.0.0.1` bind are the only
  protection, so the README says so.

### 5.10 Configuration

`cms.config.ts` per site, parsed with Zod **(call)**:

```ts
{
  site: 'sample-site',
  remote: 'git@github.com:owner/site.git', // or a local bare repo in tests
  branch: 'main',
  siteDir: '.',                            // the site's folder inside the repo (monorepos)
  previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
  origins: { cms: 'http://cms.localhost:4400', preview: 'http://preview.localhost:4401' },
  publish: { buildCheck: 'auto' },        // 'always' | 'auto' | 'never'
  media: { folder: 'src/assets/uploads' },
  syncIntervalSeconds: 60,
}
```

Secrets (the token and internal secrets) come from the environment, or are
generated at startup when unset. Git credentials stay in the SSH agent or
the git credential helper.

### 5.11 Guardrails

- The checklist of QUALITY-TOOLING.md for the new package, every line.
- New dependency-cruiser rules, mirroring decision 4:
  - `preview-render-server` never imports `cms-server`, and the reverse,
    except through the shared contract package and `preview-protocol`;
  - only `cms-server/src/git/` and `cms-server/src/preview/` import
    `child_process`;
  - only `cms-server/src/http/` imports `hono`, so the modules stay
    HTTP-free.
- Tests: unit tests per file with injected `exec`, file system and clock;
  e2e tests against a **bare git repo in a temp folder inside the workspace**
  as the remote, seeded from `sample-site`, with a second clone playing the
  developer who pushes. Every row of "Done when" (section 1) has an e2e
  test.
- Stryker and coverage floors as for the renderer. Floors are set after
  the first full run, not guessed.

## 6. Measured at the end of phase 2

- `cms-server` memory, rss at rest and after a session (save, publish).
- Publish latency with `buildCheck` `never`, `auto` without a trigger, and
  `always`.
- Re-apply time on the 200-post sample.
- Swap time from a finished build to the new node serving.

## 7. Left to the builder

- Package and file names inside `cms-server/` (5.2 is a proposal).
- Whether the contract types extend `preview-protocol` or form a new
  package (5.1 item 1).
- Port numbers, the poll interval, backoff values, the token and cookie
  lifetimes (within the stated rules).
- The test editor's layout for Save, Publish and the changeset list.
- The order of tasks in `WORKPLAN-PHASE-2.md`, as long as step 2.0 comes
  first and the guardrails exist before the first route.
