// End-to-end: the real preview build of sampleAstroProject, served by the
// real Node server (see global-setup.ts), checked over HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');
const SITE = path.resolve(import.meta.dirname, '../../../sampleAstroProject');
const saved = JSON.parse(fs.readFileSync(path.join(SITE, 'src/content/pages/home.json'), 'utf8')) as {
  blocks: Array<Record<string, unknown>>;
};

async function render(blocks: unknown, init: RequestInit = {}) {
  const response = await fetch(`${BASE}/__preview/blocks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks }),
    ...init,
  });
  const renderMs = Number(response.headers.get('server-timing')?.match(/dur=([\d.]+)/)?.[1]);
  return { status: response.status, html: await response.text(), renderMs };
}

// Two expected differences from the static page: it optimizes images at build
// time (/_astro/x.webp) while the live render points at the on-demand endpoint
// (/_image?...), and it inlines component scripts, which the fragment leaves
// out (the page already ran them).
const normalize = (html: string) =>
  html.replace(/(<img[^>]*?) src="[^"]*"/g, '$1 src=""').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const sections = (html: string) => [...html.matchAll(/<section[^>]*data-block-index="(\d+)"/g)].map((m) => m[1]);
const imgSrc = (html: string) => html.match(/<img[^>]*? src="([^"]*)"/)![1].replaceAll('&amp;', '&');
const copy = () => structuredClone(saved.blocks);

let page: string;
beforeAll(async () => {
  page = await (await fetch(`${BASE}/`)).text();
});

describe('the built page', () => {
  it('wraps the region and loads the bridge', () => {
    expect(page).toMatch(/<div style="display: contents" data-preview-region="blocks">/);
    expect(page).toMatch(/<script type="module" src="\/_astro\/[^"]+\.js"><\/script>/);
  });

  it('renders the same region HTML as the live route', async () => {
    const main = page.match(/<main[^>]*>([\s\S]*)<\/main>/)![1];
    const region = main.match(/^\s*<div[^>]*data-preview-region="blocks"[^>]*>([\s\S]*)<\/div>\s*$/)![1];
    const { status, html } = await render(saved.blocks);
    expect(status).toBe(200);
    expect(normalize(html)).toBe(normalize(region));
  });

  it('serves the editor', async () => {
    const response = await fetch(`${BASE}/__editor`);
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/<iframe id="preview"/);
  });
});

describe('render route', () => {
  it('no longer serves saved props', async () => {
    const response = await fetch(`${BASE}/__preview/blocks`);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('leaves no script tags or local paths in the fragment', async () => {
    const { html } = await render(saved.blocks);
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/[A-Z]:\/|\.astro\?/);
  });

  it('follows a text edit', async () => {
    const blocks = copy();
    blocks[0].titularNegrita = 'cuando alguien te escucha de verdad.';
    expect((await render(blocks)).html).toContain('cuando alguien te escucha de verdad.');
  });

  it('follows reordering', async () => {
    const { html } = await render(copy().reverse());
    expect(html.indexOf('servicios-shell')).toBeLessThan(html.indexOf('hero-shell'));
    expect(sections(html)).toEqual(['0', '1', '2']);
  });

  it('follows added and removed blocks', async () => {
    const blocks = copy();
    blocks.push({ type: 'servicios', encabezado: 'Nuevo bloque', texto: 'Añadido en el borrador.' });
    blocks.splice(1, 1);
    const { html } = await render(blocks);
    expect(sections(html)).toEqual(['0', '1', '2']);
    expect(html).toContain('Nuevo bloque');
    expect(html).not.toContain('testblock');
  });

  it('escapes text', async () => {
    const blocks = copy();
    blocks[1].texto = '<script>alert(1)</script>';
    expect((await render(blocks)).html).toContain('&lt;script&gt;');
  });

  it('serves the build-time image it points to', async () => {
    const image = await fetch(BASE + imgSrc((await render(saved.blocks)).html));
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toMatch(/^image\//);
  });

  it('answers 500 with a message for a relative image path not in the build', async () => {
    const blocks = copy();
    blocks[0].retrato = '../assets/images/not-in-build.png';
    const { status, html } = await render(blocks);
    expect(status).toBe(500);
    expect(html).toContain('must be an imported image or a URL');
  });

  it('refuses unknown regions, non-JSON and cross-site requests', async () => {
    const unknown = await fetch(`${BASE}/__preview/nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(unknown.status).toBe(404);
    expect((await render(saved.blocks, { headers: { 'content-type': 'text/plain' } })).status).toBe(404);
    expect((await render(saved.blocks, { headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
  });
});

describe('draft images', () => {
  it('upload, serve and render, stored in the build folder', async () => {
    const png = fs.readFileSync(path.join(SITE, 'src/content/assets/images/Andre2.png'));
    const upload = await fetch(`${BASE}/__preview-media/new`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    expect(upload.status).toBe(201);
    const { url } = (await upload.json()) as { url: string };
    expect(url).toMatch(/^\/__preview-media\/[0-9a-f]{16}\.png$/);
    expect(fs.existsSync(path.join(inject('buildDir'), 'sampleAstroProject-media', path.basename(url)))).toBe(true);

    const served = await fetch(BASE + url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await served.arrayBuffer()).length).toBe(png.length);

    const blocks = copy();
    blocks[0].retrato = url;
    const { status, html } = await render(blocks);
    expect(status).toBe(200);
    expect(imgSrc(html)).toBe(url);
  });

  it('refuses bad uploads', async () => {
    const post = (type: string, body: string) =>
      fetch(`${BASE}/__preview-media/new`, { method: 'POST', headers: { 'content-type': type }, body });
    expect((await post('image/svg+xml', '<svg/>')).status).toBe(415);
    expect((await post('text/plain', 'x')).status).toBe(404);
    expect((await fetch(`${BASE}/__preview-media/..%2Fsecret.png`)).status).toBe(404);
  });
});

describe('warm-up', () => {
  it('POST answers 204 (also when repeated); other methods and cross-site calls are refused', async () => {
    expect((await fetch(`${BASE}/__preview/warm`, { method: 'POST' })).status).toBe(204);
    expect((await fetch(`${BASE}/__preview/warm`, { method: 'POST' })).status).toBe(204);
    expect((await fetch(`${BASE}/__preview/warm`)).status).toBe(405);
    expect((await fetch(`${BASE}/__preview/warm`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
  });
});

describe('performance', () => {
  it('renders 100 consecutive edits quickly', async () => {
    const server: number[] = [];
    const wall: number[] = [];
    for (let i = 0; i < 100; i++) {
      const blocks = copy();
      blocks[0].titulo = `Edición ${i}`;
      const start = performance.now();
      const { status, renderMs } = await render(blocks);
      wall.push(performance.now() - start);
      expect(status).toBe(200);
      server.push(renderMs);
    }
    const stat = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))];
      return { median: at(0.5), p95: at(0.95), max: at(1) };
    };
    const render_ = stat(server);
    const roundTrip = stat(wall);
    const fmt = ({ median, p95, max }: ReturnType<typeof stat>) =>
      `median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms`;
    console.log(`100 renders\n  render (server): ${fmt(render_)}\n  round trip:      ${fmt(roundTrip)}`);

    // Generous bound: only catches a big regression, not machine noise.
    expect(render_.median).toBeLessThan(20);
  });
});
