// Latency and memory budgets of the preview server, over the same real server as the
// other e2e files. This file runs as its own Vitest project after the rest
// (vitest.e2e.config.ts), so no other file loads the CPU while a median is measured.
import { describe, expect, it } from 'vitest';
import { BASE, type Rendered, readJson, render } from './client.ts';

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
