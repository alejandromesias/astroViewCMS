import type { FieldError } from 'preview-protocol';
import { describe, expect, it } from 'vitest';
import type { DocumentEntry } from '../bundle/read.ts';
import type { ChangedDocument, Changeset } from '../documents/changeset.ts';
import type { SyncChange } from '../git/sync.ts';
import {
  type BuildCheckInput,
  type BuildDecision,
  decideBuild,
} from './build-check.ts';
import type { SyncOutcome } from './sync.ts';

const AUTHOR = 'authors/ana';
const PAGE = 'pages/about';
const SITE = 'site/main';

// A bundle record: its format, and its build-time fields (absent for none).
const recordOf = (
  key: string,
  format: DocumentEntry['format'],
  buildTimeFields?: string[],
): DocumentEntry => ({
  key,
  format,
  buildTime: buildTimeFields !== undefined,
  buildTimeFields,
  revision: 'r',
});

// A changed document: its revision at the merge base, unless it was created.
const changed = (
  key: string,
  status: ChangedDocument['status'],
  value?: unknown,
): ChangedDocument => ({
  key,
  status,
  baseRevision: status === 'created' ? null : 'base',
  value,
});

// A changeset of the given documents, with the records of the ones the bundle does not hold and the broken files.
const changeset = (
  documents: ChangedDocument[],
  createdRecords: DocumentEntry[] = [],
  fileErrors: Changeset['fileErrors'] = [],
): Changeset => ({ documents, createdRecords, fileErrors });

const synced = (change: SyncChange): SyncOutcome => ({
  kind: 'synced',
  change,
  tip: 'tip',
  renamed: [],
  upstream: 'upstream',
});

const failedSync: SyncOutcome = {
  kind: 'failed',
  message: 'the remote cannot be read',
};

const refinement = (key: string): FieldError => ({
  key,
  path: ['name'],
  message: 'the refinement threw',
  kind: 'refinement-threw',
});

// The decision of `auto` for the input, with a default that changes nothing: no document, and a sync with no change.
function decide(overrides: Partial<BuildCheckInput> = {}): BuildDecision {
  return decideBuild({
    mode: 'auto',
    changeset: changeset([]),
    bundled: new Map(),
    before: new Map(),
    validate: [],
    sync: synced('none'),
    ...overrides,
  });
}

// A content-only change: an author's name changes, and the author has no build-time field.
function contentOnly(): Partial<BuildCheckInput> {
  return {
    changeset: changeset([changed(AUTHOR, 'modified', { name: 'Ana Maria' })]),
    bundled: new Map([[AUTHOR, recordOf(AUTHOR, 'json')]]),
    before: new Map([[AUTHOR, { name: 'Ana' }]]),
  };
}

// A changeset that holds every trigger of `auto` at once: an MDX body, a build-time field, a refinement that threw and code
// from upstream.
function everyTrigger(): Partial<BuildCheckInput> {
  return {
    changeset: changeset([
      changed(PAGE, 'modified', { data: {}, body: 'new' }),
      changed(SITE, 'modified', { site: { base_url: '/b' } }),
    ]),
    bundled: new Map([
      [PAGE, recordOf(PAGE, 'mdx')],
      [SITE, recordOf(SITE, 'json', ['site.base_url'])],
    ]),
    before: new Map([
      [PAGE, { data: {}, body: 'old' }],
      [SITE, { site: { base_url: '/a' } }],
    ]),
    validate: [refinement(AUTHOR)],
    sync: synced('code'),
  };
}

describe('decideBuild, the mode', () => {
  it('builds with no reason under always, whatever the changeset holds', () => {
    expect(decide({ mode: 'always', ...contentOnly() })).toStrictEqual({
      build: true,
    });
  });

  it('does not build under never, even when every trigger is present', () => {
    expect(decide({ mode: 'never', ...everyTrigger() })).toStrictEqual({
      build: false,
    });
  });
});

