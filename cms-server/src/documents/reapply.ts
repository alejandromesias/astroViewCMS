// The re-apply plan (WORKPLAN 2.10b, PHASE-2-DESIGN 4.2). A sync moves `cms/work` onto the new upstream commit by
// writing each saved document into the upstream text, with `planWrite`. This file turns the saved changeset into the
// changes for `planWrite`, and says which documents the save overwrote. It reads the repo only through `ReapplyReads`
// and writes nothing: `git/ops.ts` builds the commit from the plan.
import type { DocumentRecord } from 'preview-contract';
import { revisionOf } from 'preview-contract';
import type { DocumentEntry } from '../bundle/read.ts';
import type { ChangedDocument, Changeset } from './changeset.ts';
import { collectionOf } from './paths.ts';
import type { WriteChange } from './plan-write.ts';
import { entriesOf, fileRead } from './read.ts';
import { entryRevision } from './revision.ts';

/** What the plan reads from the repo: a file's bytes at the new upstream commit, or at the merge base. Null when it is missing there. */
export interface ReapplyReads {
  readonly upstream: (path: string) => Promise<Buffer | null>;
  readonly base: (path: string) => Promise<Buffer | null>;
}

/**
 * The plan. `changes` go to `planWrite` in the order of the changeset. `blank` gives the text that a file the upstream
 * commit lacks starts from. `overwritten` holds the keys whose upstream revision is not the one the save started from:
 * the CMS value (or the CMS deletion) wins, and the commit records it.
 */
interface ReapplyPlan {
  readonly changes: readonly WriteChange[];
  readonly blank: ReadonlyMap<string, string>;
  readonly overwritten: ReadonlySet<string>;
}

/** The accumulators of one plan, passed to the per-document helpers. */
interface Builder {
  readonly changes: WriteChange[];
  readonly blank: Map<string, string>;
  readonly overwritten: Set<string>;
}

/**
 * Plans the re-apply of `changeset` on the upstream commit. `records` holds the bundle's documents and the created
 * records, so each saved document has its file and format. A saved document or file that cannot be read throws
 * instead of being dropped, since dropping it would lose the save.
 */
export async function planReapply(
  changeset: Changeset,
  records: ReadonlyMap<string, DocumentEntry>,
  reads: ReapplyReads,
): Promise<ReapplyPlan> {
  for (const document of changeset.documents) {
    if (document.error !== undefined)
      throw new Error(
        `The saved document "${document.key}" cannot be read, so it cannot be re-applied: ${document.error.message}`,
      );
  }
  const fileError = changeset.fileErrors[0];
  if (fileError !== undefined)
    throw new Error(
      `The saved file "${fileError.path}" cannot be read, so it cannot be re-applied: ${fileError.error.message}`,
    );
  const builder: Builder = {
    changes: [],
    blank: new Map(),
    overwritten: new Set(),
  };
  for (const document of changeset.documents) {
    const record = records.get(document.key);
    // No record or no file: planWrite refuses the change and names the key.
    if (record?.file === undefined) {
      builder.changes.push(changeOf(document));
      continue;
    }
    const upstream = await reads.upstream(record.file);
    if (record.entryKey === undefined)
      ownFile(document, record.file, upstream, builder);
    else
      await sharedEntry(
        document,
        { file: record.file, format: record.format, entryKey: record.entryKey },
        upstream,
        reads,
        builder,
      );
  }
  return {
    changes: builder.changes,
    blank: builder.blank,
    overwritten: builder.overwritten,
  };
}

/** The `planWrite` change of a saved document: a delete, or an update of its value. */
function changeOf(document: ChangedDocument): WriteChange {
  return document.status === 'deleted'
    ? { op: 'delete', key: document.key }
    : { op: 'update', key: document.key, value: document.value };
}

/**
 * A document with a file of its own. Its revision is the file's bytes, as its base revision is. A deleted document the
 * upstream commit no longer has stays deleted with no change. A saved value is written into the upstream file, or into
 * an empty text when upstream lacks the file, so the file is made again.
 */
