// The revision of a document in the working copy (WORKPLAN 2.0c, 2.4b): the rule the build uses, in one function,
// so the list, GET /api/documents?key= and the save code (2.5b, 2.5c) agree on it.
import { revisionOf, revisionOfEntry } from 'preview-contract';
import type { DocumentEntry } from '../bundle/read.ts';
import type { CodecError } from '../codecs/types.ts';
import {
  entryOf,
  type FileRead,
  type FileReads,
  readFileOnce,
} from './read.ts';

/** What reading one document of the working copy gives. */
export interface DocumentFacts {
  /** The revision, or null when it cannot be computed: a `file()` entry whose shared file does not parse, or a document with no codec. */
  readonly revision: string | null;
  /** The parsed file, or for a `file()` document its raw entry. Absent unless asked for, and absent when there is no codec or the parse failed. */
  readonly value?: unknown;
  /** The CodecError of a parse that failed. */
  readonly error?: CodecError;
}

/**
 * The facts of one document in the working copy, or null when the document is missing: it has no file, its file is
 * gone, or its entry is not in its file. A document with a file of its own has the revision of the file's bytes.
 * A `file()` entry has the revision of its raw entry, read with the shared file's codec (not the store's data). With
 * `wantValue` the file is parsed for its value too. The reads go through `reads`, so a request reads each file once.
 */
export async function revisionOfDocument(
  root: string,
  document: DocumentEntry,
  reads: FileReads,
  wantValue: boolean,
): Promise<DocumentFacts | null> {
  if (document.file === undefined) return null;
  const read = await readFileOnce(root, document.file, document.format, reads);
  if (read === null) return null;
  if (document.entryKey === undefined) return ownFileFacts(read, wantValue);
  return entryFacts(read, document.entryKey, wantValue);
}

/** The facts of a document with a file of its own: the revision of its bytes, and its parse when it is wanted. */
function ownFileFacts(read: FileRead, wantValue: boolean): DocumentFacts {
  const revision = revisionOf(read.bytes);
  if (!wantValue) return { revision };
  const outcome = read.parse();
  if (outcome === null) return { revision };
  return 'error' in outcome
    ? { revision, error: outcome.error }
    : { revision, value: outcome.value };
}

/** The facts of a `file()` entry: the revision of its raw entry, from the parse of its shared file. Null when the entry is not there. */
function entryFacts(
  read: FileRead,
  key: string,
  wantValue: boolean,
): DocumentFacts | null {
  const outcome = read.parse();
  if (outcome === null) return { revision: null };
  if ('error' in outcome) return { revision: null, error: outcome.error };
  const entry = entryOf(outcome.value, key);
  if (entry === undefined) return null;
  const revision = revisionOfEntry(entry);
  return wantValue ? { revision, value: entry } : { revision };
}
