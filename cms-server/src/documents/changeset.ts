// The changeset (WORKPLAN 2.5b): the documents that differ between the merge base and cms/work. Each one has its
// revision at the merge base, its saved value (absent when deleted or unreadable), its error when it cannot be read,
// and the upstream sha of its newest CMS-Overwrote trailer. A file with a document of its own is one document. A
// `file()` shared file holds documents by entry: its entries are compared by revision, so an upstream change to
// another entry of that file is not a change here. Nothing is refused here: 2.5c refuses the writes.
import { posix } from 'node:path';
import {
  type CollectionSchemaJson,
  type DocumentRecord,
  revisionOf,
} from 'preview-contract';
import type { Bundle, DocumentEntry } from '../bundle/read.ts';
import type { ChangeStatus, Repo } from '../git/ops.ts';
import {
  collectionOf,
  formatOfPath,
  globIdOf,
  relativeToBase,
  slugOf,
} from './paths.ts';
import {
  entriesOf,
  type FileRead,
  type FileReads,
  fileRead,
  type ParseOutcome,
  readFileOnce,
} from './read.ts';
import { type DocumentError, entryRevision, errorOf } from './revision.ts';

/** What the changeset reads from the repo: the changed paths, the merge base, bytes at it, and the trailers. */
export type ChangesetRepo = Pick<
  Repo,
  'changedPaths' | 'mergeBase' | 'showAtBytes' | 'overwrittenSince'
>;

/** One document that differs. `value` is absent when it was deleted or cannot be read, and `error` says why it cannot. */
interface ChangedDocument {
  readonly key: string;
  readonly status: ChangeStatus;
  /** The revision at the merge base, or null when the document was not there. */
  readonly baseRevision: string | null;
  readonly value?: unknown;
  /** The upstream sha of the newest `CMS-Overwrote` trailer for this key (2.10b). */
  readonly overwritten?: string;
  readonly error?: DocumentError;
}

/** The changeset: the changed documents, and the documents created on cms/work in the bundle's shape. */
export interface Changeset {
  readonly documents: readonly ChangedDocument[];
  /** Documents that the save created and the bundle does not hold, for 2.5c's `ctx.documents`. */
  readonly createdRecords: readonly DocumentEntry[];
}

export interface ChangesetInput {
  readonly bundle: Pick<Bundle, 'documents' | 'collections'>;
  readonly repo: ChangesetRepo;
  /** The site folder of the working copy, where the files of cms/work are read. */
  readonly siteFolder: string;
}

/** What one file of the changeset gives: its documents, and the ones it creates. */
interface Found {
  readonly documents: ChangedDocument[];
  readonly createdRecords: DocumentEntry[];
}

/** The changed file, sorted by what names its documents. */
type Unit =
  | {
      readonly kind: 'record';
      readonly path: string;
      readonly record: DocumentEntry;
    }
  | {
      readonly kind: 'glob';
      readonly path: string;
      readonly collection: string;
      readonly relative: string;
    }
  | {
      readonly kind: 'shared';
      readonly path: string;
      readonly collection: string | undefined;
      readonly records: readonly DocumentEntry[];
    };

/** A `file()` shared file as the changeset reads it: missing, parsed, or its parse failed. */
type SharedSide =
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly whole: unknown }
  | { readonly kind: 'error'; readonly error: DocumentError };

/** One entry of a shared file: its raw value, and its revision as the build hashes it. */
interface EntryRevision {
  readonly entry: unknown;
  readonly revision: string;
}

/** What the changeset reads for one changed-path walk: the merge base, the repo, the working copy and its memo. */
interface Env {
  readonly base: string;
  readonly repo: ChangesetRepo;
  readonly siteFolder: string;
  readonly reads: FileReads;
}

/** The changed documents of the save, in the order of the changed paths, with their trailers. */
export async function changesetOf({
  bundle,
  repo,
  siteFolder,
}: ChangesetInput): Promise<Changeset> {
  const env: Env = {
    base: await repo.mergeBase(),
    repo,
    siteFolder,
    reads: new Map(),
  };
  const byFile = documentsByFile(bundle.documents.values());
  const documents: ChangedDocument[] = [];
  const createdRecords: DocumentEntry[] = [];
  for (const { path } of await repo.changedPaths()) {
    const unit = unitOf(path, byFile, bundle.collections);
    if (unit === undefined) continue;
    const found = await unitChanges(unit, env);
    documents.push(...found.documents);
    createdRecords.push(...found.createdRecords);
  }
  const overwritten = await repo.overwrittenSince();
  return {
    documents: documents.map((document) => {
      const sha = overwritten.get(document.key);
      return sha === undefined ? document : { ...document, overwritten: sha };
    }),
    createdRecords,
  };
}

