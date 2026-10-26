# Preview render server

Builds an Astro site once, then re-renders its components in memory with
draft content: no Vite, no compiler, no `astro dev`. A bridge script in the
previewed page swaps the new HTML in as the editor types. The pattern is
Tina's island route and bridge, without Tina. Full write-up, with diagrams
and measurements:
[DOCS/PREVIEW-RENDER-SERVER.md](../DOCS/PREVIEW-RENDER-SERVER.md).

```text
editor ──postMessage draft──▶ bridge (in the iframe) ──POST /__preview/blocks──▶ node process
       ◀──── rendered ───────  swaps the HTML       ◀──── HTML fragment ──────  Container API render
```

## How it works

- `sites/<site>.config.js`: where the site lives. For each island: its
  component and the content file it reads.
- `src/build.js`: runs Astro's `build()` on the site, adding the Node adapter
  and `src/integration.js`. Output goes to `.build/<site>/`, so the site's
  files and its normal static build are untouched.
- `src/integration.js`, which adds:
  - the routes;
  - the `<div data-preview-island>` wrappers, by redirecting imports (no site
    change);
  - the bridge script;
  - a virtual module with the island components and every image under `src/`.
- `src/preview-route.js`: `GET` returns the saved props, `POST` renders
  them (same-site JSON only).
- `src/media-route.js`: draft image upload (`POST /__preview-media/new`) and
  serving.
- `src/client/bridge.js`: runs in the previewed page and speaks `postMessage`
  with any editor.
- `test-editor/editor.astro`: a test editor at `/__editor`, with a JSON
  textbox per island next to the site in an iframe.
- `src/start.js`: runs `.build/<site>/server/entry.mjs`.

Rebuild when code changes (markup, CSS, schemas, new block types). Content
changes never need a rebuild. Drafts live only in the editor tab; nothing is
written to the site yet.

## Run

`astroViewCMS/` is an npm workspace: the site and this server share one copy
of `astro`. Run `npm install` there first.

```sh
npm run build   # preview build of sampleAstroProject
npm start       # http://localhost:4400, editor at /__editor
npm run smoke   # checks and timings against the running server
```

From an AI agent, run the build with the Astro agent-detection variables
unset (see the HANDOFF environment notes).

## Known limits

- Drafts aren't saved or persisted; uploads pile up in `.build/<site>-media/`.
- Component `<script>`s aren't re-sent with fragments. The page ran them once
  on load, so they don't run on swapped-in HTML.
- `experimental_AstroContainer` can change in any Astro release.
