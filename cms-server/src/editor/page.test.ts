import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadEditorPage } from './page.ts';

describe('loadEditorPage', () => {
  it('reads index.html and editor.css, and bundles editor.ts, from the default folder', async () => {
    const page = await loadEditorPage();
    const dir = new URL('../../editor/', import.meta.url);
    expect(page.html).toBe(await readFile(new URL('index.html', dir), 'utf8'));
    expect(page.css).toBe(await readFile(new URL('editor.css', dir), 'utf8'));
    expect(page.script).not.toMatch(/^import /m);
    expect(page.script).not.toContain('preview-protocol');
    expect(page.script).toContain('/__dev/documents?key=');
  });

  it('rejects with ENOENT when a file is missing from the folder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'editor-page-'));
    try {
      await expect(
        loadEditorPage(pathToFileURL(`${dir}${path.sep}`)),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
