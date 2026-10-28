// Code fence languages (SYSTEM-DESIGN.md D2). Shiki loads each language the
// first time a render needs it, which costs time and memory (up to 28 MB and
// 260 ms for one language). Markdown drafts therefore highlight only the
// languages the published site already uses, plus `extraLanguages` of the site
// config; any other fence renders as plain text, and the render reports it.

// Names that mean the same language; the key is what authors write.
const ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  rs: 'rust',
  golang: 'go',
  kt: 'kotlin',
  ps1: 'powershell',
};

// Rendered without loading anything.
const PLAIN = new Set(['', 'text', 'txt', 'plain', 'plaintext']);

/** Lowercase language with aliases resolved (`JS` -> `javascript`). */
export function canonicalLanguage(language: string): string {
  const lower = language.toLowerCase();
  return Object.hasOwn(ALIASES, lower) ? ALIASES[lower] : lower;
}

interface Fence {
  /** Index in the line where the language starts, and the language as written. */
  start: number;
  language: string;
}

const OPENING = /^( {0,3})(`{3,}|~{3,})([ \t]*)([^\s`{]*)/;
const CLOSING = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/;

/** Walks the fenced code blocks of a Markdown text. `visit` is called for
 *  each opening fence with the line's text and returns the line to keep. */
function walkFences(markdown: string, visit: (line: string, fence: Fence) => string): string {
  const lines = markdown.split('\n');
  let open: { char: string; length: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      const closing = CLOSING.exec(line);
      if (closing && closing[1][0] === open.char && closing[1].length >= open.length) open = undefined;
      continue;
    }
    const match = OPENING.exec(line);
    if (!match) continue;
    open = { char: match[2][0], length: match[2].length };
    lines[i] = visit(line, { start: match[1].length + match[2].length + match[3].length, language: match[4] });
  }
  return lines.join('\n');
}

/** The languages of the fences in `markdown`, canonical, without plain text. */
export function codeLanguages(markdown: string): Set<string> {
  const found = new Set<string>();
  walkFences(markdown, (line, { language }) => {
    const canonical = canonicalLanguage(language);
    if (!PLAIN.has(canonical)) found.add(canonical);
    return line;
  });
  return found;
}

/** Turns every fence whose language is not in `allowed` into a plain `text`
 *  fence (the rest of its line, like a title, stays) and calls `onLimited` with
 *  each such language, canonical. */
export function restrictLanguages(
  markdown: string,
  allowed: ReadonlySet<string>,
  onLimited: (language: string) => void,
): string {
  return walkFences(markdown, (line, { start, language }) => {
    const canonical = canonicalLanguage(language);
    if (PLAIN.has(canonical) || allowed.has(canonical)) return line;
    onLimited(canonical);
    return line.slice(0, start) + 'text' + line.slice(start + language.length);
  });
}
