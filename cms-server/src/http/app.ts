import { Hono } from 'hono';
import type { BundleSource } from '../bundle/source.ts';
import type { Repo } from '../git/ops.ts';
import type { StatusSource } from '../preview/status.ts';
import { registerBundleRoutes } from './bundle-routes.ts';
import { registerChangeRoutes, type SaveRouteDeps } from './changes-routes.ts';
import { type EditorRouteDeps, editorRoutes } from './editor-routes.ts';
import { rejectUnlessHostAllowed } from './guard.ts';
import { type MediaRouteDeps, mediaRoutes } from './media.ts';
import {
  type OverlayRouteDeps,
  registerOverlayRoutes,
} from './overlay-routes.ts';
import {
  type PreviewUrlRouteDeps,
  registerPreviewUrlRoutes,
} from './preview-url-routes.ts';

// What the routes need from the outside. Each route group adds its own field.
export interface AppDeps {
  readonly editor: EditorRouteDeps;
  readonly media: MediaRouteDeps;
  // The CMS's own origin (origins.cms). The Host check (2.9f) allows its host; run.ts sets it.
  readonly cmsOrigin: string;
  // Optional until 2.9c: the bundle routes are registered only when this and `workingCopy` are given.
  readonly bundle?: BundleSource;
  // The site folder of the working copy: the files of the bundle's documents are read from it (WORKPLAN 2.4b).
  readonly workingCopy?: string;
  // The repo's operations: GET /api/changes reads the changes from it (WORKPLAN 2.5b). Registered with `bundle` and `workingCopy`.
  readonly repo?: Repo;
  // PUT /api/changes (WORKPLAN 2.5c). Registered with `bundle`, `workingCopy` and `repo`.
  readonly save?: SaveRouteDeps | undefined;
  // The preview status that GET /api/status adds beside the bundle (2.9c). Registered with `bundle` and `workingCopy`.
  readonly status?: StatusSource | undefined;
  // GET /api/overlay (2.9e). Registered with `bundle`, `workingCopy` and `repo`. `mediaFolder` is config.media.folder.
  readonly overlay?: Pick<OverlayRouteDeps, 'mediaFolder' | 'log'> | undefined;
  // GET /api/preview-url (2.9e). Registered whenever it is given: the URL needs no bundle.
  readonly previewUrl?: PreviewUrlRouteDeps | undefined;
}

// Hono only routes (PHASE-2-DESIGN 4.1): the modules behind the routes don't import Hono.
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  // Before any route, so every route refuses a Host that is not this CMS's (2.9f).
  app.use('*', async (c, next) => {
    const refused = rejectUnlessHostAllowed(c.req.raw, deps.cmsOrigin);
    if (refused !== null) return refused;
    await next();
  });
  app.route('/', editorRoutes(deps.editor));
  app.route('/', mediaRoutes(deps.media));
  if (deps.bundle !== undefined && deps.workingCopy !== undefined)
    registerBundleRoutes(
      app,
      deps.bundle,
      deps.workingCopy,
      deps.repo,
      deps.status,
    );
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
  if (
    deps.bundle !== undefined &&
    deps.workingCopy !== undefined &&
    deps.repo !== undefined &&
    deps.overlay !== undefined
  )
    registerOverlayRoutes(app, {
      source: deps.bundle,
      repo: deps.repo,
      siteFolder: deps.workingCopy,
      media: deps.media,
      mediaFolder: deps.overlay.mediaFolder,
      log: deps.overlay.log,
    });
  if (deps.previewUrl !== undefined)
    registerPreviewUrlRoutes(app, deps.previewUrl);
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return app;
}
