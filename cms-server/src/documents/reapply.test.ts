// Unit tests of the re-apply plan (WORKPLAN 2.10b). The repo is faked: the plan reads files through `reads` only, and the
// changeset is built by hand, so each branch of the plan has one test that fails when the branch changes.
import { revisionOf } from 'preview-contract';
import { describe, expect, it } from 'vitest';
import type { DocumentEntry } from '../bundle/read.ts';
import type { ChangedDocument, Changeset } from './changeset.ts';
import {
  commitParagraphs,
  planReapply,
  type ReapplyReads,
  trailersOf,
} from './reapply.ts';
import { entryRevision } from './revision.ts';

const UPSTREAM = 'b'.repeat(40);
const OLD = 'c'.repeat(40);

const ANA_PATH = 'src/content/authors/ana.json';
const ANA: DocumentEntry = {
  key: 'authors/ana',
  file: ANA_PATH,
  format: 'json',
  buildTime: false,
  revision: 'x',
};
const SHARED_PATH = 'src/content/testimonials.json';
const ENTRY_A: DocumentEntry = {
  key: 'testimonials/a',
  file: SHARED_PATH,
  format: 'json',
  entryKey: 'a',
  buildTime: false,
  revision: 'x',
};

const SHARED_BASE = [
  { id: 'a', text: 'Alpha' },
  { id: 'b', text: 'Beta' },
];
// The revision of entry `a` at the merge base, as changesetOf records it.
const A_BASE_REVISION = entryRevision(SHARED_BASE, SHARED_BASE[0]);

// A changeset of the given documents, with no created records and no file errors.
function changesetOf(
  documents: ChangedDocument[],
  fileErrors: Changeset['fileErrors'] = [],
): Changeset {
  return { documents, createdRecords: [], fileErrors };
}

// The records of the bundle, by key.
function recordsOf(...entries: DocumentEntry[]): Map<string, DocumentEntry> {
  return new Map(entries.map((entry) => [entry.key, entry] as const));
}

// Reads over two maps of path to bytes: `upstream` is the new commit, `base` the merge base.
function readsOf(
  upstream: ReadonlyMap<string, Buffer> = new Map(),
  base: ReadonlyMap<string, Buffer> = new Map(),
): ReapplyReads {
  return {
    upstream: async (path) => upstream.get(path) ?? null,
    base: async (path) => base.get(path) ?? null,
  };
}

// The bytes of a JSON text.
function bytesOf(text: string): Buffer {
  return Buffer.from(text);
}

