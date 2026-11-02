import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { loadConfig } from './load.ts';

const TMP_ROOT = fileURLToPath(new URL('../../.test-tmp/', import.meta.url));

// A fresh temp folder inside the workspace (gitignored), one per test.
async function tempFolder(): Promise<string> {
  await mkdir(TMP_ROOT, { recursive: true });
  return mkdtemp(join(TMP_ROOT, 'load-'));
}

describe('loadConfig', () => {
  it('imports the default export of a .ts file and parses it', async () => {
    const dir = await tempFolder();
    try {
      const path = join(dir, 'cms.config.ts');
      await writeFile(
        path,
        `export default ${JSON.stringify({
          site: 'sample-site',
          remote: 'git@github.com:owner/site.git',
          previewSiteConfig:
            'preview-render-server/sites/sample-site.config.ts',
          origins: {
            cms: 'http://cms.localhost:4400',
            preview: 'http://preview.localhost:4401',
          },
        })};\n`,
      );
      expect(await loadConfig(path)).toEqual({
        site: 'sample-site',
        remote: 'git@github.com:owner/site.git',
        branch: 'main',
        siteDir: '.',
        previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
        origins: {
          cms: 'http://cms.localhost:4400',
          preview: 'http://preview.localhost:4401',
        },
        publish: { buildCheck: 'auto' },
        media: { folder: 'src/assets/uploads' },
        syncIntervalSeconds: 60,
        collections: {},
        git: { author: 'astroViewCMS <cms@localhost>' },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a file whose default export is not a valid config', async () => {
    const dir = await tempFolder();
    try {
      const path = join(dir, 'cms.config.ts');
      await writeFile(path, 'export const config = { site: "sample-site" };\n');
      const error = await loadConfig(path).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      if (!(error instanceof ZodError)) throw new Error('expected a ZodError');
      expect(error.issues).toEqual([
        expect.objectContaining({
          path: [],
          message: 'Invalid input: expected object, received undefined',
        }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
