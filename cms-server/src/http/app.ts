import { Hono } from 'hono';
import type { BundleSource } from '../bundle/source.ts';
import type { Repo } from '../git/ops.ts';
import { registerBundleRoutes } from './bundle-routes.ts';
import { registerChangeRoutes, type SaveRouteDeps } from './changes-routes.ts';
import { type EditorRouteDeps, editorRoutes } from './editor-routes.ts';
import { type MediaRouteDeps, mediaRoutes } from './media.ts';

// What the routes need from the outside. Each route group adds its own field.
export interface AppDeps {
  readonly editor: EditorRouteDeps;
  readonly media: MediaRouteDeps;
  // Optional until 2.9c: the bundle routes are registered only when this and `workingCopy` are given.
  readonly bundle?: BundleSource;
  // The site folder of the working copy: the files of the bundle's documents are read from it (WORKPLAN 2.4b).
  readonly workingCopy?: string;
  // The repo's operations: GET /api/changes reads the changes from it (WORKPLAN 2.5b). Registered with `bundle` and `workingCopy`.
  readonly repo?: Repo;
  // PUT /api/changes (WORKPLAN 2.5c). Registered with `bundle`, `workingCopy` and `repo`.
  readonly save?: SaveRouteDeps | undefined;
}

// Hono only routes (PHASE-2-DESIGN 4.1): the modules behind the routes don't import Hono.
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route('/', editorRoutes(deps.editor));
  app.route('/', mediaRoutes(deps.media));
  if (deps.bundle !== undefined && deps.workingCopy !== undefined)
    registerBundleRoutes(app, deps.bundle, deps.workingCopy, deps.repo);
  if (
    deps.bundle !== undefined &&
    deps.workingCopy !== undefined &&
    deps.repo !== undefined
  )
    registerChangeRoutes(app, {
      source: deps.bundle,
      repo: deps.repo,
      siteFolder: deps.workingCopy,
      media: deps.media,
      save: deps.save,
    });
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return app;
}