describe('planReapply: a document with a file of its own', () => {
  it('writes a saved document into the upstream text when upstream did not change it', async () => {
    const text = '{"name":"Ana"}';
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/ana',
          status: 'modified',
          baseRevision: revisionOf(bytesOf(text)),
          value: { name: 'Ana M.' },
        },
      ]),
      recordsOf(ANA),
      readsOf(new Map([[ANA_PATH, bytesOf(text)]])),
    );
    expect(plan.changes).toEqual([
      { op: 'update', key: 'authors/ana', value: { name: 'Ana M.' } },
    ]);
    expect([...plan.blank]).toEqual([]);
    expect([...plan.overwritten]).toEqual([]);
  });

  it('records the document as overwritten when upstream changed it since the base', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/ana',
          status: 'modified',
          baseRevision: revisionOf(bytesOf('{"name":"Ana"}')),
          value: { name: 'Ana M.' },
        },
      ]),
      recordsOf(ANA),
      readsOf(new Map([[ANA_PATH, bytesOf('{"name":"Ana","x":1}')]])),
    );
    expect([...plan.overwritten]).toEqual(['authors/ana']);
  });

  it('makes the file again from a blank text when upstream lacks it', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/ana',
          status: 'modified',
          baseRevision: revisionOf(bytesOf('{"name":"Ana"}')),
          value: { name: 'Ana M.' },
        },
      ]),
      recordsOf(ANA),
      readsOf(),
    );
    expect(plan.changes).toEqual([
      { op: 'update', key: 'authors/ana', value: { name: 'Ana M.' } },
    ]);
    expect([...plan.blank]).toEqual([[ANA_PATH, '']]);
    expect([...plan.overwritten]).toEqual(['authors/ana']);
  });

  it('does not record a created document that upstream has not made', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/new',
          status: 'created',
          baseRevision: null,
          value: { name: 'New' },
        },
      ]),
      recordsOf({
        ...ANA,
        key: 'authors/new',
        file: 'src/content/authors/new.json',
      }),
      readsOf(),
    );
    expect([...plan.blank]).toEqual([['src/content/authors/new.json', '']]);
    expect([...plan.overwritten]).toEqual([]);
  });

  it('records a created document that upstream already has at its path as overwritten', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/new',
          status: 'created',
          baseRevision: null,
          value: { name: 'New' },
        },
      ]),
      recordsOf({
        ...ANA,
        key: 'authors/new',
        file: 'src/content/authors/new.json',
      }),
      readsOf(
        new Map([
          ['src/content/authors/new.json', bytesOf('{"name":"Other"}')],
        ]),
      ),
    );
    expect([...plan.blank]).toEqual([]);
    expect([...plan.overwritten]).toEqual(['authors/new']);
  });

  it('deletes a document that upstream still has, and records no overwrite when upstream did not change it', async () => {
    const text = '{"name":"Ana"}';
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/ana',
          status: 'deleted',
          baseRevision: revisionOf(bytesOf(text)),
        },
      ]),
      recordsOf(ANA),
      readsOf(new Map([[ANA_PATH, bytesOf(text)]])),
    );
    expect(plan.changes).toEqual([{ op: 'delete', key: 'authors/ana' }]);
    expect([...plan.overwritten]).toEqual([]);
  });

  it('records a deletion over a document upstream edited as overwritten', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/ana',
          status: 'deleted',
          baseRevision: revisionOf(bytesOf('{"name":"Ana"}')),
        },
      ]),
      recordsOf(ANA),
      readsOf(new Map([[ANA_PATH, bytesOf('{"name":"Ana","x":1}')]])),
    );
    expect(plan.changes).toEqual([{ op: 'delete', key: 'authors/ana' }]);
    expect([...plan.overwritten]).toEqual(['authors/ana']);
  });

  it('leaves a deleted document alone when upstream no longer has it', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/ana',
          status: 'deleted',
          baseRevision: revisionOf(bytesOf('{"name":"Ana"}')),
        },
      ]),
      recordsOf(ANA),
      readsOf(),
    );
    expect(plan.changes).toEqual([]);
    expect([...plan.overwritten]).toEqual([]);
  });
});

