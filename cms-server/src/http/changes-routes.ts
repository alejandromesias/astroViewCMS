// GET and PUT /api/changes (WORKPLAN 2.5b, 2.5c). GET answers the documents that differ between the merge base and
// cms/work, with their base revisions and saved values. A document that cannot be read carries its own `error`, so a
// broken file still answers 200. PUT saves a change list (PHASE-2-DESIGN 5.3). No bundle answers 503 and a bundle file
// that does not parse answers 500, as the other bundle routes do. A git failure answers 500 `changes-unavailable`.
import type { Context, Hono } from 'hono';
import type { BundleSource } from '../bundle/source.ts';
import { createBundleStore } from '../bundle/store.ts';
import type { CmsConfig } from '../config/schema.ts';
import { changesetOf } from '../documents/changeset.ts';
import { GitError } from '../git/exec.ts';
import type { Repo } from '../git/ops.ts';
import { type Logger, logger } from '../log.ts';
import { parseSaveBody } from '../save/body.ts';
import { busyStop } from '../save/busy.ts';
import type {
  AfterCommitHook,
  DeleteGuard,
  PreviewClient,
} from '../save/context.ts';
import { createDeleteGuard } from '../save/delete-guard.ts';
import { saveChanges } from '../save/pipeline.ts';
import { BodyTooLargeError, readBody } from './body.ts';
import { withBundle } from './bundle-routes.ts';
import { JSON_CONTENT_TYPE, rejectUnlessContentType } from './guard.ts';
import type { MediaRouteDeps } from './media.ts';

/** Largest save body, in bytes: 4 MiB, as the render routes' cap (`MAX_BODY_BYTES`, D16). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** What PUT needs beyond the repo: the config's collections, the preview node, the log (the real logger by default), and the delete guard (2.6b; one is made per app by default). */
export interface SaveRouteDeps {
  readonly config: Pick<CmsConfig, 'collections' | 'media'>;
  readonly preview: PreviewClient;
  readonly log?: Logger;
  readonly guard?: DeleteGuard | undefined;
  /**
   * Called for a save that asks for a rebuild (`rebuild: true`), so the preview is built again (2.9c). It runs after the
   * save's commit and still under the repo lock (an after-commit hook), so a publish queued for the lock sees the build
   * as started (2.10d). Not awaited.
   */
  readonly onRebuild?: (() => void) | undefined;
}

/** What the change routes read. PUT is registered only when `save` is given. */
export interface ChangeRouteDeps {
  readonly source: BundleSource;
  readonly repo: Repo;
  /** The site folder of the working copy: where the files of the documents are. */
  readonly siteFolder: string;
  readonly media: MediaRouteDeps;
  readonly save?: SaveRouteDeps | undefined;
}

// A git failure while the changes are read: 500 `changes-unavailable`, as GET /api/documents?key= answers it. Other errors are not caught here.
// Exported for GET /api/overlay (2.9e), which reads the changes the same way.
export function changesUnavailable(c: Context, error: unknown): Response {
  if (!(error instanceof GitError)) throw error;
  return c.json({ error: 'changes-unavailable', message: error.message }, 500);
}

/** Registers GET /api/changes on `app`, and PUT /api/changes when `deps.save` is given. */
export function registerChangeRoutes(app: Hono, deps: ChangeRouteDeps): void {
  const store = createBundleStore(deps.source);
  app.get('/api/changes', (c) =>
    withBundle(c, store, async (bundle) => {
      try {
        return c.json(
          await changesetOf({
            bundle,
            repo: deps.repo,
            siteFolder: deps.siteFolder,
          }),
        );
      } catch (error: unknown) {
        return changesUnavailable(c, error);
      }
    }),
  );
  if (deps.save !== undefined) {
    const save = deps.save;
    const log = save.log ?? logger;
    // One guard for the app: its reference index is built once per bundle, and kept across saves.
    const guard = save.guard ?? createDeleteGuard();
    // Under the save's lock, after the commit, so the build is under way by the time a queued publish gets the lock.
    const rebuildAfterCommit: AfterCommitHook = async (ctx) => {
      if (ctx.rebuild) save.onRebuild?.();
    };
    app.put('/api/changes', async (c) => {
      const request = c.req.raw;
      const rejection = rejectUnlessContentType(request, JSON_CONTENT_TYPE);
      if (rejection) return rejection;

      let bytes: Uint8Array;
      try {
        bytes = await readBody(request, MAX_BODY_BYTES);
      } catch (error) {
        if (error instanceof BodyTooLargeError)
          return c.json(
            {
              error: 'body-too-large',
              message: `The body is larger than ${MAX_BODY_BYTES} bytes`,
            },
            413,
          );
        throw error;
      }
      const body = parseSaveBody(new TextDecoder().decode(bytes));
      if (!body.ok)
        return c.json({ error: 'invalid-body', message: body.message }, 400);

      try {
        const answer = await saveChanges(
          {
            changes: body.changes,
            bundles: store,
            siteFolder: deps.siteFolder,
            config: save.config,
            preview: save.preview,
            media: deps.media,
            log,
            guard,
            afterCommit: [rebuildAfterCommit],
          },
          deps.repo,
        );
        return c.json(answer.body, answer.status);
      } catch (error: unknown) {
        // A lock that stayed busy for 30 s is 503 busy (2.10d); the save did not start.
        const busy = busyStop(error);
        if (busy !== undefined) return c.json(busy.body, busy.status);
        // A git failure escapes only from the stages before the write (write.ts answers its own), so nothing was written.
        return changesUnavailable(c, error);
      }
    });
  }
}
