// GET /__preview/config (PHASE-2-DESIGN 5.7): the editor origins, read from
// PREVIEW_EDITOR_ORIGINS on each request, so the answer follows the node's
// environment and not a build, and the identity of the bundle (bundle.json).
// The bridge fetches it before its first `ready`; the supervisor of cms-server
// checks the bundleId before it counts a node as ready (WORKPLAN 2.9b).
// The route file (preview-config-route.ts) only passes the environment in.
import fs from 'node:fs';
import path from 'node:path';
import { bundleJsonSchema } from 'preview-contract';
import { parseEditorOrigins } from './serve/settings.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** What the bundle says about itself: null for both when it has no bundle.json. */
export interface BundleIdentity {
  readonly bundleId: string | null;
  readonly protocolVersion: number | null;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Reads `<manifestDir>/bundle.json`. A missing file gives nulls (a build from
 *  before 2.9b). Any other problem throws, so the answer is a 500 and not a guess. */
export function bundleIdentity(
  manifestDir: string,
  readText: (file: string) => string = (file) => fs.readFileSync(file, 'utf8'),
): BundleIdentity {
  let text: string;
  try {
    text = readText(path.join(manifestDir, 'bundle.json'));
  } catch (error) {
    if (isNotFound(error)) return { bundleId: null, protocolVersion: null };
    throw error;
  }
  const parsed = bundleJsonSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    throw new Error('bundle.json is not a valid bundle file');
  }
  return {
    bundleId: parsed.data.bundleId,
    protocolVersion: parsed.data.protocolVersion,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** `{ editorOrigins, bundleId, protocolVersion }`, or 500 with the reason when the
 *  variable or bundle.json is invalid. `identity` is called once per request. */
export function previewConfigResponse(
  env: Env,
  identity: () => BundleIdentity,
): Response {
  try {
    const editorOrigins = parseEditorOrigins(env.PREVIEW_EDITOR_ORIGINS);
    const { bundleId, protocolVersion } = identity();
    return Response.json(
      { editorOrigins, bundleId, protocolVersion },
      { headers: NO_STORE },
    );
  } catch (error) {
    return new Response(String(error), {
      status: 500,
      headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
