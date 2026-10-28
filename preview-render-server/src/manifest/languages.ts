import fs from 'node:fs';
import path from 'node:path';
import { canonicalLanguage, codeLanguages } from '../languages.ts';
import type { DataStore } from './documents.ts';

export const LANGUAGES_FILE = 'code-languages.json';
const MARKDOWN_FILE = /\.(md|mdx|markdown)$/i;

/** The code languages Markdown drafts may highlight (D2): those of the code
 *  fences in the site's Markdown and MDX files, plus `extra` from the site
 *  config. Reads the files named by the data store (the store keeps no body for
 *  entries it already rendered). Sorted, canonical. */
export function collectLanguages(
  root: string,
  store: DataStore,
  extra: string[] = [],
): string[] {
  const found = new Set(extra.map(canonicalLanguage));
  for (const entries of store.values()) {
    for (const { filePath } of entries.values()) {
      if (!filePath || !MARKDOWN_FILE.test(filePath)) continue;
      const file = path.resolve(root, filePath);
      if (!fs.existsSync(file)) continue;
      for (const language of codeLanguages(fs.readFileSync(file, 'utf8')))
        found.add(language);
    }
  }
  return [...found].sort();
}

/** The list the build wrote, for the preview server; undefined if there is
 *  none (no restriction then: the languages are not known). */
export function readLanguages(manifestDir: string): Set<string> | undefined {
  try {
    const { languages } = JSON.parse(
      fs.readFileSync(path.join(manifestDir, LANGUAGES_FILE), 'utf8'),
    ) as { languages?: unknown };
    return Array.isArray(languages)
      ? new Set(languages as string[])
      : undefined;
  } catch {
    return undefined;
  }
}
