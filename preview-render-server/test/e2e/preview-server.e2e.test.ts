// End-to-end: the real preview build of sample-site, served by the real Node
// server (see global-setup.ts), checked over HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');
const SITE = path.resolve(import.meta.dirname, '../../../sample-site');
const CLIENT = path.join(inject('buildDir'), 'sample-site', 'client');
const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(SITE, file), 'utf8'));

interface Rendered {
  html: string;
  head: { title?: string; meta: Array<Record<string, string>> };
  documents: string[];
  limits: string[];
  renderMs: number;
}

async function post(
  route: string,
  body: unknown,
  search = '',
  init: RequestInit = {},
) {
  const response = await fetch(`${BASE}/__preview/${route}${search}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // Plain-text answers (400, 404, 500).
  }
  return {
    status: response.status,
    text,
    json,
    timing: response.headers.get('server-timing'),
  };
}
const render = (
  path_: string,
  documents: Record<string, unknown> = {},
  media?: unknown,
) =>
  post(
    'render',
    { documents, ...(media === undefined ? {} : { media }) },
    `?path=${encodeURIComponent(path_)}`,
  );

// Three expected differences from the prerendered page; everything else must
// be identical. The container leaves out the build's links, styles and bundled
// scripts, which the page being patched already has. Images are optimized at
// build time (/_astro/x.webp) while the live render points at the on-demand
// endpoint (/_image?...), so <img> tags are compared apart. Swiper picks a
// random class per render.
const normalize = (html: string) =>
  html
    .replace(/<img\b[^>]*>/g, '<img>')
    .replace(/astro-swiper-\w+/g, 'astro-swiper-ID')
    .replace(/<script\b[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/g, '')
    .replace(/<link\b[^>]*>/g, '')
    .replace(/<!--.*?-->/g, '')
    .replace(/\s+/g, ' ');
const builtPage = (urlPath: string) =>
  fs.readFileSync(
    path.join(CLIENT, urlPath === '/' ? '' : urlPath, 'index.html'),
    'utf8',
  );

describe('the built site', () => {
  it('serves prerendered pages and the test editor', async () => {
    expect((await fetch(`${BASE}/`)).status).toBe(200);
    const editor = await fetch(`${BASE}/__editor`);
    expect(editor.status).toBe(200);
    expect(await editor.text()).toMatch(/<iframe id="preview"/);
  });

  it('writes the manifests next to the bundle', () => {
    const manifest = path.join(inject('buildDir'), 'sample-site-manifest');
    for (const name of [
      'routes.json',
      'documents.json',
      'schema.json',
      'code-languages.json',
    ]) {
      expect(fs.existsSync(path.join(manifest, name)), name).toBe(true);
    }
  });
});

describe('POST /__preview/render with no overlay', () => {
  // Static, dynamic, rest-parameter, paginated, MDX and hydrated pages.
  it.each([
    '/',
    '/blog',
    '/blog/blog-1',
    '/landing/home-v2',
    '/contact',
    '/faq',
    '/pricing',
    '/privacy-policy',
    '/tags/design',
    '/tags/design/2',
    '/blog/page/2',
    '/elements',
  ])('renders %s as the prerendered page does', async (urlPath) => {
    const { status, json } = await render(urlPath);
    expect(status).toBe(200);
    expect(normalize((json as Rendered).html)).toBe(
      normalize(builtPage(urlPath)),
    );
  });

  it('points hydrated components at the built chunks (D6)', async () => {
    const { json } = await render('/pricing');
    const island = (json as Rendered).html.match(/<astro-island[^>]*>/)![0];
    expect(island).toMatch(
      /component-url="\/_astro\/PricingPlans\.[\w-]+\.js"/,
    );
    expect(island).toMatch(/renderer-url="\/_astro\/client\.[\w-]+\.js"/);
    expect(island).not.toContain('before-hydration-url');
    expect(builtPage('/pricing')).toContain(
      island.match(/component-url="[^"]*"/)![0],
    );
  });

  it('answers head data, the documents the page read, and timings', async () => {
    const { status, json, timing } = await render('/blog/blog-1');
    const rendered = json as Rendered;
    expect(status).toBe(200);
    expect(rendered.head.title).toBeTruthy();
    expect(rendered.head.meta.length).toBeGreaterThan(3);
    expect(rendered.documents).toContain('blog/blog-1');
    expect(rendered.documents).toContain('authors/ana-torres');
    expect(rendered.documents).toContain('data:src/config/menu.json');
    expect(rendered.limits).toEqual([]);
    expect(typeof rendered.renderMs).toBe('number');
    expect(timing).toMatch(/^paths;dur=[\d.]+, render;dur=[\d.]+$/);
  });

  it('images go through the on-demand image endpoint, which serves them', async () => {
    const { json } = await render('/blog/blog-1');
    const src = (json as Rendered).html
      .match(/<img[^>]*? src="(\/_image\?[^"]*)"/)![1]!
      .replaceAll('&amp;', '&');
    const image = await fetch(BASE + src);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/webp');
  });

  it('the dev-only script references of the container are stripped', async () => {
    const { json } = await render('/');
    expect((json as Rendered).html).not.toMatch(/\?astro&(amp;)?type=script/);
  });
});

describe('POST /__preview/render with drafts', () => {
  it('shows a draft of a JSON document', async () => {
    const home = readJson('src/content/landing/home-v2.json');
    home.blocks[0].title = 'Draft banner title';
    const { json } = await render('/landing/home-v2', {
      'landing/home-v2': home,
    });
    expect((json as Rendered).html).toContain('Draft banner title');
    expect(builtPage('/landing/home-v2')).not.toContain('Draft banner title');
  });

  it('shows a draft of an imported data file in the header (D8)', async () => {
    const menu = readJson('src/config/menu.json');
    menu.main[0].name = 'Draft nav item';
    const { json } = await render('/', { 'data:src/config/menu.json': menu });
    expect((json as Rendered).html).toContain('Draft nav item');
  });

  it('previews a brand-new post: its own page, and the list that now includes it', async () => {
    const post = {
      data: {
        title: 'A brand new draft post',
        date: '2026-10-27',
        author: 'ana-torres',
        tags: ['design'],
      },
      body: '## Heading\n\nSome text.\n\n```css\na { color: red }\n```\n\n```cpp\nint x = 1;\n```\n',
    };
    const own = await render('/blog/brand-new', { 'blog/brand-new': post });
    expect(own.status).toBe(200);
    expect((own.json as Rendered).html).toContain('A brand new draft post');
    expect((own.json as Rendered).html).toContain(
      '<h2 id="heading">Heading</h2>',
    );
    expect((own.json as Rendered).documents).toContain('blog/brand-new');
    // The css fence is highlighted; cpp is not in the built content, so it stays plain (D2).
    expect((own.json as Rendered).limits).toEqual(['code-language:cpp']);

    const list = await render('/blog', { 'blog/brand-new': post });
    expect((list.json as Rendered).html).toContain('A brand new draft post');
    expect((await render('/blog/brand-new')).status).toBe(404);
  });

  it('a removed document leaves the page list', async () => {
    expect((await render('/blog/blog-1')).status).toBe(200);
    expect((await render('/blog/blog-1', { 'blog/blog-1': null })).status).toBe(
      404,
    );
  });

  it('shows an uploaded draft image through the media map (D12)', async () => {
    const png = fs.readFileSync(
      path.join(SITE, 'src/assets/authors/ana-torres.png'),
    );
    const upload = await fetch(`${BASE}/__preview-media/new`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    });
    expect(upload.status).toBe(201);
    const entry = (await upload.json()) as {
      url: string;
      width: number;
      height: number;
      format: string;
    };
    expect(entry.url).toMatch(/^\/__preview-media\/[0-9a-f]{16}\.png$/);
    const served = await fetch(BASE + entry.url);
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).length).toBe(png.length);

    const author = readJson('src/content/authors/ana-torres.json');
    author.avatar = 'uploads/new-avatar.png';
    const { status, json } = await render(
      '/blog/blog-1',
      { 'authors/ana-torres': author },
      { 'uploads/new-avatar.png': entry },
    );
    expect(status).toBe(200);
    expect((json as Rendered).html).toContain(`src="${entry.url}"`);
  });
});

describe('errors', () => {
  it('422 names the failing fields of a draft that does not fit its schema', async () => {
    const { status, json } = await render('/blog/blog-1', {
      'blog/blog-1': { data: { title: 5 }, body: '' },
      'authors/ana-torres': { name: 1 },
    });
    expect(status).toBe(422);
    const found = json.errors.map(
      (e: { key: string; path: string[] }) => `${e.key}:${e.path.join('.')}`,
    );
    expect(found).toContain('blog/blog-1:title');
    expect(found).toContain('authors/ana-torres:name');
  });

  it('404 when no page matches', async () => {
    const { status, text } = await render('/nothing/at/all');
    expect(status).toBe(404);
    expect(text).toContain('/nothing/at/all');
  });

  it('400 for a bad envelope or path, naming the part', async () => {
    expect((await post('render', '{not json', '?path=/')).status).toBe(400);
    expect((await post('render', {}, '?path=/')).text).toMatch(
      /"documents" must be an object/,
    );
    expect((await post('render', { documents: [] }, '?path=/')).status).toBe(
      400,
    );
    const badMedia = await post(
      'render',
      {
        documents: {},
        media: { 'a.png': { url: 'u', width: 0, height: 1, format: 'png' } },
      },
      '?path=/',
    );
    expect(badMedia.status).toBe(400);
    expect(badMedia.text).toMatch(/"width"/);
    expect((await post('render', { documents: {} }, '')).status).toBe(400);
    expect(
      (await post('render', { documents: {} }, '?path=//evil.example')).status,
    ).toBe(400);
  });

  it('refuses other content types, cross-site calls and other methods', async () => {
    const body = JSON.stringify({ documents: {} });
    expect(
      (
        await fetch(`${BASE}/__preview/render?path=/`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${BASE}/__preview/render?path=/`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'sec-fetch-site': 'cross-site',
          },
          body,
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${BASE}/__preview/render?path=/`)).status).toBe(405);
    expect((await fetch(`${BASE}/__preview/validate`)).status).toBe(405);
  });

  it('refuses bad uploads and paths outside the media folder', async () => {
    const upload = (type: string, body: string) =>
      fetch(`${BASE}/__preview-media/new`, {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      });
    expect((await upload('image/svg+xml', '<svg/>')).status).toBe(415);
    expect((await upload('image/png', 'not an image')).status).toBe(415);
    expect((await upload('text/plain', 'x')).status).toBe(404);
    expect(
      (await fetch(`${BASE}/__preview-media/..%2Fsecret.png`)).status,
    ).toBe(404);
  });
});

describe('POST /__preview/validate', () => {
  it('200 for drafts that fit, 422 with field paths for those that do not', async () => {
    const author = readJson('src/content/authors/ana-torres.json');
    expect(
      await post('validate', {
        documents: { 'authors/ana-torres': author, 'blog/old': null },
      }),
    ).toMatchObject({ status: 200, json: { valid: true } });

    const bad = await post('validate', {
      documents: {
        'authors/ana-torres': { ...author, name: 7 },
        'nowhere/x': {},
      },
    });
    expect(bad.status).toBe(422);
    const found = bad.json.errors.map(
      (e: { key: string; path: string[] }) => `${e.key}:${e.path.join('.')}`,
    );
    expect(found).toContain('authors/ana-torres:name');
    expect(found).toContain('nowhere/x:');
  });
});

describe('warm-up', () => {
  it('POST answers 204 (also when repeated); other methods and cross-site calls are refused', async () => {
    expect(
      (await fetch(`${BASE}/__preview/warm`, { method: 'POST' })).status,
    ).toBe(204);
    expect(
      (await fetch(`${BASE}/__preview/warm`, { method: 'POST' })).status,
    ).toBe(204);
    expect((await fetch(`${BASE}/__preview/warm`)).status).toBe(405);
    expect(
      (
        await fetch(`${BASE}/__preview/warm`, {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
  });
});

describe('GET /__dev/documents (built with PREVIEW_DEV=1)', () => {
  const get = async (key: string) => {
    const response = await fetch(
      `${BASE}/__dev/documents?key=${encodeURIComponent(key)}`,
    );
    const text = await response.text();
    return {
      status: response.status,
      text,
      json: response.ok ? JSON.parse(text) : undefined,
    };
  };

  it('answers a JSON document with its raw value', async () => {
    const { status, json } = await get('landing/home-v2');
    expect(status).toBe(200);
    expect(json).toMatchObject({
      key: 'landing/home-v2',
      format: 'json',
      buildTime: false,
    });
    expect(json.value).toEqual(readJson('src/content/landing/home-v2.json'));
  });

  it('answers a YAML document', async () => {
    const { json } = await get('authors/noor-haddad');
    expect(json).toMatchObject({
      format: 'yaml',
      value: { name: expect.any(String) },
    });
  });

  it('answers a Markdown document as { data, body }', async () => {
    const { json } = await get('blog/blog-1');
    expect(json.format).toBe('md');
    expect(json.value.data).toMatchObject({
      title: 'What you need to know about Photography',
      tags: ['photography', 'design'],
    });
    expect(json.value.body).toContain('## Creative Design');
  });

  it('answers an MDX document', async () => {
    const { json } = await get('pages/elements');
    expect(json.format).toBe('mdx');
    expect(typeof json.value.body).toBe('string');
  });

  it('answers one entry of a file() entry', async () => {
    const { json } = await get('testimonials/t-ana');
    expect(json.value).toEqual(
      readJson('src/content/testimonials.json').find(
        (t: { id: string }) => t.id === 't-ana',
      ),
    );
  });

  it('answers a data module with its build-time flags', async () => {
    const { json } = await get('data:src/config/config.json');
    expect(json).toMatchObject({
      buildTime: true,
      buildTimeFields: [
        'site.base_url',
        'site.base_path',
        'site.trailing_slash',
      ],
    });
    expect(json.value).toEqual(readJson('src/config/config.json'));
    expect((await get('data:src/config/menu.json')).json.buildTime).toBe(false);
  });

  it('flags config.json and theme.json as build-time and menu.json as not (D1)', async () => {
    const flags = async (file: string) => {
      const { json } = await get(`data:src/config/${file}`);
      return {
        buildTime: json.buildTime,
        buildTimeFields: json.buildTimeFields,
      };
    };
    expect(await flags('config.json')).toEqual({
      buildTime: true,
      buildTimeFields: [
        'site.base_url',
        'site.base_path',
        'site.trailing_slash',
      ],
    });
    // A flagged file without a field list counts as all build-time.
    expect(await flags('theme.json')).toEqual({
      buildTime: true,
      buildTimeFields: ['*'],
    });
    expect(await flags('menu.json')).toEqual({
      buildTime: false,
      buildTimeFields: undefined,
    });
  });

  it('answers 404 for an unknown key and 400 without one', async () => {
    expect((await get('blog/not-there')).status).toBe(404);
    expect((await fetch(`${BASE}/__dev/documents`)).status).toBe(400);
  });
});

describe('Markdown drafts (D2)', () => {
  const blogOne = async () => {
    const response = await fetch(
      `${BASE}/__dev/documents?key=${encodeURIComponent('blog/blog-1')}`,
    );
    return (await response.json()).value as {
      data: Record<string, unknown>;
      body: string;
    };
  };

  it('a draft body changes the rendered post and the blog summary', async () => {
    const post = await blogOne();
    const marker = 'Zebra-quartz marker sentence for the draft body.';
    const draft = {
      // The newest date puts the post first, where /blog prints a summary.
      data: { ...post.data, date: '2030-01-01T00:00:00Z' },
      body: `${marker}\n\n${post.body}`,
    };
    const own = await render('/blog/blog-1', { 'blog/blog-1': draft });
    expect(own.status).toBe(200);
    expect((own.json as Rendered).html).toContain(`<p>${marker}</p>`);
    expect(builtPage('/blog/blog-1')).not.toContain(marker);

    const list = await render('/blog', { 'blog/blog-1': draft });
    expect((list.json as Rendered).html).toContain(marker);
    expect(builtPage('/blog')).not.toContain(marker);
  });

  it('a fence in a language outside the allow-list renders as plain text', async () => {
    const draft = (lang: string) => ({
      'blog/fence': {
        data: { title: 'Fence', date: '2026-10-27', author: 'ana-torres' },
        body: `\`\`\`${lang}\nint x = 1;\n\`\`\`\n`,
      },
    });
    const plain = await render('/blog/fence', draft('cpp'));
    const html = (plain.json as Rendered).html;
    expect(html).toContain('int x = 1;');
    expect(html).not.toMatch(/<pre[^>]*>[\s\S]*<span style=[\s\S]*<\/pre>/);
    expect((plain.json as Rendered).limits).toEqual(['code-language:cpp']);

    // Near miss: css is in the allow-list, so it is highlighted, no limit.
    const css = await render('/blog/fence', draft('css'));
    expect((css.json as Rendered).html).toMatch(
      /<pre[^>]*>[\s\S]*<span style=/,
    );
    expect((css.json as Rendered).limits).toEqual([]);
  });
});

