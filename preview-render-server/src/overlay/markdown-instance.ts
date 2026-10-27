// The site's one Markdown renderer, shared by the content shim (drafts) and
// the warm-up route, so warming up pays for the renders that follow.
import { manifestDir, markdownConfig } from 'virtual:preview-site';
import { readLanguages } from '../manifest/languages.ts';
import { createMarkdownRenderer } from './markdown.ts';

// Read once, on first use: the build writes the list before the server starts.
let languages: ReturnType<typeof readLanguages> | null = null;

export const markdown = createMarkdownRenderer(
  () => markdownConfig,
  () => (languages ??= readLanguages(manifestDir) ?? undefined),
);