describe('decideBuild under auto: changes that must not build', () => {
  it('skips the build for a content-only change', () => {
    expect(decide(contentOnly())).toStrictEqual({ build: false });
  });

  it('skips the build for a content-only change when sync found no change', () => {
    expect(decide({ ...contentOnly(), sync: synced('none') })).toStrictEqual({
      build: false,
    });
  });

  it('skips the build for a content-only change when sync brought content only', () => {
    expect(
      decide({ ...contentOnly(), sync: synced('content-only') }),
    ).toStrictEqual({ build: false });
  });

  it('skips the build for a change to a field that is not build-time', () => {
    expect(
      decide({
        changeset: changeset([
          changed(SITE, 'modified', { site: { base_url: '/a', name: 'y' } }),
        ]),
        bundled: new Map([[SITE, recordOf(SITE, 'json', ['site.base_url'])]]),
        before: new Map([[SITE, { site: { base_url: '/a', name: 'x' } }]]),
      }),
    ).toStrictEqual({ build: false });
  });

  it('skips the build when a whole-value build-time field only has its keys reordered', () => {
    expect(
      decide({
        changeset: changeset([
          changed(SITE, 'modified', { site: { name: 'x', base_url: '/a' } }),
        ]),
        bundled: new Map([[SITE, recordOf(SITE, 'json', ['*'])]]),
        before: new Map([[SITE, { site: { base_url: '/a', name: 'x' } }]]),
      }),
    ).toStrictEqual({ build: false });
  });

  it('skips the build for an MDX frontmatter change when the body is unchanged', () => {
    expect(
      decide({
        changeset: changeset([
          changed(PAGE, 'modified', { data: { title: 'b' }, body: 'Text' }),
        ]),
        bundled: new Map([[PAGE, recordOf(PAGE, 'mdx')]]),
        before: new Map([[PAGE, { data: { title: 'a' }, body: 'Text' }]]),
      }),
    ).toStrictEqual({ build: false });
  });

  it('skips the build for a Markdown body change, since the preview renders it', () => {
    expect(
      decide({
        changeset: changeset([
          changed(PAGE, 'modified', { data: {}, body: 'b' }),
        ]),
        bundled: new Map([[PAGE, recordOf(PAGE, 'md')]]),
        before: new Map([[PAGE, { data: {}, body: 'a' }]]),
      }),
    ).toStrictEqual({ build: false });
  });

  it('skips the build for a created document with no build-time fields', () => {
    expect(
      decide({
        changeset: changeset(
          [changed(AUTHOR, 'created', { name: 'Ana' })],
          [recordOf(AUTHOR, 'json')],
        ),
      }),
    ).toStrictEqual({ build: false });
  });

  it('skips the build for a deleted document with no build-time fields', () => {
    expect(
      decide({
        changeset: changeset([changed(AUTHOR, 'deleted')]),
        bundled: new Map([[AUTHOR, recordOf(AUTHOR, 'json')]]),
        before: new Map([[AUTHOR, { name: 'Ana' }]]),
      }),
    ).toStrictEqual({ build: false });
  });
});

