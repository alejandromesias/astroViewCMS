# Preview render server

Builds an Astro site once, then re-renders its components in memory with
draft content: no Vite, no compiler, no `astro dev`. The pattern is Tina's
island route without Tina. Full write-up, with diagrams and measurements:
[DOCS/PREVIEW-RENDER-SERVER.md](../DOCS/PREVIEW-RENDER-SERVER.md).

```text
editor ──POST /__preview/blocks { blocks: [...] }──▶ node process
                                                     AstroContainer.renderToString(BlockList, props)
       ◀────────────── HTML fragment ───────────────
```

## How it works

- `sites/<site>.config.js`: where the site lives, and which component renders
  each island.
- `src/build.js`: runs Astro's `build()` on the site, adding the Node adapter
  and `src/integration.js`. Output goes to `.build/<site>/`, so the site's
  files and its normal static build are untouched.
- `src/integration.js`: adds the `/__preview/[island]` route, plus a virtual
  module that imports the island components and every image under `src/`.
- `src/preview-route.js`: answers same-site JSON POSTs only. The body becomes
  the component's props. Image paths that point to images in the build
  become `ImageMetadata`, as `image()` fields do on the real site.
- `src/start.js`: runs `.build/<site>/server/entry.mjs`. It serves the static
  pages, the `/_image` endpoint and the preview route.

Rebuild when code changes (markup, CSS, schemas, new block types). Content
changes never need a rebuild.

## Run

`astroViewCMS/` is an npm workspace: the site and this server share one copy
of `astro`. Run `npm install` there first.

```sh
npm run build   # preview build of sampleAstroProject
npm start       # http://localhost:4400
npm run smoke   # checks and timings against the running server
```

From an AI agent, run the build with the Astro agent-detection variables
unset (see the HANDOFF environment notes).

## Known limits (step 1)

- Images that aren't in the build (draft uploads) fail to render (HTTP 500,
  "Local images must be imported"). Step 2 serves them from `/__preview-media/`.
- Component `<script>`s aren't re-sent with fragments. The page ran them once
  on load, so they don't run on swapped-in HTML.
- `experimental_AstroContainer` can change in any Astro release.
