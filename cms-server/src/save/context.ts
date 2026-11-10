// The shared state of one save (WORKPLAN 2.5c): the inputs, the outputs that the stages fill in, and the types the
// stages and the pipeline share. Types only, so that the stage modules can import it without an import cycle.
import type { FieldError, MediaInfo } from 'preview-protocol';
import type { Bundle, DocumentEntry } from '../bundle/read.ts';
import type { CmsConfig } from '../config/schema.ts';
import type { ChangesetRepo } from '../documents/changeset.ts';
import type { FileOp } from '../documents/plan-write.ts';
import type { FileReads } from '../documents/read.ts';
import type { RepoTx } from '../git/ops.ts';
import type { Logger } from '../log.ts';
import type { ReferenceIndex } from '../references/reference-index.ts';
import type { SaveChange } from './body.ts';

/**
 * The check of a save's values by the preview node (PHASE-2-DESIGN 5.3). Resolves with the errors, which are empty
 * when the values are valid. Rejects when the node cannot answer. 2.9d implements it, with a 10 s timeout.
 */
export interface PreviewClient {
  validate(
    documents: Readonly<Record<string, unknown>>,
    media: Readonly<Record<string, MediaInfo>>,
  ): Promise<readonly FieldError[]>;
}

/** Where the CMS's media files are: `media.json`, and the origin that the staged image URLs start with (D12). */
export interface MediaFiles {
  readonly mediaFile: string;
  readonly cmsOrigin: string;
}

/** A stop: the save answers `status` with `body`, and no later stage runs. */
export interface SaveStop {
  readonly status: 400 | 409 | 422 | 500 | 503;
  readonly body: Record<string, unknown>;
}

/** A warning of a save (WORKPLAN 2.7c). It never blocks the save; `path` is the field path, as in a FieldError. */
interface SaveWarning {
  readonly key: string;
  readonly path: readonly (string | number)[];
  readonly code: string;
}

/** A staged image to copy into the site (WORKPLAN 2.7b). `from` is the absolute staging path; `to` is site-relative. */
interface ImageCopy {
  readonly from: string;
  readonly to: string;
}

/** The 200 answer of a save (WORKPLAN 2.5c item 10). `warnings` stays empty until 2.7c fills it. */
interface SaveBody {
  readonly revisions: Record<string, string>;
  readonly warnings: readonly SaveWarning[];
  readonly rebuild: boolean;
}

/** The answer of a save: 200 with its body, or a stop. */
export type SaveAnswer =
  | { readonly status: 200; readonly body: SaveBody }
  | SaveStop;

/**
 * A hook that runs after the commit, inside the lock (WORKPLAN 2.5c item 9). A throw is logged and does not fail
 * the save. The owner of a hook marks what it must (2.6b marks the reference index for a full rebuild).
 */
export type AfterCommitHook = (ctx: SaveContext) => Promise<void>;

/**
 * The delete guard of the app (PHASE-2-DESIGN 4.3): the reference index of the bundle, built lazily from the working
 * copy and kept in step with each save. Its methods are implemented in delete-guard.ts.
 */
export interface DeleteGuard {
  /** The index of the save's bundle. Built on the first call, and again when a failed update left it stale. May reject. */
  indexOf(ctx: SaveContext): Promise<ReferenceIndex>;
  /** Puts the save's written values into the index, after the commit. A throw marks the index stale and is rethrown. */
  applySave(ctx: SaveContext): void;
}

/** What the stages share. The inputs are set before the lock; the stages fill in the outputs, in order. */
export interface SaveContext {
  /** The client's list. A stage may reassign the field to a new list (2.7b), but never changes this array in place. */
  changes: readonly SaveChange[];
  readonly bundle: Bundle;
  /** The site folder of the working copy. The planned paths are relative to it. */
  readonly siteFolder: string;
  /** The reads of the changeset (the created documents, and the commits they compare). The save takes the lock itself. */
  readonly repo: ChangesetRepo;
  readonly tx: RepoTx;
  readonly config: Pick<CmsConfig, 'collections'>;
  readonly preview: PreviewClient;
  readonly media: MediaFiles;
  readonly log: Logger;
  /** Writes one file atomically (fs/atomic.ts). A test passes a fake that fails. */
  readonly writeFile: (file: string, text: string) => Promise<void>;
  /** Copies one file's bytes to a new path, atomically. The copy loop of the write stage calls it. A test passes a fake. */
  readonly copyFile: (from: string, to: string) => Promise<void>;
  readonly afterCommit: readonly AfterCommitHook[];
  /** The delete guard (2.6b): the stage reads the index from it, and the after-commit hook updates it. */
  readonly guard: DeleteGuard;
  /** The file reads of the save before its writes. Shared by the revision check and the planning. */
  readonly reads: FileReads;
  /** The values of the documents before the save, by key. Set by the revision check for each known document. */
  readonly stored: Map<string, unknown>;
  /** The documents the save can see: the bundle's, and those that earlier saves created. Set by the revision check. */
  documents: ReadonlyMap<string, DocumentEntry>;
  /** The file operations of the save. Set by the planning stage. */
  plan: readonly FileOp[];
  /** The keys whose validation threw a refinement. They do not block the save; 2.10e's build check reads them. */
  refinements: readonly string[];
  /** Set by the write stage (WORKPLAN 2.5c item 7). */
  rebuild: boolean;
  /** The revision of each created and updated document, after the commit. */
  revisions: Map<string, string>;
  /** The warnings of the save, answered in the 200 body. The collectWarnings stage (2.7c) adds the missing-image ones. */
  warnings: SaveWarning[];
  /** The staged images to copy in before the text files. Empty until a stage adds one (2.7b). */
  copies: readonly ImageCopy[];
}

/** One stage of the pipeline: a stop to answer with, or undefined to go on. */
export type SaveStage = (ctx: SaveContext) => Promise<SaveStop | undefined>;
