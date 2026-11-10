// GET /api/overlay (WORKPLAN 2.9e, PHASE-2-DESIGN 5.9): the working copy's changes against the bundle, in the render
// request's shape, which the editor sends to the render route as it is (documents/overlay.ts). No bundle answers 503,
// a bundle file that does not parse answers 500, and a git failure answers 500 `changes-unavailable`, as the change
// routes do. Hono only here; the overlay itself is in documents/overlay.ts.
import type { Hono } from 'hono';
import type { BundleSource } from '../bundle/source.ts';
import { createBundleStore } from '../bundle/store.ts';
import type { ChangesetRepo } from '../documents/changeset.ts';
import { overlayOf } from '../documents/overlay.ts';
import { type Logger, logger } from '../log.ts';
import type { MediaFiles } from '../save/context.ts';
import { withBundle } from './bundle-routes.ts';
import { changesUnavailable } from './changes-routes.ts';

/** What GET /api/overlay reads: the bundle, the repo and the working copy, the media files, and the site's image folder. */
export interface OverlayRouteDeps {
  readonly source: BundleSource;
  readonly repo: ChangesetRepo;
  /** The site folder of the working copy. */
  readonly siteFolder: string;
  readonly media: MediaFiles;
  /** config.media.folder. */
  readonly mediaFolder: string;
  readonly log?: Logger | undefined;
}

/** Registers GET /api/overlay on `app`. */
export function registerOverlayRoutes(app: Hono, deps: OverlayRouteDeps): void {
  const store = createBundleStore(deps.source);
  const log = deps.log ?? logger;
  app.get('/api/overlay', (c) =>
    withBundle(c, store, async (bundle) => {
      try {
        return c.json(
          await overlayOf({
            bundle,
            repo: deps.repo,
            siteFolder: deps.siteFolder,
            media: deps.media,
            mediaFolder: deps.mediaFolder,
            log,
          }),
        );
      } catch (error: unknown) {
        return changesUnavailable(c, error);
      }
    }),
  );
}
