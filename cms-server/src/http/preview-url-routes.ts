// GET /api/preview-url?path= (WORKPLAN 2.9e, PHASE-2-DESIGN 5.9): the URL of a site path on the preview origin, with a
// fresh token in its query. The first call of a session warms the node first (preview/preview-url.ts). It needs no
// bundle. A path that is not a site path answers 400 invalid-path. Hono only here; the logic is in preview/preview-url.ts.
import type { Hono } from 'hono';
import { type Logger, logger } from '../log.ts';
import {
  createWarmUp,
  INVALID_PATH_MESSAGE,
  isSitePath,
  previewUrlOf,
} from '../preview/preview-url.ts';

/** What the route needs: the preview origin and the site (from the config), the token secret, the node's warm-up, and the log and clock (the real ones by default). */
export interface PreviewUrlRouteDeps {
  /** config.origins.preview, without a trailing slash. */
  readonly origin: string;
  /** config.site: the token is for this site. */
  readonly site: string;
  /** secrets.previewTokenSecret. */
  readonly tokenSecret: string;
  /** The node's warm-up (PreviewClient's `warm`). Resolves on 204, rejects otherwise. */
  readonly warm: () => Promise<void>;
  readonly log?: Logger | undefined;
  /** The clock in milliseconds. Default: Date.now. */
  readonly now?: (() => number) | undefined;
}

/** Registers GET /api/preview-url on `app`. The warm-up stamp is kept per registration, so one stamp serves the server. */
export function registerPreviewUrlRoutes(
  app: Hono,
  deps: PreviewUrlRouteDeps,
): void {
  const now = deps.now ?? (() => Date.now());
  const warmUp = createWarmUp({
    warm: deps.warm,
    now,
    log: deps.log ?? logger,
  });
  app.get('/api/preview-url', async (c) => {
    const path = c.req.query('path');
    if (path === undefined || !isSitePath(path))
      return c.json(
        { error: 'invalid-path', message: INVALID_PATH_MESSAGE },
        400,
      );
    await warmUp();
    const url = previewUrlOf({
      origin: deps.origin,
      path,
      site: deps.site,
      secret: deps.tokenSecret,
      now: Math.floor(now() / 1000),
    });
    return c.json({ url, origin: deps.origin });
  });
}
