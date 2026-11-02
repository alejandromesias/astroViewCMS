// The test editor's page, stylesheet and script, loaded once at start and kept in
// memory (PHASE-2-DESIGN 5.8). The script is bundled from editor/editor.ts; phase 3
// replaces all of this.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

export interface EditorPage {
  readonly html: string;
  readonly css: string;
  readonly script: string;
}

const EDITOR_DIR = new URL('../../editor/', import.meta.url);

/** Reads index.html and editor.css, and bundles editor.ts. Rejects if a file is missing. */
export async function loadEditorPage(
  dir: URL = EDITOR_DIR,
): Promise<EditorPage> {
  const [html, css, script] = await Promise.all([
    readFile(new URL('index.html', dir), 'utf8'),
    readFile(new URL('editor.css', dir), 'utf8'),
    buildEditorScript(new URL('editor.ts', dir)),
  ]);
  return { html, css, script };
}

/** Bundles one browser entry into a single ES module, in memory (rolldown, no output file). */
async function buildEditorScript(entry: URL): Promise<string> {
  const bundle = await rolldown({
    input: fileURLToPath(entry),
    platform: 'browser',
    logLevel: 'warn',
  });
  try {
    const { output } = await bundle.generate({ format: 'esm' });
    const chunk = output.find((item) => item.type === 'chunk');
    if (!chunk) throw new Error('rolldown produced no script chunk');
    return chunk.code;
  } finally {
    await bundle.close();
  }
}
