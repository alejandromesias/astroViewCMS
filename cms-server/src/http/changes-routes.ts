// GET /api/changes (WORKPLAN 2.5b): the documents that differ between the merge base and cms/work, with their base
// revisions and saved values. A document that cannot be read carries its own `error`, so a broken file still answers
// 200. No bundle answers 503 and a bundle file that does not parse answers 500, as the other bundle routes do.
import type { Hono } from 'hono';
import type { BundleSource } from '../bundle/source.ts';
import { createBundleStore } from '../bundle/store.ts';
import { type ChangesetRepo, changesetOf } from '../documents/changeset.ts';
import { withBundle } from './bundle-routes.ts';

/** Registers GET /api/changes on `app`. The changes come from `repo`, and the files of cms/work are read from `siteFolder`. */
export function registerChangeRoutes(
  app: Hono,
  source: BundleSource,
  repo: ChangesetRepo,
  siteFolder: string,
): void {
  const store = createBundleStore(source);
  app.get('/api/changes', (c) =>
    withBundle(c, store, async (bundle) =>
      c.json(await changesetOf({ bundle, repo, siteFolder })),
    ),
  );
}
