// The sync classifier (WORKPLAN 2.10a, PHASE-2-DESIGN 4.4): what an upstream change means for the preview build.
// Pure: it takes the changed paths and the documents of the current bundle, and does no I/O. `tx.fetch` in `ops.ts`
// reads both and calls it.
import { posix } from 'node:path';
import type { DocumentEntry } from '../bundle/read.ts';

/** How a path differs between the base (`origin/<branch>`) and `cms/work`. A type change counts as modified. */
export type ChangeStatus = 'created' | 'modified' | 'deleted';

/** One path that differs, relative to the site folder. */
export interface ChangedPath {
  path: string;
  status: ChangeStatus;
}

/**
 * What an upstream change means. `none`: nothing changed. `content-only`: every change is a modified file of a
 * current, non-build-time document, so no build is needed. `code`: anything else, or a change that cannot be
 * compared. Erring toward a rebuild.
 */
export type SyncChange = 'none' | 'content-only' | 'code';

/** The two fields of a document record that the classifier reads. `file` is relative to the site folder. */
export type DocumentFile = Pick<DocumentEntry, 'file' | 'buildTime'>;

/** The input of `classifyChange`. */
export interface ClassifyInput {
  /** The repo-relative paths that differ from the bundle's commit. Null when they cannot be read. */
  changes: readonly ChangedPath[] | null;
  /** The documents of the current bundle. Null when there is no bundle. */
  documents: readonly DocumentFile[] | null;
  /** The site folder, as the config gives it. */
  siteDir: string;
}

/** The site folder as a repo path: "." at the repo root, and no trailing slash otherwise. */
export function siteScope(siteDir: string): string {
  return posix.normalize(siteDir).replace(/\/+$/, '');
}

/**
 * Classifies an upstream change. `content-only` only when every changed path is a modification (`modified`) of the
 * file of a current, non-build-time document. Added, deleted and renamed paths, paths outside the site folder, the
 * files of build-time documents and every other path are `code`. So is any input that could not be read.
 */
export function classifyChange({
  changes,
  documents,
  siteDir,
}: ClassifyInput): SyncChange {
  if (changes === null || documents === null) return 'code';
  if (changes.length === 0) return 'none';
  const scope = siteScope(siteDir);
  const contentFiles = new Set<string>();
  const buildTimeFiles = new Set<string>();
  for (const document of documents) {
    if (document.file === undefined) continue;
    if (document.buildTime) {
      buildTimeFiles.add(document.file);
    } else {
      contentFiles.add(document.file);
    }
  }
  const contentOnly = changes.every((change) => {
    const file = siteFileOf(scope, change.path);
    return (
      file !== null &&
      change.status === 'modified' &&
      contentFiles.has(file) &&
      !buildTimeFiles.has(file)
    );
  });
  return contentOnly ? 'content-only' : 'code';
}

// The path of a repo path inside the site folder, relative to that folder. Null for a path outside the folder.
function siteFileOf(scope: string, path: string): string | null {
  if (scope === '.') return path;
  const prefix = `${scope}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}