/** The documents of each file, by file. A document with no file (a loader that reads no file) is in none. */
function documentsByFile(
  documents: Iterable<DocumentEntry>,
): Map<string, DocumentEntry[]> {
  const byFile = new Map<string, DocumentEntry[]>();
  for (const document of documents) {
    if (document.file === undefined) continue;
    const list = byFile.get(document.file) ?? [];
    list.push(document);
    byFile.set(document.file, list);
  }
  return byFile;
}

/**
 * What a changed path holds: a document the bundle lists by its file, a file that a glob collection would load (a
 * new document, as the bundle does not hold it yet), or a shared `file()` file. Undefined for a file no collection reads.
 */
function unitOf(
  path: string,
  byFile: ReadonlyMap<string, readonly DocumentEntry[]>,
  collections: ReadonlyMap<string, CollectionSchemaJson>,
): Unit | undefined {
  const records = byFile.get(path) ?? [];
  const [first] = records;
  if (first !== undefined && first.entryKey === undefined)
    return { kind: 'record', path, record: first };
  if (first !== undefined)
    return {
      kind: 'shared',
      path,
      collection: collectionOf(first.key),
      records,
    };
  for (const [collection, schema] of collections) {
    const loader = schema.loader;
    if (loader === undefined) continue;
    if (loader.kind === 'file' && loader.pattern === path)
      return { kind: 'shared', path, collection, records: [] };
    const relative =
      loader.kind === 'glob' ? relativeToBase(loader.base, path) : undefined;
    if (relative !== undefined && posix.matchesGlob(relative, loader.pattern))
      return { kind: 'glob', path, collection, relative };
  }
  return undefined;
}

async function unitChanges(unit: Unit, env: Env): Promise<Found> {
  if (unit.kind === 'record') {
    // The bundle holds this document, so it is not a created record.
    const found = await ownFile(
      unit.path,
      unit.record.format,
      () => unit.record.key,
      env,
    );
    return { documents: found.documents, createdRecords: [] };
  }
  if (unit.kind === 'glob')
    return ownFile(
      unit.path,
      formatOfPath(unit.path),
      (slug) => `${unit.collection}/${globIdOf(unit.relative, slug)}`,
      env,
    );
  return sharedFile(unit, env);
}

/**
 * A file with a document of its own. Its key comes from `keyOf`, which gets the frontmatter slug of the file (or
 * undefined). The file at the merge base and the file in cms/work are compared by their bytes.
 */
async function ownFile(
  path: string,
  format: DocumentRecord['format'],
  keyOf: (slug: unknown) => string,
  env: Env,
): Promise<Found> {
  const before = await baseRead(env, path, format);
  const after = await readFileOnce(env.siteFolder, path, format, env.reads);
  const current = after ?? before;
  if (current === null) return { documents: [], createdRecords: [] };
  const key = keyOf(slugOfRead(current, format));
  const baseRevision = before === null ? null : revisionOf(before.bytes);
  if (after === null)
    return {
      documents: [{ key, status: 'deleted', baseRevision }],
      createdRecords: [],
    };
  const status: ChangeStatus = before === null ? 'created' : 'modified';
  const reading = readingOf(after.parse(), format);
  const document: ChangedDocument = { key, status, baseRevision, ...reading };
  const created =
    status === 'created' && !('error' in reading)
      ? [
          {
            key,
            file: path,
            format,
            buildTime: false,
            revision: revisionOf(after.bytes),
          },
        ]
      : [];
  return { documents: [document], createdRecords: created };
}

/**
 * A shared `file()` file: its entries are compared by revision, one document per changed entry. A file that cannot be
 * parsed on either side gives each of its documents the error, since the changed entries cannot be told apart.
 */