describe('planReapply: an entry of a shared file', () => {
  const SHARED_TEXT = JSON.stringify(SHARED_BASE);

  it('replaces a saved entry that upstream still has, and records no overwrite when it is unchanged', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: A_BASE_REVISION,
          value: { id: 'a', text: 'Alpha CMS' },
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(new Map([[SHARED_PATH, bytesOf(SHARED_TEXT)]])),
    );
    expect(plan.changes).toEqual([
      {
        op: 'update',
        key: 'testimonials/a',
        value: { id: 'a', text: 'Alpha CMS' },
      },
    ]);
    expect([...plan.overwritten]).toEqual([]);
  });

  it('records an entry that upstream edited since the base as overwritten', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: A_BASE_REVISION,
          value: { id: 'a', text: 'Alpha CMS' },
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(
        new Map([
          [
            SHARED_PATH,
            bytesOf(
              JSON.stringify([{ id: 'a', text: 'Alpha dev' }, SHARED_BASE[1]]),
            ),
          ],
        ]),
      ),
    );
    expect([...plan.overwritten]).toEqual(['testimonials/a']);
  });

  it('adds a saved entry that upstream removed, to the file it still has', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: A_BASE_REVISION,
          value: { id: 'a', text: 'Alpha CMS' },
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(
        new Map([[SHARED_PATH, bytesOf(JSON.stringify([SHARED_BASE[1]]))]]),
      ),
    );
    expect(plan.changes).toEqual([
      {
        op: 'create',
        collection: 'testimonials',
        id: 'a',
        value: { id: 'a', text: 'Alpha CMS' },
      },
    ]);
    expect([...plan.blank]).toEqual([]);
    expect([...plan.overwritten]).toEqual(['testimonials/a']);
  });

  it('makes a missing shared file again from an empty array when the base file is an array', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: A_BASE_REVISION,
          value: { id: 'a', text: 'Alpha CMS' },
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(new Map(), new Map([[SHARED_PATH, bytesOf(SHARED_TEXT)]])),
    );
    expect([...plan.blank]).toEqual([[SHARED_PATH, '[]']]);
    expect(plan.changes).toEqual([
      {
        op: 'create',
        collection: 'testimonials',
        id: 'a',
        value: { id: 'a', text: 'Alpha CMS' },
      },
    ]);
    expect([...plan.overwritten]).toEqual(['testimonials/a']);
  });

  it('makes a missing shared file again from an empty object when the base file is keyed', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: null,
          value: { text: 'Alpha CMS' },
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(
        new Map(),
        new Map([[SHARED_PATH, bytesOf('{"a":{"text":"Alpha"}}')]]),
      ),
    );
    expect([...plan.blank]).toEqual([[SHARED_PATH, '{}']]);
  });

  it('starts a missing shared file from an empty array when the base has no file or cannot be parsed', async () => {
    const missing = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: null,
          value: { id: 'a', text: 'Alpha CMS' },
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(),
    );
    expect([...missing.blank]).toEqual([[SHARED_PATH, '[]']]);
    const broken = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: null,
          value: { id: 'a', text: 'Alpha CMS' },
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(new Map(), new Map([[SHARED_PATH, bytesOf('[')]])),
    );
    expect([...broken.blank]).toEqual([[SHARED_PATH, '[]']]);
  });

  it('starts a missing shared file from an empty array when the base file parses to null', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: null,
          value: { id: 'a', text: 'Alpha CMS' },
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(new Map(), new Map([[SHARED_PATH, bytesOf('null')]])),
    );
    expect([...plan.blank]).toEqual([[SHARED_PATH, '[]']]);
  });

  it('deletes an entry that upstream still has, and records an overwrite when upstream changed it', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'deleted',
          baseRevision: A_BASE_REVISION,
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(
        new Map([
          [
            SHARED_PATH,
            bytesOf(JSON.stringify([{ id: 'a', text: 'Alpha dev' }])),
          ],
        ]),
      ),
    );
    expect(plan.changes).toEqual([{ op: 'delete', key: 'testimonials/a' }]);
    expect([...plan.overwritten]).toEqual(['testimonials/a']);
  });

  it('leaves a deleted entry alone when upstream no longer has it', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'deleted',
          baseRevision: A_BASE_REVISION,
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(
        new Map([[SHARED_PATH, bytesOf(JSON.stringify([SHARED_BASE[1]]))]]),
      ),
    );
    expect(plan.changes).toEqual([]);
    expect([...plan.overwritten]).toEqual([]);
  });

  it('passes a shared file that does not parse upstream to planWrite, which names it', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: A_BASE_REVISION,
          value: { id: 'a', text: 'Alpha CMS' },
        },
      ]),
      recordsOf(ENTRY_A),
      readsOf(new Map([[SHARED_PATH, bytesOf('[')]])),
    );
    expect(plan.changes).toEqual([
      {
        op: 'update',
        key: 'testimonials/a',
        value: { id: 'a', text: 'Alpha CMS' },
      },
    ]);
  });

  it('passes an entry in a format with no codec to planWrite, which refuses it', async () => {
    const toml: DocumentEntry = { ...ENTRY_A, format: 'toml' };
    const plan = await planReapply(
      changesetOf([
        {
          key: 'testimonials/a',
          status: 'modified',
          baseRevision: A_BASE_REVISION,
          value: { id: 'a' },
        },
      ]),
      recordsOf(toml),
      readsOf(new Map([[SHARED_PATH, bytesOf(SHARED_TEXT)]])),
    );
    expect(plan.changes).toEqual([
      { op: 'update', key: 'testimonials/a', value: { id: 'a' } },
    ]);
  });

  it('adds a saved entry whose key has no collection by an update, which planWrite refuses', async () => {
    const bare: DocumentEntry = { ...ENTRY_A, key: 'a' };
    const plan = await planReapply(
      changesetOf([
        {
          key: 'a',
          status: 'modified',
          baseRevision: null,
          value: { id: 'a' },
        },
      ]),
      recordsOf(bare),
      readsOf(
        new Map([[SHARED_PATH, bytesOf(JSON.stringify([SHARED_BASE[1]]))]]),
      ),
    );
    expect(plan.changes).toEqual([
      { op: 'update', key: 'a', value: { id: 'a' } },
    ]);
  });
});