describe('drafts that break a schema (D3)', () => {
  const failures = (json: { errors: Array<{ key: string; path: string[] }> }) =>
    json.errors.map((e) => `${e.key}:${e.path.join('.')}`);

  it('a missing image answers 422 with the field path', async () => {
    const author = readJson('src/content/authors/ana-torres.json');
    const { status, json } = await render('/blog/blog-1', {
      'authors/ana-torres': {
        ...author,
        avatar: '../../assets/authors/not-there.png',
      },
    });
    expect(status).toBe(422);
    expect(failures(json)).toEqual(['authors/ana-torres:avatar']);
  });

  it('a deleted author answers 422 on a drafted post that references it', async () => {
    const post = await (
      await fetch(`${BASE}/__dev/documents?key=blog%2Fblog-1`)
    ).json();
    const { status, json } = await render('/blog/blog-1', {
      'blog/blog-1': post.value,
      'authors/ana-torres': null,
    });
    expect(status).toBe(422);
    expect(failures(json)).toEqual(['blog/blog-1:author']);
  });

  it('a misspelled author id answers 422 with the field path', async () => {
    const { status, json } = await render('/blog/blog-1', {
      'blog/blog-1': {
        data: { title: 'Typo', author: 'ana-torez' },
        body: '',
      },
    });
    expect(status).toBe(422);
    expect(failures(json)).toEqual(['blog/blog-1:author']);
  });

  it('a wrong enum value answers 422 with the field path', async () => {
    const home = readJson('src/content/landing/home-v2.json');
    home.blocks[0].type = 'bannr';
    const { status, json } = await render('/landing/home-v2', {
      'landing/home-v2': home,
    });
    expect(status).toBe(422);
    expect(failures(json)).toEqual(['landing/home-v2:blocks.0.type']);
  });

  // Known gap, pinned on purpose (D3): validation covers only the overlay, so
  // deleting an author alone is not caught. A real build of the same content
  // logs an error and still publishes the post without the author.
  it('a deleted author alone answers 200 and the post loses its author', async () => {
    const { status, json } = await render('/blog/blog-1', {
      'authors/ana-torres': null,
    });
    expect(status).toBe(200);
    expect((json as Rendered).html).not.toContain('Ana Torres');
    expect(builtPage('/blog/blog-1')).toContain('Ana Torres');
  });

  // Near miss: the same edits, fixed, render.
  it('the unbroken versions of those drafts render', async () => {
    const author = readJson('src/content/authors/ana-torres.json');
    expect(
      (
        await render('/blog/blog-1', {
          'authors/ana-torres': { ...author, name: 'Ana T.' },
        })
      ).status,
    ).toBe(200);
  });
});

