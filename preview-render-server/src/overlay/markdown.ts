// Markdown drafts (SYSTEM-DESIGN.md D2): `render(entry)` on a draft renders the
// draft body at run time with @astrojs/markdown-remark and the site's own
// `markdown` config (remark and rehype plugins, Shiki theme), and returns what
// Astro's `render()` returns: `Content`, `headings` and the frontmatter that
// remark plugins may have added.
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import type { AstroMarkdownOptions, MarkdownRenderer } from '@astrojs/markdown-remark';
import { createComponent, renderTemplate, unescapeHTML } from 'astro/runtime/server/index.js';
import { restrictLanguages } from '../languages.ts';
import { currentOverlay } from './context.ts';

/** `markdownOptions` is the site's `markdown` config. `languages` gives the
 *  code languages that may be highlighted (undefined: all); a fence in any other
 *  language renders as plain text and adds `code-language:<name>` to the
 *  render's limits. If a plugin throws, the draft renders without the plugins and
 *  adds `markdown-plugins` to the limits. `create` is only for tests. */
export function createMarkdownRenderer(
  markdownOptions: () => AstroMarkdownOptions | undefined,
  languages: () => ReadonlySet<string> | undefined = () => undefined,
  create: typeof createMarkdownProcessor = createMarkdownProcessor,
) {
  // Built on first use: Shiki and the plugins cost memory that sites without
  // Markdown drafts never pay.
  let processor: Promise<MarkdownRenderer> | undefined;
  // A failed build is not kept: the next render tries again.
  const getProcessor = () =>
    (processor ??= create(markdownOptions()).catch((error) => {
      processor = undefined;
      throw error;
    }));

  // Plain Markdown without the site's plugins and Shiki: what a draft shows
  // when a plugin throws.
  let fallback: Promise<MarkdownRenderer> | undefined;
  const renderWithFallback = async (source: string, frontmatter: Record<string, unknown>) => {
    try {
      return await (await getProcessor()).render(source, { frontmatter });
    } catch {
      currentOverlay()?.limits.add('markdown-plugins');
      fallback ??= create({ ...markdownOptions(), syntaxHighlight: false, remarkPlugins: [], rehypePlugins: [] });
      return (await fallback).render(source, { frontmatter });
    }
  };

  const render = async (entry: { body?: string; data: Record<string, unknown> }) => {
    const allowed = languages();
    const body = entry.body ?? '';
    const source = allowed
      ? restrictLanguages(body, allowed, (language) => currentOverlay()?.limits.add(`code-language:${language}`))
      : body;
    const result = await renderWithFallback(source, entry.data);
    const html = result.code;
    return {
      Content: createComponent(() => renderTemplate`${unescapeHTML(html)}`),
      headings: result.metadata.headings,
      remarkPluginFrontmatter: result.metadata.frontmatter ?? {},
    };
  };

  /** Pays the first-render cost ahead of time: builds the processor and
   *  loads every allowed language, so the first real render is fast. */
  const warmUp = async () => {
    const fences = [...(languages() ?? [])].map((language) => '```' + language + '\n```').join('\n\n');
    await renderWithFallback(fences, {});
  };

  return Object.assign(render, { warmUp });
}
