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
import type { DeleteGuard, PreviewClient } from '../save/context.ts';
import { createDeleteGuard } from '../save/delete-guard.ts';
import { saveChanges } from '../save/pipeline.ts';
import { BodyTooLargeError, readBody } from './body.ts';
import { withBundle } from './bundle-routes.ts';
import { rejectUnlessContentType } from './guard.ts';
import type { MediaRouteDeps } from './media.ts';

/** Largest save body, in bytes: 4 MiB, as the render routes' cap (`MAX_BODY_BYTES`, D16). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

// The content type of a save body: JSON, with or without parameters.
const JSON_TYPE = /^application\/json\s*(;|$)/i;

/** What PUT needs beyond the repo: the config's collections, the preview node, the log (the real logger by default), and the delete guard (2.6b; one is made per app by default). */
export interface SaveRouteDeps {
  readonly config: Pick<CmsConfig, 'collections'>;
  readonly preview: PreviewClient;
  readonly log?: Logger;
  readonly guard?: DeleteGuard | undefined;
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
function changesUnavailable(c: Context, error: unknown): Response {
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
    app.put('/api/changes', async (c) => {
      const request = c.req.raw;
      const rejection = rejectUnlessContentType(request, JSON_TYPE);
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
          },
          deps.repo,
        );
        return c.json(answer.body, answer.status);
      } catch (error: unknown) {
        // A git failure escapes only from the stages before the write (write.ts answers its own), so nothing was written.
        return changesUnavailable(c, error);
      }
    });
  }
}