describe('performance', () => {
  const stat = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))]!;
    return { median: at(0.5), p95: at(0.95), max: at(1) };
  };
  const fmt = ({ median, p95, max }: ReturnType<typeof stat>) =>
    `median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms`;

  /** Edit number i of the Markdown post (a css fence, so Shiki runs). */
  const perfDraft = (i: number) => ({
    'blog/perf-draft': {
      data: {
        title: `Edit ${i}`,
        date: '2026-10-27',
        author: 'ana-torres',
        tags: ['design'],
      },
      body: `## Heading ${i}\n\nSome **text** with a [link](/blog).\n\n\`\`\`css\na { color: red }\n\`\`\`\n`,
    },
  });

  /** 100 consecutive renders of `urlPath`; `documents(i)` is edit number i. */
  async function hundredEdits(
    urlPath: string,
    documents: (i: number) => Record<string, unknown>,
    firstRenderMarker?: string,
  ) {
    const server: number[] = [];
    const wall: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      const { status, json } = await render(urlPath, documents(i));
      wall.push(performance.now() - start);
      expect(status).toBe(200);
      if (i === 0 && firstRenderMarker !== undefined) {
        expect((json as Rendered).html).toContain(firstRenderMarker);
      }
      server.push((json as Rendered).renderMs);
    }
    const renderStat = stat(server);
    console.log(
      `100 renders of ${urlPath}\n  render (server): ${fmt(renderStat)}\n  round trip:      ${fmt(stat(wall))}`,
    );
    return renderStat;
  }

  // Generous bounds (step 7b of QUALITY-TOOLING-PLAN.md): they only catch a big
  // regression, not machine noise.
  it('renders 100 consecutive edits of a page quickly', async () => {
    const home = readJson('src/content/landing/home-v2.json');
    const renderStat = await hundredEdits('/landing/home-v2', (i) => {
      home.blocks[0].title = `Edit ${i}`;
      return { 'landing/home-v2': home };
    });
    expect(renderStat.median).toBeLessThan(30);
    expect(renderStat.p95).toBeLessThan(50);
  });

  it('renders 100 consecutive edits of a Markdown page quickly', async () => {
    const renderStat = await hundredEdits('/blog/perf-draft', perfDraft);
    expect(renderStat.median).toBeLessThan(30);
    expect(renderStat.p95).toBeLessThan(50);
  });

  it('renders 100 consecutive edits of landing/long quickly', async () => {
    const long = readJson('src/content/landing/long.json');
    const firstRenderMarker = 'Landing long draft 0';
    const renderStat = await hundredEdits(
      '/landing/long',
      (i) => {
        long.blocks[0].title = `Landing long draft ${i}`;
        return { 'landing/long': long };
      },
      firstRenderMarker,
    );
    // Wider than the other pages: five runs measured the median at 8 to 33 ms
    // (WORKPLAN 1.8 step 4). Still catches a big regression, not noise.
    expect(renderStat.median).toBeLessThan(60);
    expect(renderStat.p95).toBeLessThan(100);
  });

  // Step 7c of QUALITY-TOOLING-PLAN.md. The server runs with --expose-gc, so
  // /__dev/memory reports after a forced GC. It warms the server up itself, so
  // it passes alone as well as in the full run. The leak check is heapUsed (live
  // objects); RSS also moves with how much heap V8 reserves, so it only gets a
  // loose absolute bound.
  it('keeps memory bounded over 500 more renders', async () => {
    const mb = (bytes: number) => bytes / 1024 / 1024;
    const memory = async () => {
      const res = await fetch(`${BASE}/__dev/memory`);
      const mem = (await res.json()) as {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
        gc: boolean;
      };
      expect(mem.gc).toBe(true);
      return mem;
    };
    const home = readJson('src/content/landing/home-v2.json');
    const renderHome = async (title: string) => {
      home.blocks[0].title = title;
      const { status } = await render('/landing/home-v2', {
        'landing/home-v2': home,
      });
      expect(status).toBe(200);
    };

    for (let i = 0; i < 50; i++) {
      await renderHome(`Warmup ${i}`);
      const { status } = await render('/blog/perf-draft', perfDraft(i));
      expect(status).toBe(200);
    }
    const before = await memory();
    for (let i = 0; i < 500; i++) await renderHome(`Leak ${i}`);
    const after = await memory();

    const growth = mb(after.heapUsed - before.heapUsed);
    const line = (m: Awaited<ReturnType<typeof memory>>) =>
      `rss ${mb(m.rss).toFixed(0)}, heapTotal ${mb(m.heapTotal).toFixed(0)}, heapUsed ${mb(m.heapUsed).toFixed(0)} MB`;
    console.log(
      `memory after warmup:     ${line(before)}\nmemory after 500 renders: ${line(after)} (heapUsed ${growth >= 0 ? '+' : ''}${growth.toFixed(1)} MB)`,
    );
    expect(mb(before.rss)).toBeLessThan(400);
    expect(growth).toBeLessThan(10);
  });
});