describe('decideBuild under auto: each reason', () => {
  it('builds for mdx-body when an MDX body changed', () => {
    expect(
      decide({
        changeset: changeset([
          changed(PAGE, 'modified', { data: { title: 'a' }, body: 'new' }),
        ]),
        bundled: new Map([[PAGE, recordOf(PAGE, 'mdx')]]),
        before: new Map([[PAGE, { data: { title: 'a' }, body: 'old' }]]),
      }),
    ).toStrictEqual({ build: true, reason: 'mdx-body' });
  });

  it('builds for mdx-body when an MDX document is created', () => {
    expect(
      decide({
        changeset: changeset(
          [changed(PAGE, 'created', { data: {}, body: 'new' })],
          [recordOf(PAGE, 'mdx')],
        ),
      }),
    ).toStrictEqual({ build: true, reason: 'mdx-body' });
  });

  it('builds for mdx-body when an MDX document is deleted', () => {
    expect(
      decide({
        changeset: changeset([changed(PAGE, 'deleted')]),
        bundled: new Map([[PAGE, recordOf(PAGE, 'mdx')]]),
        before: new Map([[PAGE, { data: {}, body: 'old' }]]),
      }),
    ).toStrictEqual({ build: true, reason: 'mdx-body' });
  });

  it('builds for mdx-body when an MDX document is deleted, even with no stored value', () => {
    expect(
      decide({
        changeset: changeset([changed(PAGE, 'deleted')]),
        bundled: new Map([[PAGE, recordOf(PAGE, 'mdx')]]),
      }),
    ).toStrictEqual({ build: true, reason: 'mdx-body' });
  });

  it('builds for build-time-field when a document with build-time fields is deleted, even with no stored value', () => {
    expect(
      decide({
        changeset: changeset([changed(SITE, 'deleted')]),
        bundled: new Map([[SITE, recordOf(SITE, 'json', ['site.base_url'])]]),
      }),
    ).toStrictEqual({ build: true, reason: 'build-time-field' });
  });

  it('builds for build-time-field when a listed field changed', () => {
    expect(
      decide({
        changeset: changeset([
          changed(SITE, 'modified', { site: { base_url: '/b' } }),
        ]),
        bundled: new Map([[SITE, recordOf(SITE, 'json', ['site.base_url'])]]),
        before: new Map([[SITE, { site: { base_url: '/a' } }]]),
      }),
    ).toStrictEqual({ build: true, reason: 'build-time-field' });
  });

  it('builds for build-time-field when the whole value of a `*` field changed', () => {
    expect(
      decide({
        ...contentOnly(),
        bundled: new Map([[AUTHOR, recordOf(AUTHOR, 'json', ['*'])]]),
      }),
    ).toStrictEqual({ build: true, reason: 'build-time-field' });
  });

  it('builds for build-time-field when a document with build-time fields is deleted', () => {
    expect(
      decide({
        changeset: changeset([changed(SITE, 'deleted')]),
        bundled: new Map([[SITE, recordOf(SITE, 'json', ['site.base_url'])]]),
        before: new Map([[SITE, { site: { base_url: '/a' } }]]),
      }),
    ).toStrictEqual({ build: true, reason: 'build-time-field' });
  });

  it('builds for refinement-threw when a refinement of a changed document threw', () => {
    expect(
      decide({ ...contentOnly(), validate: [refinement(AUTHOR)] }),
    ).toStrictEqual({ build: true, reason: 'refinement-threw' });
  });

  it('does not count an error of kind invalid, or one with no kind, as a refinement', () => {
    expect(
      decide({
        ...contentOnly(),
        validate: [
          { key: AUTHOR, path: ['name'], message: 'bad', kind: 'invalid' },
          { key: PAGE, path: [], message: 'bad' },
        ],
      }),
    ).toStrictEqual({ build: false });
  });

  it('builds for upstream-code when sync brought code', () => {
    expect(decide({ ...contentOnly(), sync: synced('code') })).toStrictEqual({
      build: true,
      reason: 'upstream-code',
    });
  });

  it('builds as unknown when sync failed', () => {
    expect(decide({ ...contentOnly(), sync: failedSync })).toStrictEqual({
      build: true,
      reason: 'unknown',
    });
  });

  it('builds as unknown when the changeset holds a file that does not parse', () => {
    expect(
      decide({
        ...contentOnly(),
        changeset: changeset(
          [changed(AUTHOR, 'modified', { name: 'Ana Maria' })],
          [],
          [
            {
              path: 'src/authors/bo.json',
              error: { code: 'parse', message: 'unexpected token' },
            },
          ],
        ),
      }),
    ).toStrictEqual({ build: true, reason: 'unknown' });
  });

  it('builds as unknown when a changed document cannot be read', () => {
    expect(
      decide({
        ...contentOnly(),
        changeset: changeset([
          {
            key: AUTHOR,
            status: 'modified',
            baseRevision: 'base',
            error: { code: 'parse', message: 'unexpected token' },
          },
        ]),
      }),
    ).toStrictEqual({ build: true, reason: 'unknown' });
  });

  it('builds as unknown when a deleted document has no record to read its fields from', () => {
    expect(
      decide({ changeset: changeset([changed('authors/gone', 'deleted')]) }),
    ).toStrictEqual({ build: true, reason: 'unknown' });
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'builds as unknown for a document %s that the bundle does not hold',
    (key) => {
      expect(
        decide({ changeset: changeset([changed(key, 'deleted')]) }),
      ).toStrictEqual({ build: true, reason: 'unknown' });
    },
  );
});

describe('decideBuild under auto: which reason is reported', () => {
  it('reports mdx-body over the other reasons', () => {
    expect(decide(everyTrigger())).toStrictEqual({
      build: true,
      reason: 'mdx-body',
    });
  });

  it('reports build-time-field over refinement-threw and upstream-code', () => {
    expect(
      decide({
        ...everyTrigger(),
        changeset: changeset([
          changed(SITE, 'modified', { site: { base_url: '/b' } }),
        ]),
      }),
    ).toStrictEqual({ build: true, reason: 'build-time-field' });
  });

  it('reports refinement-threw over upstream-code', () => {
    expect(
      decide({
        ...contentOnly(),
        validate: [refinement(AUTHOR)],
        sync: synced('code'),
      }),
    ).toStrictEqual({ build: true, reason: 'refinement-threw' });
  });

  it('reports a known reason over unknown, when sync failed', () => {
    expect(
      decide({
        ...contentOnly(),
        validate: [refinement(AUTHOR)],
        sync: failedSync,
      }),
    ).toStrictEqual({ build: true, reason: 'refinement-threw' });
  });

  it('reports upstream-code over unknown, when a file does not parse', () => {
    expect(
      decide({
        ...contentOnly(),
        sync: synced('code'),
        changeset: changeset(
          [changed(AUTHOR, 'modified', { name: 'Ana Maria' })],
          [],
          [
            {
              path: 'src/authors/bo.json',
              error: { code: 'parse', message: 'unexpected token' },
            },
          ],
        ),
      }),
    ).toStrictEqual({ build: true, reason: 'upstream-code' });
  });
});
