import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEditorPage } from './page.ts';

describe('loadEditorPage', () => {
  it('reads index.html and editor.css, and bundles editor.ts, from the default folder', async () => {
    const page = await loadEditorPage();
    const dir = new URL('../../editor/', import.meta.url);
    expect(page.html).toBe(await readFile(new URL('index.html', dir), 'utf8'));
    expect(page.css).toBe(await readFile(new URL('editor.css', dir), 'utf8'));
    expect(page.script).not.toMatch(/^import /m);
    expect(page.script).not.toContain('preview-protocol');
    expect(page.script).toContain('/api/documents?key=');
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

  describe('with a fake bundler', () => {
    afterEach(() => {
      vi.doUnmock('rolldown');
      vi.resetModules();
    });

    // Loads page.ts against a fake `rolldown` that records its calls.
    async function loadWith(output: unknown[]) {
      const calls = {
        options: undefined as unknown,
        generate: undefined as unknown,
        closed: 0,
      };
      vi.resetModules();
      vi.doMock('rolldown', () => ({
        rolldown: async (options: unknown) => {
          calls.options = options;
          return {
            generate: async (generateOptions: unknown) => {
              calls.generate = generateOptions;
              return { output };
            },
            close: async () => {
              calls.closed += 1;
            },
          };
        },
      }));
      const { loadEditorPage: load } = await import('./page.ts');
      return { load, calls };
    }

    it('bundles the browser entry as esm, takes the first chunk, and closes the bundle', async () => {
      const { load, calls } = await loadWith([
        { type: 'asset', code: 'not me' },
        { type: 'chunk', code: 'the script' },
      ]);
      const page = await load();
      expect(page.script).toBe('the script');
      expect(calls.generate).toEqual({ format: 'esm' });
      expect(calls.options).toMatchObject({
        platform: 'browser',
        logLevel: 'warn',
      });
      expect(calls.closed).toBe(1);
    });

    it('rejects with the chunk error when the bundler makes none, and still closes the bundle', async () => {
      const { load, calls } = await loadWith([{ type: 'asset', code: 'x' }]);
      await expect(load()).rejects.toThrow(
        new Error('rolldown produced no script chunk'),
      );
      expect(calls.closed).toBe(1);
    });
  });
});
