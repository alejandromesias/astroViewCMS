// GET /api/preview-url?path= (WORKPLAN 2.9e, PHASE-2-DESIGN 5.9): the URL of a site path on the preview origin, with a
// fresh token in its query. The first call of a session warms the node first (preview/preview-url.ts). It needs no
// bundle. A path that is not a site path answers 400 invalid-path. Hono only here; the logic is in preview/preview-url.ts.
import {
  apiError,
  type PreviewUrlBody,
  previewUrlQuerySchema,
} from 'cms-contract';
import type { Hono } from 'hono';
import { type Logger, logger } from '../log.ts';
import {
  createWarmUp,
  INVALID_PATH_MESSAGE,
  isSitePath,
  previewUrlOf,
} from '../preview/preview-url.ts';
import { errorJson } from './errors.ts';

/** What the route needs: the preview origin and the site (from the config), the token secret, the node's warm-up, and the log and clock (the real ones by default). */
export interface PreviewUrlRouteDeps {
  /** config.origins.cms, without a trailing slash. Only a page on it may open the preview (its frame-ancestors names it). */
  readonly cmsOrigin: string;
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
  // The preview frames only origins.cms, so a page opened anywhere else would get a broken frame: refused here, with the origin to open.
  const cmsHost = new URL(deps.cmsOrigin).host;
  app.get('/api/preview-url', async (c) => {
    if (c.req.header('host') !== cmsHost)
      return errorJson(
        c,
        apiError('cross-origin', {
          message: `This page is not origins.cms. Open the editor at ${deps.cmsOrigin}/ instead: the preview shows only on that origin, and saves are refused here.`,
        }),
      );
    const query = previewUrlQuerySchema.safeParse({
      path: c.req.query('path'),
    });
    if (!query.success || !isSitePath(query.data.path))
      return errorJson(
        c,
        apiError('invalid-path', { message: INVALID_PATH_MESSAGE }),
      );
    await warmUp();
    const url = previewUrlOf({
      origin: deps.origin,
      path: query.data.path,
      site: deps.site,
      secret: deps.tokenSecret,
      now: Math.floor(now() / 1000),
    });
    const body: PreviewUrlBody = { url, origin: deps.origin };
    return c.json(body);
  });
}
