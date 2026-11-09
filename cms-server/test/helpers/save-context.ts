// Fakes for the save stages (WORKPLAN 2.5c): a SaveContext whose git, preview and file writer are spies, and whose
// bundle holds the documents the test gives. A stage that reads real files passes its own working copy as siteFolder.
// Test code only.

import type { FieldError, MediaInfo } from 'preview-protocol';
import { vi } from 'vitest';
import type { Bundle, DocumentEntry } from '../../src/bundle/read.ts';
import type { ChangesetRepo } from '../../src/documents/changeset.ts';
import type { RepoTx } from '../../src/git/ops.ts';
import type { PreviewClient, SaveContext } from '../../src/save/context.ts';
import { createDeleteGuard } from '../../src/save/delete-guard.ts';
import { silentLog } from './repo.ts';

/** A bundle that holds `documents` and the given collections. Its identity is the fixture's. */
export function bundleOf(
  documents: readonly DocumentEntry[],
  collections: Bundle['collections'] = new Map(),
): Bundle {
  return {
    identity: {
      bundleId: 'fixture-bundle',
      siteCommit: 'base',
      protocolVersion: 2,
      astroVersion: '7.4.2',
      builtAt: '2026-11-04T03:42:22.323Z',
    },
    documents: new Map(documents.map((document) => [document.key, document])),
    collections,
    routes: [],
    images: [],
  };
}

/** The authors collection: a glob of JSON and YAML files under `src/content/authors`. */
export function authorsCollections(): Bundle['collections'] {
  return new Map([
    [
      'authors',
      {
        loader: {
          kind: 'glob',
          pattern: '**/*.{json,yaml}',
          base: 'src/content/authors',
        },
      },
    ],
  ]);
}

/** A changeset reader that finds nothing changed: no created documents. */
export function emptyChangeset(): ChangesetRepo {
  return {
    changedPaths: vi.fn(async () => []),
    mergeBase: vi.fn(async () => 'base'),
    showAtBytes: vi.fn(async () => null),
    overwrittenSince: vi.fn(async () => new Map<string, string>()),
  };
}

/** A transaction whose calls are spies. `commitSave` resolves with a sha, and the others do nothing. */
export function fakeTx(overrides: Partial<RepoTx> = {}): RepoTx {
  return {
    commitSave: vi.fn(async () => 'sha'),
    restore: vi.fn(async () => {}),
    revParse: vi.fn(async () => {
      throw new Error('revParse is not used by a save');
    }),
    worktreeAdd: vi.fn(async () => '/unused'),
    worktreeRemove: vi.fn(async () => {}),
    fetch: vi.fn(async () => {
      throw new Error('fetch is not used by a save');
    }),
    reapply: vi.fn(async () => {
      throw new Error('reapply is not used by a save');
    }),
    ...overrides,
  };
}

/** A preview node that answers `errors` to every validate. */
export function previewSays(errors: readonly FieldError[] = []): PreviewClient {
  return { validate: vi.fn(async () => errors) };
}

/** The media of `media.json`, as the stage reads it: the file name and the origin. */
export const MEDIA: { readonly mediaFile: string; readonly cmsOrigin: string } =
  {
    mediaFile: 'unused-media.json',
    cmsOrigin: 'http://cms.localhost:4400',
  };

/** A SaveContext with spies and no changes. The overrides replace any field. */
export function saveContext(overrides: Partial<SaveContext> = {}): SaveContext {
  return {
    changes: [],
    bundle: bundleOf([]),
    siteFolder: 'unused-site',
    repo: emptyChangeset(),
    tx: fakeTx(),
    config: { collections: {} },
    preview: previewSays(),
    media: MEDIA,
    log: silentLog(),
    writeFile: vi.fn(async () => {}),
    afterCommit: [],
    guard: createDeleteGuard(),
    reads: new Map(),
    stored: new Map(),
    documents: new Map(),
    plan: [],
    refinements: [],
    rebuild: false,
    revisions: new Map(),
    ...overrides,
  };
}

/** A document entry of the bundle: a file of its own unless `entryKey` is given. */
export function documentOf(
  key: string,
  fields: Partial<DocumentEntry> = {},
): DocumentEntry {
  return {
    key,
    file: `src/content/${key}.json`,
    format: 'json',
    buildTime: false,
    revision: 'bundle-revision',
    ...fields,
  };
}

/** A media entry as `media.json` holds it, with its URL on the CMS origin. */
export function mediaEntry(id: string, format: MediaInfo['format']): MediaInfo {
  return {
    url: `${MEDIA.cmsOrigin}/media/staging/${id}.${format}`,
    width: 2,
    height: 3,
    format,
  };
}
