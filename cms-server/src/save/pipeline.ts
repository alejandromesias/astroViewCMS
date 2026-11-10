// The save pipeline (WORKPLAN 2.5c item 2, PHASE-2-DESIGN 5.3): the stages of one PUT /api/changes, run in order inside
// one `locked('save')` call, so the check, the writes and the commit cannot interleave with a sync or another save.
// A stage answers with a stop, or passes. 2.6b, 2.7b and 2.7c add their stage at the slot marked here, and register
// their after-commit hooks, so they do not edit each other's code.
import { type Bundle, BundleError } from '../bundle/read.ts';
import type { BundleStore } from '../bundle/store.ts';
import type { CmsConfig } from '../config/schema.ts';
import { writeFileAtomic } from '../fs/atomic.ts';
import type { Repo } from '../git/ops.ts';
import type { Logger } from '../log.ts';
import type { SaveChange } from './body.ts';
import { checkRevisions } from './conflicts.ts';
import type {
  AfterCommitHook,
  DeleteGuard,
  MediaFiles,
  PreviewClient,
  SaveAnswer,
  SaveContext,
  SaveStage,
} from './context.ts';
import { checkDeleteGuard, updateIndexAfterCommit } from './delete-guard.ts';
import { planChanges } from './plan.ts';
import { validateChanges } from './validate.ts';
import { copyFileAtomic, writeChanges } from './write.ts';

// The two slots that 2.7b and 2.7c fill. They are empty until then: each passes, and changes nothing.
// 2.7b: the rewrite of staged image values, which also lists the copies (WORKPLAN 2.7b step 1).
const rewriteStagedImages: SaveStage = () => Promise.resolve(undefined);
// 2.7c: the warnings of the changed documents, appended to ctx.warnings.
const collectWarnings: SaveStage = () => Promise.resolve(undefined);

/** The stages of a save, in order. */
export const SAVE_STAGES: readonly SaveStage[] = [
  checkRevisions,
  checkDeleteGuard,
  rewriteStagedImages,
  planChanges,
  validateChanges,
  collectWarnings,
  writeChanges,
];

/** What a save needs from the outside. The bundle is read inside the lock, so a sync cannot change it mid-save. */
export interface SaveInput {
  readonly changes: readonly SaveChange[];
  readonly bundles: BundleStore;
  readonly siteFolder: string;
  readonly config: Pick<CmsConfig, 'collections'>;
  readonly preview: PreviewClient;
  readonly media: MediaFiles;
  readonly log: Logger;
  readonly afterCommit?: readonly AfterCommitHook[];
  /** The app's delete guard (2.6b): one per app, so that its index is built once per bundle. */
  readonly guard: DeleteGuard;
}

/** The parts of a save that a test replaces: the stages, the file writer and the file copier (the real ones by default). */
export interface SaveDeps {
  readonly stages?: readonly SaveStage[];
  readonly writeFile?: (file: string, text: string) => Promise<void>;
  readonly copyFile?: (from: string, to: string) => Promise<void>;
}

/**
 * Runs `stages` in order on `ctx`. Returns the first stop. When no stage stops, the answer is 200 with the revisions,
 * the warnings and the rebuild flag.
 */
export async function runStages(
  ctx: SaveContext,
  stages: readonly SaveStage[],
): Promise<SaveAnswer> {
  for (const stage of stages) {
    const stop = await stage(ctx);
    if (stop !== undefined) return stop;
  }
  return {
    status: 200,
    body: {
      revisions: Object.fromEntries(ctx.revisions),
      warnings: ctx.warnings,
      rebuild: ctx.rebuild,
    },
  };
}

/**
 * Saves `input` as one commit, under the repo lock. Resolves with the answer of the save: 503 when there is no bundle,
 * and 500 when the bundle does not parse (as the other bundle routes answer).
 */
export function saveChanges(
  input: SaveInput,
  repo: Repo,
  {
    stages = SAVE_STAGES,
    writeFile = writeFileAtomic,
    copyFile = copyFileAtomic,
  }: SaveDeps = {},
): Promise<SaveAnswer> {
  return repo.locked('save', async (tx): Promise<SaveAnswer> => {
    let bundle: Bundle | null;
    try {
      bundle = await input.bundles.current();
    } catch (error) {
      if (!(error instanceof BundleError)) throw error;
      return {
        status: 500,
        body: { error: 'bundle-invalid', message: error.message },
      };
    }
    if (bundle === null) return { status: 503, body: { error: 'no-bundle' } };
    return runStages(
      {
        changes: input.changes,
        bundle,
        siteFolder: input.siteFolder,
        repo,
        tx,
        config: input.config,
        preview: input.preview,
        media: input.media,
        log: input.log,
        writeFile,
        copyFile,
        afterCommit: [updateIndexAfterCommit, ...(input.afterCommit ?? [])],
        guard: input.guard,
        reads: new Map(),
        stored: new Map(),
        documents: new Map(),
        plan: [],
        refinements: [],
        rebuild: false,
        revisions: new Map(),
        warnings: [],
        copies: [],
      },
      stages,
    );
  });
}
