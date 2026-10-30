// The logic of POST /__preview/render and POST /__preview/validate
// (SYSTEM-DESIGN.md section 3, WORKPLAN task 1.5), with everything the site
// provides passed in, so tests can run it with fakes. The routes
// (render-route.ts, validate-route.ts) only supply the real dependencies.

import type {
  Limit,
  RenderResponse,
  ValidationResponse,
} from 'preview-protocol';
import type { DocumentRecord } from '../manifest/types.ts';
import type { ValidationError } from '../overlay/content-api.ts';
import type { OverlayContext } from '../overlay/context.ts';
import { createOverlayContext, runWithOverlay } from '../overlay/context.ts';
import { DraftError } from '../overlay/errors.ts';
import { rejectUnlessContentType } from '../request-guard.ts';
import { discoveredDocuments } from './discover.ts';
import type { Envelope } from './envelope.ts';
import { parseEnvelope } from './envelope.ts';
import { extractHead, stripSourceScripts } from './head.ts';
import type { RenderedPage } from './render-page.ts';
import { NotFoundError } from './render-page.ts';

export interface HandlerDeps {
  /** Renders the page for a URL (render-page.ts bound to the site). */
  renderPage(url: URL): Promise<RenderedPage>;
  /** Parses the overlay's documents with the site's schema (the shim's `validate`). */
  validate(context: OverlayContext): Promise<ValidationError[]>;
  /** documents.json, if the build wrote it. */
  builtDocuments(): DocumentRecord[] | undefined;
}

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });

/** The error, or the first error in its `cause` chain, that is a DraftError.
 *  Astro may wrap what a page throws. */
function findDraftError(error: unknown): DraftError | undefined {
  for (let depth = 0; error && depth < 5; depth++) {
    if (error instanceof DraftError) return error;
    error = (error as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * The largest request body the render and validate routes read, in bytes (D16).
 * Provisional: the overlay measurement (WORKPLAN task 1.8) sets the final value.
 */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * The body as text, or `null` when it is larger than MAX_BODY_BYTES. The
 * Content-Length header only lets an oversized request go early; the bytes are
 * counted as they arrive, so a missing or false header can't bypass the cap.
 */
async function readCappedText(request: Request): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Reads the guard, the JSON body and the `{ documents, media }` envelope. */
async function readEnvelope(request: Request): Promise<Response | Envelope> {
  const rejection = rejectUnlessContentType(request, /application\/json/);
  if (rejection) return rejection;
  const tooLarge = `Body must be at most ${MAX_BODY_BYTES} bytes`;
  let text: string | null;
  try {
    text = await readCappedText(request);
  } catch {
    // The stream failed, for instance because the client went away.
    return new Response('Body must be JSON', { status: 400 });
  }
  if (text === null) return new Response(tooLarge, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response('Body must be JSON', { status: 400 });
  }
  const parsed = parseEnvelope(body);
  return parsed.ok
    ? { documents: parsed.documents, media: parsed.media }
    : new Response(parsed.message, { status: 400 });
}

function validationFailure(errors: ValidationError[]): Response {
  return json({ errors } satisfies ValidationResponse, 422);
}

/** POST /__preview/render?path=<url path> */
export async function handleRender(
  request: Request,
  deps: HandlerDeps,
): Promise<Response> {
  const envelope = await readEnvelope(request);
  if (envelope instanceof Response) return envelope;

  const requested = new URL(request.url).searchParams.get('path');
  if (!requested?.startsWith('/') || requested.startsWith('//')) {
    return new Response('Query "path" must be a URL path starting with "/"', {
      status: 400,
    });
  }
  const pageUrl = new URL(requested, request.url);

  const context = createOverlayContext(envelope);
  const started = performance.now();
  let page: RenderedPage;
  try {
    page = await runWithOverlay(context, () => deps.renderPage(pageUrl));
  } catch (error) {
    if (error instanceof NotFoundError)
      return new Response(error.message, { status: 404 });
    const draft = findDraftError(error);
    if (draft) {
      // Give the editor every failing field, not only the first one reached.
      const all = await runWithOverlay(context, () =>
        deps.validate(context),
      ).catch(() => []);
      return validationFailure(
        all.length > 0
          ? all
          : draft.issues.map((issue) => ({ key: draft.key, ...issue })),
      );
    }
    console.error(`[preview] render of "${requested}" failed:`, error);
    return new Response(
      `Page render failed: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 },
    );
  }

  const html = stripSourceScripts(page.html);
  const renderMs = Math.round((performance.now() - started) * 10) / 10;
  const body: RenderResponse = {
    html,
    head: extractHead(html),
    documents: discoveredDocuments(
      context.reads,
      deps.builtDocuments(),
      envelope.documents,
    ),
    limits: [...context.limits].sort() as Limit[],
    renderMs,
  };
  return json(body, 200, {
    'Server-Timing': `paths;dur=${page.pathsMs.toFixed(1)}, render;dur=${page.renderMs.toFixed(1)}`,
  });
}

/** POST /__preview/validate */
export async function handleValidate(
  request: Request,
  deps: HandlerDeps,
): Promise<Response> {
  const envelope = await readEnvelope(request);
  if (envelope instanceof Response) return envelope;
  const context = createOverlayContext(envelope);
  let errors: ValidationError[];
  try {
    errors = await runWithOverlay(context, () => deps.validate(context));
  } catch (error) {
    console.error('[preview] validation failed:', error);
    return new Response(
      `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 },
    );
  }
  return errors.length === 0
    ? json({ valid: true })
    : validationFailure(errors);
}
