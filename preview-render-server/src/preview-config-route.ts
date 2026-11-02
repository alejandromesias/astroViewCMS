// GET /__preview/config: the editor origins and the bundle identity (see
// preview-config.ts). The origins are read from process.env on every request, so
// the node answers the value it runs with; bundle.json is read once and cached.

import { manifestDir } from 'virtual:preview-site';
import type { APIRoute } from 'astro';
import {
  type BundleIdentity,
  bundleIdentity,
  previewConfigResponse,
} from './preview-config.ts';
import { methodNotAllowed } from './request-guard.ts';

export const prerender = false;

let identity: BundleIdentity | undefined;

export const GET: APIRoute = () =>
  previewConfigResponse(
    process.env,
    () => (identity ??= bundleIdentity(manifestDir)),
  );

/** Any other method. */
export const ALL: APIRoute = () => methodNotAllowed('GET');
