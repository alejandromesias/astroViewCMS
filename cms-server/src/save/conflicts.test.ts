import { revisionOf } from 'preview-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  removeWorkingCopies,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import {
  bundleOf,
  documentOf,
  emptyChangeset,
  saveContext,
} from '../../test/helpers/save-context.ts';
import type { DocumentEntry } from '../bundle/read.ts';
import { checkRevisions, visibleDocuments } from './conflicts.ts';

const ANA = 'src/content/authors/ana.json';
const ANA_TEXT = '{"name":"Ana"}\n';

afterEach(removeWorkingCopies);

describe('checkRevisions', () => {
  it('passes a change whose base revision matches, and keeps the stored value', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const ctx = saveContext({
      siteFolder,
      bundle: bundleOf([
        documentOf('authors/ana', { file: ANA, revision: 'bundle' }),
      ]),
      changes: [
        {
          document: 'authors/ana',
          baseRevision: revisionOf(ANA_TEXT),
          deleted: false,
          data: { name: 'Ana Torres' },
        },
      ],
    });
    expect(await checkRevisions(ctx)).toBeUndefined();
    expect(ctx.stored.get('authors/ana')).toStrictEqual({ name: 'Ana' });
  });

  it('answers 409 with the revision and value now, for a stale base revision', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const ctx = saveContext({
      siteFolder,
      bundle: bundleOf([documentOf('authors/ana', { file: ANA })]),
      changes: [
        {
          document: 'authors/ana',
          baseRevision: 'old-revision',
          deleted: false,
          data: { name: 'Ana Torres' },
        },
      ],
    });
    expect(await checkRevisions(ctx)).toStrictEqual({
      status: 409,
      body: {
        error: 'conflict',
        documents: [
          {
            key: 'authors/ana',
            revision: revisionOf(ANA_TEXT),
            value: { name: 'Ana' },
          },
        ],
      },
    });
  });

  it('lets a create through when the document is not there', async () => {
    const siteFolder = await tempWorkingCopy({});
    const ctx = saveContext({
      siteFolder,
      changes: [
        {
          document: 'authors/new',
          baseRevision: null,
          deleted: false,
          data: { name: 'New' },
        },
      ],
    });
    expect(await checkRevisions(ctx)).toBeUndefined();
  });

  it('answers 409 with a null revision for an update of a document that is gone', async () => {
    const siteFolder = await tempWorkingCopy({});
    const ctx = saveContext({
      siteFolder,
      bundle: bundleOf([documentOf('authors/ana', { file: ANA })]),
      changes: [
        {
          document: 'authors/ana',
          baseRevision: revisionOf(ANA_TEXT),
          deleted: false,
          data: { name: 'Ana' },
        },
      ],
    });
    expect(await checkRevisions(ctx)).toStrictEqual({
      status: 409,
      body: {
        error: 'conflict',
        documents: [{ key: 'authors/ana', revision: null }],
      },
    });
  });

  it('sees a document that an earlier save created, so its second save is checked too', async () => {
    const text = '---\ntitle: Hi\n---\nBody\n';
    const siteFolder = await tempWorkingCopy({
      'src/content/blog/new.md': text,
    });
    const repo = {
      ...emptyChangeset(),
      changedPaths: vi.fn(async () => [
        { path: 'src/content/blog/new.md', status: 'created' as const },
      ]),
    };
    const ctx = saveContext({
      siteFolder,
      repo,
      bundle: bundleOf(
        [],
        new Map([
          [
            'blog',
            {
              loader: {
                kind: 'glob',
                pattern: '**/*.{md,mdx}',
                base: 'src/content/blog',
              },
            },
          ],
        ]),
      ),
      changes: [
        {
          document: 'blog/new',
          baseRevision: revisionOf(text),
          deleted: false,
          data: { data: { title: 'Hi again' }, body: 'Body\n' },
        },
      ],
    });
    expect(await checkRevisions(ctx)).toBeUndefined();
    expect(ctx.documents.get('blog/new')).toMatchObject({
      key: 'blog/new',
      file: 'src/content/blog/new.md',
      format: 'md',
      buildTime: false,
    });
  });
});

describe('visibleDocuments', () => {
  it('holds the bundle documents, and a created one unless the bundle has its key', () => {
    const listed = documentOf('authors/ana', { revision: 'bundle' });
    const shadow = documentOf('authors/ana', { revision: 'created' });
    const created: DocumentEntry = documentOf('authors/new', {
      revision: 'created',
    });
    const visible = visibleDocuments(bundleOf([listed]), [shadow, created]);
    expect([...visible.keys()]).toStrictEqual(['authors/ana', 'authors/new']);
    expect(visible.get('authors/ana')).toBe(listed);
    expect(visible.get('authors/new')).toBe(created);
  });
});
