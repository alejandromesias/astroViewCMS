// The preview gate (PHASE-2-DESIGN 5.7, steps 1 and 2; WORKPLAN 2.8c). For each
// request it decides: serve it (allow), exchange a preview token for the cookie
// (redirect), or refuse it (deny). front-server.ts carries the decision out.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { mintPreviewToken, verifyPreviewToken } from 'preview-contract';
import type { GateSettings } from './settings.ts';

// The request fields the gate reads. A plain object satisfies it in tests.
export type GateRequest = Pick<IncomingMessage, 'method' | 'url' | 'headers'>;

type GateDecision =
  | { readonly action: 'allow' }
  | {
      readonly action: 'redirect';
      readonly location: string;
      readonly setCookie: string;
    }
  | { readonly action: 'deny' };

export interface Gate {
  check(req: GateRequest): GateDecision;
}

export interface GateDeps {
  /** Unix time in seconds. */
  readonly now: () => number;
}

const COOKIE_NAME = '__Host-preview';
// About 12 hours (PHASE-2-DESIGN 5.7).
const COOKIE_MAX_AGE = 43200;
const TOKEN_PARAM = 'preview_token';
const BEARER = 'Bearer ';

const ALLOW: GateDecision = { action: 'allow' };
const DENY: GateDecision = { action: 'deny' };

export function createGate(
  settings: GateSettings,
  deps: GateDeps = { now: nowSeconds },
): Gate {
  if (settings.kind === 'open') return { check: () => ALLOW };
  const { site, tokenSecret } = settings;
  const internalDigest = digest(settings.internalSecret);
  const { now } = deps;
  const verifies = (token: string): boolean =>
    verifyPreviewToken(token, { secret: tokenSecret, site, now: now() }).ok;

  return {
    check(req) {
      // The internal caller (cms-server) bypasses the cookie on every path.
      if (bearerMatches(req.headers.authorization, internalDigest))
        return ALLOW;
      const target = parseTarget(req.url);
      if (target === undefined) return DENY;
      const { tokens, kept } = splitQuery(target.query);
      if (
        tokens.length > 0 &&
        (req.method === 'GET' || req.method === 'HEAD')
      ) {
        // Every preview_token must verify. A bad one is refused even when a valid
        // cookie is present: there is no fallback to the cookie.
        if (!tokens.every((token) => verifies(token))) return DENY;
        const cookieValue = mintPreviewToken({
          secret: tokenSecret,
          site,
          ttlSeconds: COOKIE_MAX_AGE,
          now: now(),
        });
        return {
          action: 'redirect',
          // Relative: the path plus the other parameters, never a host from the request.
          location:
            kept.length > 0
              ? `${target.pathname}?${kept.join('&')}`
              : target.pathname,
          setCookie: `${COOKIE_NAME}=${cookieValue}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
        };
      }
      return cookieAllows(req.headers.cookie, verifies) ? ALLOW : DENY;
    },
  };
}

// Compares SHA-256 digests, so both sides have the same length for timingSafeEqual.
function bearerMatches(
  header: string | undefined,
  internalDigest: Buffer,
): boolean {
  if (header === undefined || !header.startsWith(BEARER)) return false;
  return timingSafeEqual(digest(header.slice(BEARER.length)), internalDigest);
}

// Any valid cookie among duplicates is enough. Only the exact name counts.
function cookieAllows(
  header: string | undefined,
  verifies: (token: string) => boolean,
): boolean {
  if (header === undefined) return false;
  return header.split(';').some((pair) => {
    const eq = pair.indexOf('=');
    return (
      eq !== -1 &&
      pair.slice(0, eq).trim() === COOKIE_NAME &&
      verifies(pair.slice(eq + 1).trim())
    );
  });
}

// The path is normalised by URL, so a `//host/path` target yields only its path.
// The query stays raw. A target that URL cannot parse is refused.
function parseTarget(
  url: string | undefined,
): { pathname: string; query: string } | undefined {
  const target = url ?? '/';
  const mark = target.indexOf('?');
  try {
    return {
      pathname: new URL(target, 'http://localhost').pathname,
      query: mark === -1 ? '' : target.slice(mark + 1),
    };
  } catch {
    return undefined;
  }
}

// The values of the preview_token parameters, and the other segments as they were
// sent, in order. Empty segments are dropped. Names are decoded, so `preview%5Ftoken`
// is the same parameter.
function splitQuery(query: string): { tokens: string[]; kept: string[] } {
  const tokens: string[] = [];
  const kept: string[] = [];
  for (const segment of query.split('&')) {
    if (segment === '') continue;
    const [name, value] = firstPair(segment);
    if (name === TOKEN_PARAM) tokens.push(value);
    else kept.push(segment);
  }
  return { tokens, kept };
}

function firstPair(segment: string): [string, string] {
  const [pair] = [...new URLSearchParams(segment)];
  return pair ?? ['', ''];
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
