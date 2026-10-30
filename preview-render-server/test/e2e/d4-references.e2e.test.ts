// End-to-end (D4): the landing page's testimonials block holds references to
// the file() collection `testimonials`. Rendered over HTTP with an overlay that
// edits some of the referenced testimonials and reorders the block's references.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');
const SITE = path.resolve(import.meta.dirname, '../../../sample-site');
const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(SITE, file), 'utf8'));

interface Rendered {
  html: string;
  documents: string[];
  limits: string[];
}

const render = async (path_: string, documents: Record<string, unknown>) => {
  const response = await fetch(
    `${BASE}/__preview/render?path=${encodeURIComponent(path_)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents }),
    },
  );
  return { status: response.status, json: (await response.json()) as Rendered };
};

// The name and quote of each testimonial figure, in the order they appear.
const testimonials = (html: string) =>
  [
    ...html.matchAll(/<figure class="testimonial[^"]*">[\s\S]*?<\/figure>/g),
  ].map(([figure]) => ({
    name: figure.match(/<strong class="block">([^<]*)<\/strong>/)![1],
    quote: figure.match(/<blockquote[^>]*>“([^<]*)”<\/blockquote>/)![1],
  }));

// The landing page with its testimonials block referencing `items`, in order.
const landingWith = (items: string[]) => {
  const home = readJson('src/content/landing/home-v2.json');
  home.blocks.find(
    (block: { type: string }) => block.type === 'testimonials',
  ).items = items;
  return home;
};

describe('POST /__preview/render with testimonial references (D4)', () => {
  it('shows overlaid testimonials and keeps the order of the block references', async () => {
    const { status, json } = await render('/landing/home-v2', {
      'landing/home-v2': landingWith(['t-kofi', 't-marco', 't-ana', 't-lena']),
      'testimonials/t-kofi': {
        name: 'James Okoro (draft)',
        role: 'Draft role',
        quote: 'Draft quote for Kofi',
        avatar: '../assets/authors/kofi-mensah.png',
      },
      'testimonials/t-marco': {
        name: 'Tom Becker (draft)',
        role: 'Draft role',
        quote: 'Draft quote for Marco',
        avatar: '../assets/authors/marco-rossi.png',
      },
    });
    expect(status).toBe(200);
    expect(testimonials(json.html)).toEqual([
      { name: 'James Okoro (draft)', quote: 'Draft quote for Kofi' },
      { name: 'Tom Becker (draft)', quote: 'Draft quote for Marco' },
      {
        // Near miss: no overlay for t-ana, so the built value shows.
        name: 'Priya Nair',
        quote:
          'We shipped our new site in a week. Editing content never needs a developer now.',
      },
      {
        // Near miss: no overlay for t-lena, so the built value shows.
        name: 'Sofia Alvarez',
        quote:
          'Landing pages go from idea to live in an afternoon. Our campaigns love it.',
      },
    ]);
    expect(json.documents).toEqual(
      expect.arrayContaining([
        'testimonials/t-kofi',
        'testimonials/t-marco',
        'testimonials/t-ana',
        'testimonials/t-lena',
      ]),
    );
  });

  it('keeps the block order over the built testimonials when nothing is overlaid', async () => {
    const { status, json } = await render('/landing/home-v2', {
      'landing/home-v2': landingWith(['t-lena', 't-kofi', 't-ana', 't-marco']),
    });
    expect(status).toBe(200);
    expect(testimonials(json.html)).toEqual([
      {
        name: 'Sofia Alvarez',
        quote:
          'Landing pages go from idea to live in an afternoon. Our campaigns love it.',
      },
      {
        name: 'James Okoro',
        quote:
          'The best handover we have had from an agency. Everything is documented.',
      },
      {
        name: 'Priya Nair',
        quote:
          'We shipped our new site in a week. Editing content never needs a developer now.',
      },
      {
        name: 'Tom Becker',
        quote:
          'Fast pages, clean markup and a support team that actually answers.',
      },
    ]);
  });
});
