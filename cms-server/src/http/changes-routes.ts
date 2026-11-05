// GET and PUT /api/changes (WORKPLAN 2.5b, 2.5c). GET answers the documents that differ between the merge base and
// cms/work, with their base revisions and saved values. A document that cannot be read carries its own `error`, so a
// broken file still answers 200. PUT saves a change list (PHASE-2-DESIGN 5.3). No bundle answers 503 and a bundle file
// that does not parse answers 500, as the other bundle routes do.
import type { Hono } from 'hono';
import type { BundleSource } from '../bundle/source.ts';
import { createBundleStore } from '../bundle/store.ts';
import type { CmsConfig } from '../config/schema.ts';
import { changesetOf } from '../documents/changeset.ts';
import type { Repo } from '../git/ops.ts';
import { type Logger, logger } from '../log.ts';
import { parseSaveBody } from '../save/body.ts';
import type { PreviewClient } from '../save/context.ts';
import { saveChanges } from '../save/pipeline.ts';
import { withBundle } from './bundle-routes.ts';
import { BodyTooLargeError, readBody } from './body.ts';
import { rejectUnlessContentType } from './guard.ts';
import type { MediaRouteDeps } from './media.ts';

/** Largest save body, in bytes: 4 MiB, as the render routes' cap (`MAX_BODY_BYTES`, D16). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

// The content type of a save body: JSON, with or without parameters.
const JSON_TYPE = /^application\/json\s*(;|$)/i;

/** What PUT needs beyond the repo: the config's collections, the preview node, and the log (the real logger by default). */
export interface SaveRouteDeps {
  readonly config: Pick<CmsConfig, 'collections'>;
  readonly preview: PreviewClient;
  readonly log?: Logger;
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

/** Registers GET /api/changes on `app`, and PUT /api/changes when `deps.save` is given. */
export function registerChangeRoutes(app: Hono, deps: ChangeRouteDeps): void {
  const store = createBundleStore(deps.source);
  app.get('/api/changes', (c) =>
    withBundle(c, store, async (bundle) =>
      c.json(
        await changesetOf({
          bundle,
          repo: deps.repo,
          siteFolder: deps.siteFolder,
        }),
      ),
    ),
  );
  if (deps.save !== undefined) {
    const save = deps.save;
    const log = save.log ?? logger;
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

      const answer = await saveChanges(
        {
          changes: body.changes,
          bundles: store,
          siteFolder: deps.siteFolder,
          config: save.config,
          preview: save.preview,
          media: deps.media,
          log,
        },
        deps.repo,
      );
      return c.json(answer.body, answer.status);
    });
  }
}
