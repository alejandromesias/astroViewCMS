import { describe, expect, it } from 'vitest';
import { FIXTURE_BUNDLE } from '../../test/helpers/bundle.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import { createBundleStore } from '../bundle/store.ts';
import type { ChangedPath } from './ops.ts';
import { classifyChange, type DocumentFile, siteScope } from './sync.ts';

// The documents of the fixture bundle (test/fixtures/bundle), as the bundle reader gives them. Read per test.
async function fixtureDocuments(): Promise<DocumentFile[]> {
  const bundle = await createBundleStore(
    directoryBundleSource(FIXTURE_BUNDLE),
  ).current();
  if (bundle === null) throw new Error('the fixture bundle has no bundle.json');
  return [...bundle.documents.values()];
}

// One changed path, as `git diff --name-status` reports it after the parser.
function change(
  path: string,
  status: ChangedPath['status'] = 'modified',
): ChangedPath {
  return { path, status };
}

describe('classifyChange', () => {
  it('is none when no path changed', async () => {
    expect(
      classifyChange({
        changes: [],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('none');
  });

  it('is content-only when the only change modifies a content document file', async () => {
    expect(
      classifyChange({
        changes: [change('site/src/content/blog/blog-1.md')],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('content-only');
  });

  it('is content-only when every entry of a shared file is a content document', async () => {
    // stats.yaml holds stats/editors, stats/sites and stats/uptime, all non-build-time.
    expect(
      classifyChange({
        changes: [change('site/src/content/stats.yaml')],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('content-only');
  });

  it('is content-only for a site at the repo root', async () => {
    expect(
      classifyChange({
        changes: [change('src/content/blog/blog-1.md')],
        documents: await fixtureDocuments(),
        siteDir: '.',
      }),
    ).toBe('content-only');
  });

  it('is content-only for a site folder written with a leading ./ and a trailing slash', async () => {
    expect(
      classifyChange({
        changes: [change('site/src/content/blog/blog-1.md')],
        documents: await fixtureDocuments(),
        siteDir: './site/',
      }),
    ).toBe('content-only');
  });

  it('is code when content.config.ts changes', async () => {
    expect(
      classifyChange({
        changes: [change('site/src/content.config.ts')],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it.each([['src/config/theme.json'], ['src/config/config.json']])(
    'is code when a build-time document changes (%s)',
    async (file) => {
      expect(
        classifyChange({
          changes: [change(`site/${file}`)],
          documents: await fixtureDocuments(),
          siteDir: 'site',
        }),
      ).toBe('code');
    },
  );

  it('is code when a content change comes with a build-time change', async () => {
    expect(
      classifyChange({
        changes: [
          change('site/src/content/blog/blog-1.md'),
          change('site/src/config/theme.json'),
        ],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it('is code when a content change comes with an added file', async () => {
    expect(
      classifyChange({
        changes: [
          change('site/src/content/blog/blog-1.md'),
          change('site/src/content/blog/blog-6.md', 'created'),
        ],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it('is code when a new document is added', async () => {
    expect(
      classifyChange({
        changes: [change('site/src/content/blog/blog-6.md', 'created')],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it('is code when a content document is deleted', async () => {
    expect(
      classifyChange({
        changes: [change('site/src/content/blog/blog-1.md', 'deleted')],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it('is code when an image changes', async () => {
    expect(
      classifyChange({
        changes: [change('site/src/assets/logo.png')],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it.each([
    ['README.md'],
    ['docs/src/content/blog/blog-1.md'],
    ['site-two/src/content/blog/blog-1.md'],
  ])('is code for a path outside the site folder (%s)', async (path) => {
    expect(
      classifyChange({
        changes: [change(path)],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it.each([
    ['site/src/content/blog/blog-1.md.bak'],
    ['site/src/content/blog/blog-1.mdx'],
    ['site/src/content/blog/blog-1'],
    ['site/constructor'],
  ])('is code for a path that is not a document file (%s)', async (path) => {
    expect(
      classifyChange({
        changes: [change(path)],
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it('is code when the change cannot be read (no commit, or a failed diff)', async () => {
    expect(
      classifyChange({
        changes: null,
        documents: await fixtureDocuments(),
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it('is code when there is no bundle, even with no change', async () => {
    expect(
      classifyChange({ changes: [], documents: null, siteDir: 'site' }),
    ).toBe('code');
  });

  it('is code when there is no bundle and a content file changed', async () => {
    expect(
      classifyChange({
        changes: [change('site/src/content/blog/blog-1.md')],
        documents: null,
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it('is code when the only document has no file', async () => {
    expect(
      classifyChange({
        changes: [change('site/undefined')],
        documents: [{ buildTime: false }],
        siteDir: 'site',
      }),
    ).toBe('code');
  });

  it('is code for a file shared by a build-time document and a content document', async () => {
    expect(
      classifyChange({
        changes: [change('site/shared.json')],
        documents: [
          { file: 'shared.json', buildTime: false },
          { file: 'shared.json', buildTime: true },
        ],
        siteDir: 'site',
      }),
    ).toBe('code');
  });
});

describe('siteScope', () => {
  it.each([
    ['.', '.'],
    ['./', '.'],
    ['site', 'site'],
    ['site/', 'site'],
    ['./site/', 'site'],
    ['site/nested/', 'site/nested'],
  ])('gives %s the scope %s', (siteDir, scope) => {
    expect(siteScope(siteDir)).toBe(scope);
  });
});
