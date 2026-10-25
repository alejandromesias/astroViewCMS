# Sample Astro project

A small Spanish-language landing page used as the test site for astroViewCMS.
It runs locally only: static output, no adapter, no deployment setup.

**Stack:** Astro 7, Tailwind 4, JSON content collections.

## Structure

```text
/
├── public/
│   └── favicon.svg
└── src/
    ├── components/
    │   ├── Icon.astro
    │   ├── Navbar.astro             # reads the navbar collection
    │   └── blocks/
    │       ├── HeroBlock.astro
    │       └── ServiciosBlock.astro
    ├── content/
    │   ├── assets/images/           # images referenced from the JSON files
    │   ├── navbar/navegacion.json   # marca, enlaces[], contacto
    │   └── pages/home.json          # title + blocks[] (hero | servicios)
    ├── content.config.ts            # Zod schemas for both collections
    ├── layouts/Layout.astro
    ├── pages/index.astro            # maps each block's `type` to its component
    └── styles/global.css
```

### Content

- `pages/home.json` holds `blocks[]`, a discriminated union on `type`.
  To add a block kind, add it to the schema in `content.config.ts`, create its
  component in `src/components/blocks/`, and register it in `index.astro`.
- Image fields use the `image()` schema helper, so paths are relative to the
  JSON file (e.g. `../assets/images/Andre2.png`). `HeroBlock` renders them
  with `<Image>` from `astro:assets`.

## Commands

Run from this folder:

| Command           | Action                                      |
| :---------------- | :------------------------------------------ |
| `npm install`     | Install dependencies                        |
| `npm run dev`     | Start the dev server at `localhost:4321`    |
| `npm run build`   | Build the static site to `./dist/`          |
| `npm run preview` | Serve the build locally                     |

When `astro dev` is started by an AI agent, Astro 7 detects it and moves the
server to the background (`npx astro dev stop|status|logs` to manage it).