describe('planReapply: documents the plan cannot place', () => {
  it('passes a document with no record to planWrite, which refuses it', async () => {
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/ghost',
          status: 'modified',
          baseRevision: null,
          value: { name: 'Ghost' },
        },
        { key: 'authors/gone', status: 'deleted', baseRevision: null },
      ]),
      new Map(),
      readsOf(),
    );
    expect(plan.changes).toEqual([
      { op: 'update', key: 'authors/ghost', value: { name: 'Ghost' } },
      { op: 'delete', key: 'authors/gone' },
    ]);
  });

  it('passes a document whose record has no file to planWrite, which refuses it', async () => {
    const noFile: DocumentEntry = {
      key: 'authors/ana',
      format: 'json',
      buildTime: false,
      revision: 'x',
    };
    const plan = await planReapply(
      changesetOf([
        {
          key: 'authors/ana',
          status: 'modified',
          baseRevision: null,
          value: { name: 'Ana' },
        },
      ]),
      recordsOf(noFile),
      readsOf(),
    );
    expect(plan.changes).toEqual([
      { op: 'update', key: 'authors/ana', value: { name: 'Ana' } },
    ]);
  });

  it('refuses to re-apply a saved document that cannot be read, and names it', async () => {
    await expect(
      planReapply(
        changesetOf([
          {
            key: 'authors/ana',
            status: 'modified',
            baseRevision: null,
            error: { code: 'invalid', message: 'bad JSON' },
          },
        ]),
        recordsOf(ANA),
        readsOf(),
      ),
    ).rejects.toThrow(
      'The saved document "authors/ana" cannot be read, so it cannot be re-applied: bad JSON',
    );
  });

  it('refuses to re-apply when a saved shared file cannot be read, and names the file', async () => {
    await expect(
      planReapply(
        changesetOf(
          [],
          [
            {
              path: SHARED_PATH,
              error: { code: 'invalid', message: 'bad JSON' },
            },
          ],
        ),
        recordsOf(),
        readsOf(),
      ),
    ).rejects.toThrow(
      `The saved file "${SHARED_PATH}" cannot be read, so it cannot be re-applied: bad JSON`,
    );
  });
});

describe('trailersOf', () => {
  it('gives the upstream sha to an overwritten document and keeps an older sha for a document still saved', () => {
    const changeset = changesetOf([
      { key: 'authors/ana', status: 'modified', baseRevision: 'x' },
      { key: 'pages/home', status: 'modified', baseRevision: 'x' },
      { key: 'authors/bo', status: 'deleted', baseRevision: 'x' },
    ]);
    const trailers = trailersOf(
      changeset,
      new Set(['pages/home']),
      UPSTREAM,
      new Map([
        ['authors/ana', OLD],
        ['pages/gone', OLD],
      ]),
    );
    expect([...trailers]).toEqual([
      ['authors/ana', OLD],
      ['pages/home', UPSTREAM],
    ]);
  });

  it('gives the newer sha when a document is overwritten again, and no sha to a document with neither', () => {
    const changeset = changesetOf([
      { key: 'authors/ana', status: 'modified', baseRevision: 'x' },
    ]);
    const trailers = trailersOf(
      changeset,
      new Set(['authors/ana']),
      UPSTREAM,
      new Map([['authors/ana', OLD]]),
    );
    expect([...trailers]).toEqual([['authors/ana', UPSTREAM]]);
    expect([...trailersOf(changeset, new Set(), UPSTREAM, new Map())]).toEqual(
      [],
    );
  });
});

describe('commitParagraphs', () => {
  it('is the subject alone when there are no trailers', () => {
    expect(commitParagraphs(UPSTREAM, new Map())).toEqual([
      `cms: saved changes (re-applied on ${UPSTREAM})`,
    ]);
  });

  it('puts the trailers in a last paragraph, one line each', () => {
    expect(
      commitParagraphs(
        UPSTREAM,
        new Map([
          ['authors/ana', OLD],
          ['testimonials/a', UPSTREAM],
        ]),
      ),
    ).toEqual([
      `cms: saved changes (re-applied on ${UPSTREAM})`,
      `CMS-Overwrote: authors/ana ${OLD}\nCMS-Overwrote: testimonials/a ${UPSTREAM}`,
    ]);
  });
});