function ownFile(
  document: ChangedDocument,
  file: string,
  upstream: Buffer | null,
  builder: Builder,
): void {
  const revision = upstream === null ? null : revisionOf(upstream);
  if (document.status === 'deleted') {
    if (upstream === null) return;
    builder.changes.push({ op: 'delete', key: document.key });
  } else {
    if (upstream === null) builder.blank.set(file, '');
    builder.changes.push({
      op: 'update',
      key: document.key,
      value: document.value,
    });
  }
  if (revision !== document.baseRevision) builder.overwritten.add(document.key);
}

/**
 * An entry of a shared `file()` file. Only that entry changes: a saved entry replaces the upstream one, or is added when
 * upstream lacks it. A file the upstream commit lacks is made again from a blank text, with only the saved entries. A
 * deleted entry the upstream commit no longer has is not touched.
 */
async function sharedEntry(
  document: ChangedDocument,
  record: {
    readonly file: string;
    readonly format: DocumentRecord['format'];
    readonly entryKey: string;
  },
  upstream: Buffer | null,
  reads: ReapplyReads,
  builder: Builder,
): Promise<void> {
  let whole: unknown;
  if (upstream !== null) {
    const outcome = fileRead(upstream, record.format).parse();
    // A file that does not parse, or has no codec, is refused by planWrite, which names the file.
    if (outcome === null || 'error' in outcome) {
      builder.changes.push(changeOf(document));
      return;
    }
    whole = outcome.value;
  }
  const entries =
    whole === undefined ? new Map<string, unknown>() : entriesOf(whole);
  const present = entries.has(record.entryKey);
  const revision = present
    ? entryRevision(whole, entries.get(record.entryKey))
    : null;
  const key = document.key;
  const collection = collectionOf(key);
  if (document.status === 'deleted') {
    if (!present) return;
    builder.changes.push({ op: 'delete', key });
  } else if (present || collection === undefined) {
    builder.changes.push({ op: 'update', key, value: document.value });
  } else {
    if (upstream === null)
      builder.blank.set(
        record.file,
        await blankOf(record.file, record.format, reads.base),
      );
    builder.changes.push({
      op: 'create',
      collection,
      id: record.entryKey,
      value: document.value,
    });
  }
  if (revision !== document.baseRevision) builder.overwritten.add(key);
}

/**
 * The text a shared file that upstream lacks starts from. It is shaped as the file was at the merge base: an object for
 * a keyed file, otherwise an empty array, so the entries keep their form.
 */
async function blankOf(
  file: string,
  format: DocumentRecord['format'],
  base: ReapplyReads['base'],
): Promise<string> {
  const bytes = await base(file);
  const outcome = bytes === null ? null : fileRead(bytes, format).parse();
  const keyed =
    outcome !== null && !('error' in outcome) && isKeyed(outcome.value);
  return keyed ? '{}' : '[]';
}

/** True for a value that is an object and not an array: the keyed shape of a `file()` file. */
function isKeyed(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `CMS-Overwrote` values of the re-applied commit (WORKPLAN 2.10b): `upstream` for each document this save
 * overwrote, and for each document still in the changeset, the sha of its older trailer (`older`, read from the commits
 * that origin lacks). So a second sync keeps the first sync's value. Keys come in changeset order.
 */
export function trailersOf(
  changeset: Changeset,
  overwritten: ReadonlySet<string>,
  upstream: string,
  older: ReadonlyMap<string, string>,
): Map<string, string> {
  const trailers = new Map<string, string>();
  for (const document of changeset.documents) {
    const sha = overwritten.has(document.key)
      ? upstream
      : older.get(document.key);
    if (sha !== undefined) trailers.set(document.key, sha);
  }
  return trailers;
}

/**
 * The paragraphs of the re-applied commit message, one `-m` each: the subject, then the trailer block when there is
 * one. The trailer block is the last paragraph, where git reads trailers (2.5b reads them back).
 */
export function commitParagraphs(
  upstream: string,
  trailers: ReadonlyMap<string, string>,
): string[] {
  const subject = `cms: saved changes (re-applied on ${upstream})`;
  if (trailers.size === 0) return [subject];
  const lines = [...trailers].map(
    ([key, sha]) => `CMS-Overwrote: ${key} ${sha}`,
  );
  return [subject, lines.join('\n')];
}