async function sharedFile(
  unit: Extract<Unit, { kind: 'shared' }>,
  env: Env,
): Promise<Found> {
  const { path, records } = unit;
  const format = records[0]?.format ?? formatOfPath(path);
  const before = sideOf(await baseRead(env, path, format), format);
  const after = sideOf(
    await readFileOnce(env.siteFolder, path, format, env.reads),
    format,
  );
  const wasEntries = revisionsOf(before);
  const nowEntries = revisionsOf(after);
  const failure = errorOfSides(before, after);
  if (failure !== undefined)
    return {
      documents: records.map(
        (record): ChangedDocument => ({
          key: record.key,
          status: 'modified',
          baseRevision:
            record.entryKey === undefined
              ? null
              : (wasEntries.get(record.entryKey)?.revision ?? null),
          error: failure,
        }),
      ),
      createdRecords: [],
    };
  const documents: ChangedDocument[] = [];
  const createdRecords: DocumentEntry[] = [];
  const ids = [...new Set([...wasEntries.keys(), ...nowEntries.keys()])].sort();
  for (const id of ids) {
    const was = wasEntries.get(id);
    const now = nowEntries.get(id);
    if (was !== undefined && now !== undefined && was.revision === now.revision)
      continue;
    const record = records.find((candidate) => candidate.entryKey === id);
    const key =
      record?.key ??
      (unit.collection === undefined ? undefined : `${unit.collection}/${id}`);
    if (key === undefined) continue;
    const baseRevision = was?.revision ?? null;
    if (now === undefined) {
      documents.push({ key, status: 'deleted', baseRevision });
      continue;
    }
    const status: ChangeStatus = was === undefined ? 'created' : 'modified';
    documents.push({ key, status, baseRevision, value: now.entry });
    if (status === 'created' && record === undefined)
      createdRecords.push({
        key,
        file: path,
        format,
        entryKey: id,
        buildTime: false,
        revision: now.revision,
      });
  }
  return { documents, createdRecords };
}

/** The bytes of `path` at the merge base, read as the format says. Null when the file was not there. */
async function baseRead(
  env: Env,
  path: string,
  format: DocumentRecord['format'],
): Promise<FileRead | null> {
  const bytes = await env.repo.showAtBytes(env.base, path);
  return bytes === null ? null : fileRead(bytes, format);
}

/** The shared file's state on one side. A format with no codec cannot be parsed, so its side is an error. */
function sideOf(
  read: FileRead | null,
  format: DocumentRecord['format'],
): SharedSide {
  if (read === null) return { kind: 'missing' };
  const outcome = read.parse();
  if (outcome === null) return { kind: 'error', error: notEditableOf(format) };
  return 'error' in outcome
    ? { kind: 'error', error: errorOf(outcome.error) }
    : { kind: 'value', whole: outcome.value };
}

/** The error of a shared file that cannot be read on either side. The working copy's error comes first. */
function errorOfSides(
  before: SharedSide,
  after: SharedSide,
): DocumentError | undefined {
  if (after.kind === 'error') return after.error;
  if (before.kind === 'error') return before.error;
  return undefined;
}

/** The revision of each entry of a shared file's value. A missing file or one that cannot be read has none. */
function revisionsOf(side: SharedSide): Map<string, EntryRevision> {
  const found = new Map<string, EntryRevision>();
  if (side.kind !== 'value') return found;
  for (const [id, entry] of entriesOf(side.whole))
    found.set(id, { entry, revision: entryRevision(side.whole, entry) });
  return found;
}

/** The value of a parsed file, or the error that says why it has none. A format with no codec has neither. */
function readingOf(
  outcome: ParseOutcome | null,
  format: DocumentRecord['format'],
): { readonly value: unknown } | { readonly error: DocumentError } {
  if (outcome === null) return { error: notEditableOf(format) };
  return 'error' in outcome
    ? { error: errorOf(outcome.error) }
    : { value: outcome.value };
}

/** The frontmatter slug of a file that parses, which the build uses for its id. Undefined when it does not parse. */
function slugOfRead(read: FileRead, format: DocumentRecord['format']): unknown {
  const outcome = read.parse();
  if (outcome === null || 'error' in outcome) return undefined;
  return slugOf(outcome.value, format);
}

/** The error of a document in a format the CMS does not read (TOML and anything else, D13). */
function notEditableOf(format: DocumentRecord['format']): DocumentError {
  return {
    code: 'not-editable',
    message: `The format "${format}" is read-only in the CMS, so the document cannot be checked`,
  };
}
