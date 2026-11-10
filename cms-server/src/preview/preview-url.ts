// The preview URL of a site path (WORKPLAN 2.9e, PHASE-2-DESIGN 5.9): the path check, the URL on the preview origin with a
// fresh token, and the warm-up that the first call of a session makes. Pure apart from what is injected: the clock, the
// warm-up call and the log.
import { mintPreviewToken } from 'preview-contract';
import type { Logger } from '../log.ts';

/** The query parameter that carries a preview token. The node's gate reads this name (preview-render-server/src/serve/gate.ts). */
const TOKEN_PARAM = 'preview_token';
/** How long a preview token lives, in seconds (WORKPLAN 2.9e). */
const TOKEN_TTL_SECONDS = 60;
/** The quiet time after which the next preview URL warms the node again: 30 minutes, in milliseconds. */
export const SESSION_MS = 30 * 60 * 1000;

/** The text of the 400 answer for a path that is not a site path. */
export const INVALID_PATH_MESSAGE =
  'The path must start with a single "/" and hold no scheme, host, backslash or control character.';

/** A path that starts with one slash: not `//` and not `/\`. */
const SINGLE_SLASH = /^\/(?![\\/])/;
/** A `preview_token` query parameter in the path's query (before any fragment). */
const TOKEN_IN_QUERY = new RegExp(`[?&]${TOKEN_PARAM}=`);
/** A percent-encoded backslash, in any case. A decoder turns it into a backslash, so it is refused here too. */
const ENCODED_BACKSLASH = /%5c/i;

/**
 * True for a site path: one leading slash, then a path with no backslash, no encoded backslash and no control character.
 * This refuses a scheme (`http://`, `javascript:`), a host (`//host`, `/\host`) and a path with no leading slash.
 */
export function isSitePath(path: string): boolean {
  if (!SINGLE_SLASH.test(path)) return false;
  if (path.includes('\\') || ENCODED_BACKSLASH.test(path)) return false;
  // A token the caller put in the path would sit beside ours, and the node's gate needs every token to verify.
  if (TOKEN_IN_QUERY.test(path)) return false;
  return ![...path].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

/** What the URL of a path needs: the origin, the path, the site and its token secret, and the time in seconds. */
interface PreviewUrlInput {
  readonly origin: string;
  readonly path: string;
  readonly site: string;
  readonly secret: string;
  /** Unix time in seconds, the token's clock. */
  readonly now: number;
}

/**
 * The URL of `path` on the preview origin, with a fresh token in its query. The token joins the query with `&` when the
 * path has one, else with `?`. A `#fragment` of the path stays last.
 */
export function previewUrlOf(input: PreviewUrlInput): string {
  const { origin, path, site, secret, now } = input;
  const token = mintPreviewToken({
    secret,
    site,
    ttlSeconds: TOKEN_TTL_SECONDS,
    now,
  });
  const hash = path.indexOf('#');
  // A stray `%` (not followed by two hex digits) and a space are encoded, so the URL parses to the path that was asked for.
  const base = (hash === -1 ? path : path.slice(0, hash))
    .replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
    .replaceAll(' ', '%20');
  const fragment = hash === -1 ? '' : path.slice(hash);
  const separator = base.includes('?') ? '&' : '?';
  return `${origin}${base}${separator}${TOKEN_PARAM}=${token}${fragment}`;
}

/** What the warm-up needs: the node's warm-up call, the clock in milliseconds, and the log. */
interface WarmUpOptions {
  /** Resolves when the node answers the warm-up. Rejects when it does not. */
  readonly warm: () => Promise<void>;
  /** The clock, in milliseconds. */
  readonly now: () => number;
  readonly log: Logger;
}

/**
 * The warm-up of a session: returns a function that calls `warm` when no warm-up succeeded in the last 30 minutes. The
 * stamp of the last success is the only state, and it is set only after a success, so a failed warm-up is tried again on
 * the next call. A failure is logged and does not throw, so the caller still answers.
 */
export function createWarmUp(options: WarmUpOptions): () => Promise<void> {
  const { warm, now, log } = options;
  let warmedAt: number | undefined;
  return async () => {
    if (warmedAt !== undefined && now() - warmedAt < SESSION_MS) return;
    try {
      await warm();
      warmedAt = now();
    } catch (error) {
      log.warn('the preview warm-up failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
