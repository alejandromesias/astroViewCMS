// GET /__preview/config (PHASE-2-DESIGN 5.7): the editor origins, read from
// PREVIEW_EDITOR_ORIGINS on each request, so the answer follows the node's
// environment and not a build. The bridge fetches it before its first `ready`.
// The route file (preview-config-route.ts) only passes the environment in.
import { parseEditorOrigins } from './serve/settings.ts';

type Env = Readonly<Record<string, string | undefined>>;

const NO_STORE = { 'Cache-Control': 'no-store' };

/** `{ editorOrigins }` for the given environment, or 500 with the reason when the variable is invalid. */
export function previewConfigResponse(env: Env): Response {
  try {
    const editorOrigins = parseEditorOrigins(env.PREVIEW_EDITOR_ORIGINS);
    return Response.json({ editorOrigins }, { headers: NO_STORE });
  } catch (error) {
    return new Response(String(error), {
      status: 500,
      headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
