// End-to-end: testimonial avatar paths in a file()-loaded collection resolve
// from src/content/ when a draft overlays the entry.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');
const SITE = path.resolve(import.meta.dirname, '../../../sample-site');
const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(SITE, file), 'utf8'));

interface Rendered {
  html: string;
}

async function post(route: string, body: unknown, search = '') {
  const response = await fetch(`${BASE}/__preview/${route}${search}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // Plain-text answers (400, 404, 500).
  }
  return { status: response.status, text, json };
}

const render = (page: string, documents: Record<string, unknown>) =>
  post('render', { documents }, `?path=${encodeURIComponent(page)}`);

describe('testimonial avatar paths (D5)', () => {
  it('resolves a drafted avatar from src/content/', async () => {
    const testimonial = readJson('src/content/testimonials.json').find(
      (item: { id: string }) => item.id === 't-ana',
    );
    const landing = readJson('src/content/landing/home-v2.json');
    const testimonialBlock = landing.blocks.find(
      (block: { type: string }) => block.type === 'testimonials',
    );
    testimonialBlock.items = ['t-ana'];
    const { status, json } = await render('/landing/home-v2', {
      'landing/home-v2': landing,
      'testimonials/t-ana': {
        ...testimonial,
        name: 'D5 drafted testimonial',
        avatar: '../assets/authors/ana-torres.png',
      },
    });

    expect(status).toBe(200);
    const html = (json as Rendered).html;
    expect(html).toContain(
      '<strong class="block">D5 drafted testimonial</strong>',
    );
    expect(html).toMatch(/<img\b[^>]*class="rounded-full"[^>]*>/);
  });

  it('answers 422 with the avatar field path when the file is missing', async () => {
    const testimonial = readJson('src/content/testimonials.json').find(
      (item: { id: string }) => item.id === 't-ana',
    );
    const { status, json } = await render('/landing/home-v2', {
      'testimonials/t-ana': {
        ...testimonial,
        avatar: '../assets/authors/not-there.png',
      },
    });

    expect(status).toBe(422);
    expect(
      (json as { errors: Array<{ key: string; path: string[] }> }).errors.map(
        (error) => `${error.key}:${error.path.join('.')}`,
      ),
    ).toEqual(['testimonials/t-ana:avatar']);
  });
});
