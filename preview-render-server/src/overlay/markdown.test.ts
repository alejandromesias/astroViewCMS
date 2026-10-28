import { describe, expect, it, vi } from 'vitest';
import { createOverlayContext, runWithOverlay } from './context.ts';
import { createMarkdownRenderer } from './markdown.ts';

const fakeRenderer = () => ({
  render: vi.fn(async (body: string) => ({
    code: `<p>${body}</p>`,
    metadata: { headings: [{ depth: 1, slug: 'a', text: 'A' }], frontmatter: { added: true } },
  })),
});

describe('createMarkdownRenderer', () => {
  it('renders the draft body with the frontmatter and returns what render() of Astro returns', async () => {
    const renderer = fakeRenderer();
    const create = vi.fn(async () => renderer) as never;
    const render = createMarkdownRenderer(() => ({ gfm: false }), undefined, create);
    const result = await render({ body: 'Hello', data: { title: 'T' } });
    expect(renderer.render).toHaveBeenCalledWith('Hello', { frontmatter: { title: 'T' } });
    expect(result.headings).toEqual([{ depth: 1, slug: 'a', text: 'A' }]);
    expect(result.remarkPluginFrontmatter).toEqual({ added: true });
    expect(typeof result.Content).toBe('function');
  });

  it('builds the processor once, on first use, from the markdown config of the site', async () => {
    const create = vi.fn(async () => fakeRenderer()) as never;
    const options = { gfm: true };
    const render = createMarkdownRenderer(() => options, undefined, create);
    expect(create).not.toHaveBeenCalled();
    await render({ body: 'a', data: {} });
    await render({ body: 'b', data: {} });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(options);
  });

  it('an entry without a body renders empty', async () => {
    const renderer = fakeRenderer();
    const render = createMarkdownRenderer(() => undefined, undefined, (async () => renderer) as never);
    await render({ data: {} });
    expect(renderer.render).toHaveBeenCalledWith('', { frontmatter: {} });
  });
});

describe('code languages', () => {
  const body = '```js\na\n```\n\n```cpp\nb\n```';

  it('renders a fence outside the allowed list as text and adds a code-language limit', async () => {
    const renderer = fakeRenderer();
    const render = createMarkdownRenderer(() => undefined, () => new Set(['javascript']), (async () => renderer) as never);
    const context = createOverlayContext();
    await runWithOverlay(context, () => render({ body, data: {} }));
    expect(renderer.render.mock.calls[0]![0]).toBe('```js\na\n```\n\n```text\nb\n```');
    expect([...context.limits]).toEqual(['code-language:cpp']);
  });

  it('without a list nothing is limited', async () => {
    const renderer = fakeRenderer();
    const render = createMarkdownRenderer(() => undefined, undefined, (async () => renderer) as never);
    const context = createOverlayContext();
    await runWithOverlay(context, () => render({ body, data: {} }));
    expect(renderer.render.mock.calls[0]![0]).toBe(body);
    expect(context.limits.size).toBe(0);
  });

  it('warmUp builds the processor and renders one fence per allowed language', async () => {
    const renderer = fakeRenderer();
    const create = vi.fn(async () => renderer) as never;
    const render = createMarkdownRenderer(() => undefined, () => new Set(['css', 'javascript']), create);
    await render.warmUp();
    expect(renderer.render.mock.calls[0]![0]).toBe('```css\n```\n\n```javascript\n```');
    await render({ body: 'x', data: {} });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('plugin failure', () => {
  const failing = () => ({ render: vi.fn(async () => Promise.reject(new Error('plugin broke'))) });

  it('renders without the plugins and adds markdown-plugins to the limits', async () => {
    const plain = fakeRenderer();
    const create = vi.fn(async (options?: { remarkPlugins?: unknown[] }) => (options?.remarkPlugins?.length === 0 ? plain : failing()));
    const render = createMarkdownRenderer(() => ({ remarkPlugins: [() => {}] }), undefined, create as never);
    const context = createOverlayContext();
    const result = await runWithOverlay(context, () => render({ body: 'Hello', data: {} }));
    expect(result.headings).toHaveLength(1);
    expect(plain.render).toHaveBeenCalledWith('Hello', { frontmatter: {} });
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ syntaxHighlight: false, remarkPlugins: [], rehypePlugins: [] }));
    expect([...context.limits]).toEqual(['markdown-plugins']);
  });

  it('a processor that could not be built is tried again on the next render', async () => {
    const renderer = fakeRenderer();
    const create = vi.fn().mockRejectedValueOnce(new Error('config')).mockResolvedValue(renderer);
    const render = createMarkdownRenderer(() => undefined, undefined, create as never);
    await render({ body: 'a', data: {} });
    const context = createOverlayContext();
    await runWithOverlay(context, () => render({ body: 'b', data: {} }));
    expect(context.limits.size).toBe(0);
  });
});
