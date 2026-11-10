// cms-server's client of the preview node (WORKPLAN 2.9d, PHASE-2-DESIGN 5.3): the check of a save's values
// (POST /__preview/validate) and the warm-up (POST /__preview/warm), over 127.0.0.1 with the internal bearer.
// The node state and the status snapshot are injected readers, and fetch is injected too; the defaults are the real ones.
import { z } from 'zod';
import type { PreviewClient } from '../save/context.ts';
import type { StatusSource } from './status.ts';
import type { Supervisor } from './supervisor.ts';

/** The most a validate may take. Below the 30 s repo lock, so a hung node cannot hold the lock for long (2.5c item 3). */
const VALIDATE_TIMEOUT_MS = 10_000;
/** The most a warm-up may take. */
const WARM_TIMEOUT_MS = 10_000;

/** The text of a 503 when the node cannot check a save and the status names no build or node error. */
export const PREVIEW_UNAVAILABLE_TEXT =
  'The preview node did not answer, so nothing was saved. Try again once it is ready.';

/**
 * The node cannot answer: it is not ready, the connection was refused, it timed out, or it answered with a status
 * or a body that is not the expected one. `message` is the text a save answers with. `status` is the HTTP status
 * of an answer, or null when there was none; a save logs it.
 */
export class PreviewUnavailableError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

/** The client of the node: `validate` for a save, and `warm` for the warm-up that 2.9e calls. */
interface PreviewNodeClient extends PreviewClient {
  /** Resolves when the node answers 204. */
  warm(): Promise<void>;
}

/** The options of the client. Every outside call is a field, and the real one is the default. */
interface PreviewClientOptions {
  /** The node's port on 127.0.0.1. The URL never uses `localhost` (design 5.6). */
  readonly port: number;
  /** The internal bearer: the node's previewInternalSecret. */
  readonly secret: string;
  /** The node's state, read before each call. Only `ready` lets a call through. */
  readonly nodeState: () => ReturnType<Supervisor['status']>['state'];
  /** The status snapshot. It is read only when the node is not ready, to name the build or node error. */
  readonly status: StatusSource;
  /** The HTTP call. Default: the global fetch. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** One failing field of a 422 answer. A missing `kind` reads as `invalid`, as in preview-protocol. */
const fieldErrorSchema = z.object({
  key: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  kind: z.enum(['invalid', 'refinement-threw']).default('invalid'),
});

/** The 200 answer of POST /__preview/validate: the values are valid. */
const validBodySchema = z.object({ valid: z.literal(true) });

/** The 422 answer of POST /__preview/validate: the errors of the values. */
const invalidBodySchema = z.object({ errors: z.array(fieldErrorSchema) });

/**
 * Creates the client of the preview node. `validate` resolves with the node's errors (empty when the values are valid),
 * and rejects with a PreviewUnavailableError when the node cannot answer. `warm` resolves on 204.
 */
export function createPreviewClient(
  options: PreviewClientOptions,
): PreviewNodeClient {
  const { port, secret, nodeState, status } = options;
  const send = options.fetch ?? fetch;

  /** The text of a 503 while the node is not ready: the build error first, then the node's error, then the generic text. */
  async function notReadyText(): Promise<string> {
    const { build, node } = await status.snapshot();
    if (build.error !== null) return `The preview build failed: ${build.error}`;
    if (node.error !== null) return `The preview node failed: ${node.error}`;
    return PREVIEW_UNAVAILABLE_TEXT;
  }

  /** POSTs to the node. A node that is not ready is refused at once. A refused connection or a timeout is no answer. */
  async function callNode(
    path: string,
    body: string | null,
    timeoutMs: number,
  ): Promise<Response> {
    if (nodeState() !== 'ready')
      throw new PreviewUnavailableError(await notReadyText());
    try {
      return await send(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The node can stop between the state check and the call, so a refused connection is no answer either.
      throw new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT);
    }
  }

  /** Reads the JSON body of an answer and checks its shape. A body that is not JSON, or not that shape, is no answer. */
  async function bodyOf<T>(
    response: Response,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const parsed = schema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (!parsed.success)
      throw new PreviewUnavailableError(
        PREVIEW_UNAVAILABLE_TEXT,
        response.status,
      );
    return parsed.data;
  }

  return {
    async validate(documents, media) {
      const response = await callNode(
        '/__preview/validate',
        JSON.stringify({ documents, media }),
        VALIDATE_TIMEOUT_MS,
      );
      if (response.status === 200) {
        await bodyOf(response, validBodySchema);
        return [];
      }
      if (response.status === 422) {
        return (await bodyOf(response, invalidBodySchema)).errors;
      }
      throw new PreviewUnavailableError(
        PREVIEW_UNAVAILABLE_TEXT,
        response.status,
      );
    },
    async warm() {
      const response = await callNode('/__preview/warm', null, WARM_TIMEOUT_MS);
      if (response.status !== 204)
        throw new PreviewUnavailableError(
          PREVIEW_UNAVAILABLE_TEXT,
          response.status,
        );
    },
  };
}
