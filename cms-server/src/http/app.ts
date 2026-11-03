import { Hono } from 'hono';
import type { BundleSource } from '../bundle/source.ts';
import { registerBundleRoutes } from './bundle-routes.ts';
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
}

// Hono only routes (PHASE-2-DESIGN 4.1): the modules behind the routes don't import Hono.
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route('/', editorRoutes(deps.editor));
  app.route('/', mediaRoutes(deps.media));
  if (deps.bundle !== undefined && deps.workingCopy !== undefined)
    registerBundleRoutes(app, deps.bundle, deps.workingCopy);
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return app;
}
