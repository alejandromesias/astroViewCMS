// POST /api/publish (WORKPLAN 2.10d, PHASE-2-DESIGN 4.2). The body is not read: a publish takes no input. The route has the
// guards of PUT /api/changes (a JSON content type, no `Sec-Fetch-Site: cross-site`), so a page of another site cannot
// start one. The answer is the publish's: 200, 409, 422, 500, 502 or 503 (`busy`, `build-in-progress`).
import type { Hono } from 'hono';
import type { PublishAnswer } from '../sync/publish.ts';
import { JSON_CONTENT_TYPE, rejectUnlessContentType } from './guard.ts';

/** What the route needs: the publish. `run.ts` makes it with `createPublish`. */
export interface PublishRouteDeps {
  readonly publish: () => Promise<PublishAnswer>;
}

/** Registers POST /api/publish on `app`. */
export function registerPublishRoutes(
  app: Hono,
  { publish }: PublishRouteDeps,
): void {
  app.post('/api/publish', async (c) => {
    const rejection = rejectUnlessContentType(c.req.raw, JSON_CONTENT_TYPE);
    if (rejection) return rejection;
    const answer = await publish();
    return c.json(answer.body, answer.status);
  });
}
