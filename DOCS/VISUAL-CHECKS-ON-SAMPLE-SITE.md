# Task 0.3: how to check each addition visually (draft)

Working notes, written while doing WORKPLAN.md task 0.3. Every addition was smoke-tested with
`astro build` in `sample-site/` (page count noted per step).

Start the site: `cd astroViewCMS/sample-site && npm run dev` (open the printed
URL, usually http://localhost:4321).

## 1. Authors collection, `reference('authors')`, `image()` avatars

Files: `src/content/authors/*.json`, `src/assets/authors/*.png`,
`src/layouts/components/AuthorCard.astro`, `author` field in the blog schema.

- `/blog`: the featured post and every card show a small round avatar plus the
  author's name above the summary.
- `/blog/blog-1`: below the article text, a grey card with a larger avatar,
  name, role and bio (Ana Torres). `blog-2` is Marco Rossi, `blog-4` Lena
  Fischer, `blog-5` Kofi Mensah.
- Reference test: edit `src/content/authors/ana-torres.json` (change `role`)
  and reload `/blog/blog-1` and `/blog/blog-3`. Both posts change.

Smoke test: 15 pages built.

## 2. `cover: image().optional()` on blog posts

Files: `cover` in the blog schema (now `({ image }) => z.object(...)`),
`src/assets/blog/cover-*.jpg`, set on `blog-1` and `blog-2`. `Post.astro`,
`PostSingle.astro` and `blog/index.astro` use `cover ?? image`.

- `/blog/blog-1` and `/blog/blog-2`: the header picture is a different photo
  than before (a 1200x600 crop of `blog-6.jpg` and `flower.jpg`). Its URL is
  `/_astro/cover-1.<hash>.webp`, i.e. a processed asset, not `/images/...`.
- `/blog`: the same two posts show the new picture in the list. Posts 3 to 5
  keep their old `/images/blog-N.jpg` picture.
- Fallback test: delete the `cover:` line in `blog-1.md`; the old picture
  returns.

Smoke test: 15 pages built.

## 3. `testimonials` collection with the `file()` loader

Files: `src/content/testimonials.json` (4 entries in one file), the
`testimonials` collection in `content.config.ts`.

- Nothing visible yet: a block that shows them arrives with the landing pages
  (step 5). For now `astro build` validating the file (including the
  `avatar` `image()` paths) is the check. Break a path in the JSON and the
  build fails with a message naming the entry.

Smoke test: 15 pages built.

## 4. Hydrated React component: monthly/yearly price toggle

Files: `src/layouts/components/PricingPlans.tsx` (`client:visible`), used by
`src/pages/pricing.astro`; `price_yearly` (optional) in the pricing schema and
`src/content/pricing/-index.md` (490 / 690 / 990).

- `/pricing`: two buttons ("Monthly" filled, "Yearly" outlined) above the three
  plan cards. Scroll so the cards are visible, click "Yearly": prices change to
  $490 / $690 / $990 and "/ month" becomes "/ year", with no reload. Click
  "Monthly" to go back.
- In the page source, the cards are wrapped in an
  `<astro-island ... client="visible">` element (DevTools, Elements tab).
- Reference for later: after a DOM swap in the preview, this island must stay
  interactive.

Smoke test: 15 pages built.

## 5. `landing` collection, block components, dynamic route

Files: `landing` collection (discriminated union on `type`) in
`content.config.ts`; `src/content/landing/home-v2.json` and `product.json`;
block components in `src/layouts/blocks/` (Banner, Features, Services,
Workflow, CallToAction, PricingBlock, Faq, Testimonials, plus `BlockList.astro`
that picks the component by `type`); route `src/pages/landing/[slug].astro`
(`getStaticPaths` with `props`).

- `/landing/home-v2`: looks like the normal home page (banner, six feature
  cards, four alternating service rows, workflow image, call to action) with
  one new section before the call to action: four testimonial cards with round
  avatars (this is the `file()` collection from step 3, read through
  references).
- The first service row is a Swiper carousel: three slides, autoplay every 3 s,
  clickable dots below.
- `/landing/product`: a shorter page in another order: banner, pricing with
  the Monthly/Yearly toggle (step 4, now inside a block), two testimonials,
  four FAQ boxes, call to action.
- Add/remove/reorder test: in `home-v2.json`, move the `testimonials` block
  above `features`, save, reload the page (`npm run dev` hot reloads it).

Smoke test: 17 pages built (15 + `/landing/home-v2` + `/landing/product`).

## 6. Block with scoped styles and `:global()`

Files: `src/layouts/blocks/Highlight.astro` (scoped `<style>` plus `:global()`),
`highlight` type in the landing union, one `highlight` block in
`landing/product.json`.

- `/landing/product`: right under the banner, a centered box with a dashed
  indigo border and a pale blue-to-pink background. Its title is indigo. In
  the text, "days, not months" is bold pink on a light pink chip, and
  "content" is an indigo link with a wavy underline.
- Why it matters: the bold and the link come from Markdown through
  `set:html`, so they have no Astro scope attribute. Only the `:global()`
  rules style them. In DevTools you should see
  `.highlight-body[data-astro-cid-...] strong` in the CSS, while the `<strong>`
  itself has no `data-astro-cid` attribute.

Smoke test: 17 pages built.

## 7. `landing/long.json` with 44 blocks

File: `src/content/landing/long.json` (generated once from the other two pages:
every block type repeated, titles numbered "(1)" to "(44)").

- `/landing/long`: a very long page. Scroll through it: sections repeat in the
  order banner, features, services, workflow, call to action, pricing, FAQ,
  testimonials, highlight; each block has a number in its title.
- Several carousels (services) on one page: each one has its own dots and
  advances on its own (the pagination selector is unique per block).
- Several Monthly/Yearly toggles: each works independently.
- Size: see the HTML size of `dist/landing/long/index.html` after
  `npm run build` (about 110 KB).

Smoke test: 18 pages built.

## 8. Tag pages `src/pages/tags/[tag]/[...page].astro`

Files: the route above (Astro `paginate()`, 2 posts per page), tags on the five
blog posts, tag chips in `PostSingle.astro`.

- `/blog/blog-1`: under the title area, small grey chips "#photography" and
  "#design" above the text.
- Click "#design": `/tags/design` shows two post cards, "Page 1 of 2" and a
  "Next" button. Next goes to `/tags/design/2` (one card, "Previous" button).
- Other tag pages: `/tags/photography` (2 pages), `/tags/crafts` and
  `/tags/writing` (1 page each).

Smoke test: 24 pages built (18 + 6 tag pages).

## 9. `scripts/generate-posts.mjs` (100 generated posts)

Files: `scripts/generate-posts.mjs`, npm scripts `generate:posts` and
`clean:posts`, `.gitignore` entry for `src/content/blog/generated/`.
Side effect: the route `src/pages/blog/[single].astro` became
`[...single].astro`, because generated ids look like `generated/post-001` and
a plain `[single]` parameter cannot hold a slash. (The CMS must handle nested
ids, so keeping this is useful.)

- `npm run generate:posts`, then `npm run dev`: `/blog` now has 27 pages of
  posts (4 per page, newest first; the generated ones are "Generated post NNN").
  `/blog/generated/post-001` opens one; tags `travel` and `tools` appear under
  `/tags/`.
- `npm run clean:posts` removes them again; the site goes back to 24 pages.
- Measured on this machine: `astro build` with the 100 posts: 249 pages, about
  14 s, `dist` 8.6 MB. Without: 24 pages, about 6 s.

Smoke test: with posts 249 pages built, without posts 24 pages built.
