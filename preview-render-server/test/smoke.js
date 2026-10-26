// Smoke test for a running preview server (npm start). Checks that the
// /__preview/blocks island renders the same HTML as the static page, follows
// edits, and measures render time.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4400';
const HOME_JSON = new URL('../../sampleAstroProject/src/content/pages/home.json', import.meta.url);
const saved = JSON.parse(fs.readFileSync(HOME_JSON, 'utf8'));

async function render(blocks, init = {}) {
  const response = await fetch(`${BASE}/__preview/blocks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blocks }),
    ...init,
  });
  const timing = response.headers.get('server-timing')?.match(/dur=([\d.]+)/)?.[1];
  return { status: response.status, html: await response.text(), renderMs: Number(timing) };
}

// Two expected differences from the static page: it optimizes images at build
// time (/_astro/x.webp) while the live render points at the on-demand endpoint
// (/_image?...), and it inlines component scripts, which the fragment leaves
// out (the page already ran them).
const normalize = (html) =>
  html.replace(/(<img[^>]*?) src="[^"]*"/g, '$1 src=""').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const sections = (html) => [...html.matchAll(/<section[^>]*data-block-index="(\d+)"/g)].map((m) => m[1]);
const copy = () => structuredClone(saved.blocks);

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['ok  ', name]);
  } catch (error) {
    results.push(['FAIL', `${name}: ${error.message}`]);
  }
}

await check('matches the static page', async () => {
  const page = await (await fetch(`${BASE}/`)).text();
  const main = page.match(/<main[^>]*>([\s\S]*)<\/main>/)[1];
  const { status, html } = await render(saved.blocks);
  assert.equal(status, 200);
  assert.equal(normalize(html), normalize(main));
});

await check('no script tags or local paths in fragment', async () => {
  const { html } = await render(saved.blocks);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /[A-Z]:\/|\.astro\?/);
});

await check('text edit', async () => {
  const blocks = copy();
  blocks[0].titularNegrita = 'cuando alguien te escucha de verdad.';
  const { html } = await render(blocks);
  assert.match(html, /cuando alguien te escucha de verdad\./);
});

await check('reorder blocks', async () => {
  const { html } = await render(copy().reverse());
  assert.ok(html.indexOf('servicios-shell') < html.indexOf('hero-shell'), 'servicios should come first');
  assert.deepEqual(sections(html), ['0', '1', '2']);
});

await check('add and remove blocks', async () => {
  const blocks = copy();
  blocks.push({ type: 'servicios', encabezado: 'Nuevo bloque', texto: 'Añadido en el borrador.' });
  blocks.splice(1, 1);
  const { html } = await render(blocks);
  assert.deepEqual(sections(html), ['0', '1', '2']);
  assert.match(html, /Nuevo bloque/);
  assert.doesNotMatch(html, /testblock/);
});

await check('text is escaped', async () => {
  const blocks = copy();
  blocks[1].texto = '<script>alert(1)</script>';
  const { html } = await render(blocks);
  assert.match(html, /&lt;script&gt;/);
});

await check('build-time image is served', async () => {
  const { html } = await render(saved.blocks);
  const src = html.match(/<img[^>]*? src="([^"]*)"/)[1].replaceAll('&amp;', '&');
  const image = await fetch(BASE + src);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /^image\//);
});

await check('unknown island -> 404', async () => {
  const response = await fetch(`${BASE}/__preview/nope`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 404);
});

await check('non-JSON or cross-site -> refused', async () => {
  assert.equal((await render(saved.blocks, { headers: { 'content-type': 'text/plain' } })).status, 404);
  assert.equal(
    (await render(saved.blocks, { headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } })).status,
    403,
  );
});

// Not a pass/fail check: draft images (paths not in the build) are step 2.
const draftImage = copy();
draftImage[0].retrato = '../assets/images/not-in-build.png';
const draftImageResult = await render(draftImage);

const runs = 100;
const server = [];
const wall = [];
for (let i = 0; i < runs; i++) {
  const blocks = copy();
  blocks[0].titulo = `Edición ${i}`;
  const start = performance.now();
  const { renderMs } = await render(blocks);
  wall.push(performance.now() - start);
  server.push(renderMs);
}
const stat = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const at = (q) => sorted[Math.floor(q * (sorted.length - 1))].toFixed(1);
  return `median ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${at(1)} ms`;
};

for (const [status, line] of results) console.log(`${status} ${line}`);
console.log(`\ndraft image not in build: HTTP ${draftImageResult.status}`);
console.log(`\n${runs} renders`);
console.log(`  render (server): ${stat(server)}`);
console.log(`  round trip:      ${stat(wall)}`);
process.exitCode = results.some(([status]) => status === 'FAIL') ? 1 : 0;
