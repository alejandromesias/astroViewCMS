// End-to-end (D8): a post set to `draft: true` in the overlay disappears from
// the blog listing, from its tag pages and from its own page. The helper module
// lib/contentParser.astro (getSinglePage) makes those reads, so the draft only
// shows up as missing there if the import rewrite reaches helper modules too.
// blog-4 is used: it is on the first listing page and carries two tags.
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');

interface Rendered {
  html: string;
  documents: string[];
  limits: string[];
}

// A 404 answers plain text, so the JSON body is read only for a 200.
const render = async (path_: string, documents: Record<string, unknown>) => {
  const response = await fetch(
    `${BASE}/__preview/render?path=${encodeURIComponent(path_)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents }),
    },
  );
  const json =
    response.status === 200 ? ((await response.json()) as Rendered) : undefined;
  return { status: response.status, json };
};

// The slugs of the blog posts a page links to, in order of first appearance.
const postSlugs = (html: string) => [
  ...new Set(
    [...html.matchAll(/href="\/blog\/([^"/]+)"/g)].map(([, slug]) => slug),
  ),
];

// The overlay of blog-4 as the built file has it, with only `draft` set.
const blog4 = (draft: boolean) => ({
  data: {
    title: 'How to make toys from old Olarpaper',
    date: '2025-07-04T05:00:00Z',
    author: 'lena-fischer',
    tags: ['design', 'writing'],
    draft,
  },
  body: 'Overlaid body of blog-4.\n',
});

describe('draft posts in listings (D8)', () => {
  it('a post with draft: true leaves /blog, its tag pages and its own page', async () => {
    const documents = { 'blog/blog-4': blog4(true) };

    const list = await render('/blog', documents);
    expect(list.status).toBe(200);
    expect(list.json!.documents).toContain('blog/blog-4');
    // The newest four without blog-4; blog-1 moves onto the first page.
    expect(postSlugs(list.json!.html)).toEqual([
      'blog-5',
      'blog-3',
      'blog-2',
      'blog-1',
    ]);

    // `design` held blog-4, blog-2, blog-1; the first page of two now holds
    // blog-2 and blog-1, so there is no second page.
    const design = await render('/tags/design', documents);
    expect(design.status).toBe(200);
    expect(postSlugs(design.json!.html)).toEqual(['blog-2', 'blog-1']);
    expect((await render('/tags/design/2', documents)).status).toBe(404);

    // `writing` held blog-5 and blog-4; only blog-5 is left.
    const writing = await render('/tags/writing', documents);
    expect(writing.status).toBe(200);
    expect(postSlugs(writing.json!.html)).toEqual(['blog-5']);

    expect((await render('/blog/blog-4', documents)).status).toBe(404);
  });

  it('the same post with draft: false stays in all of them (near miss)', async () => {
    const documents = { 'blog/blog-4': blog4(false) };

    const list = await render('/blog', documents);
    expect(postSlugs(list.json!.html)).toEqual([
      'blog-5',
      'blog-4',
      'blog-3',
      'blog-2',
    ]);

    const design = await render('/tags/design', documents);
    expect(postSlugs(design.json!.html)).toEqual(['blog-4', 'blog-2']);
    const designPage2 = await render('/tags/design/2', documents);
    expect(designPage2.status).toBe(200);
    expect(postSlugs(designPage2.json!.html)).toEqual(['blog-1']);

    const writing = await render('/tags/writing', documents);
    expect(postSlugs(writing.json!.html)).toEqual(['blog-5', 'blog-4']);

    const single = await render('/blog/blog-4', documents);
    expect(single.status).toBe(200);
    expect(single.json!.limits).toEqual([]);
  });
});
