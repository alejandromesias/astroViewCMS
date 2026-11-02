// Preview tokens (PHASE-2-DESIGN 5.7, WORKPLAN 2.8c). A token is
// base64url(payload).base64url(HMAC-SHA256(payload part)). The payload is the JSON
// `{ site, exp }`, and `exp` is a Unix time in seconds. Nothing is stored: a token
// can be checked again until it expires. The secret is the UTF-8 bytes of the string.
// This module uses node:crypto, so browser code must not import the package index.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

type PreviewTokenFailure = 'malformed' | 'signature' | 'expired' | 'site';

export type PreviewTokenVerdict =
  | { readonly ok: true; readonly exp: number }
  | { readonly ok: false; readonly reason: PreviewTokenFailure };

export interface MintPreviewTokenOptions {
  readonly secret: string;
  readonly site: string;
  readonly ttlSeconds: number;
  /** Unix time in seconds. Defaults to the clock. */
  readonly now?: number;
}

export interface VerifyPreviewTokenOptions {
  readonly secret: string;
  readonly site: string;
  /** Unix time in seconds. Defaults to the clock. */
  readonly now?: number;
}

const PAYLOAD = z.strictObject({
  site: z.string().min(1),
  exp: z.number().int(),
});

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function mintPreviewToken(options: MintPreviewTokenOptions): string {
  const { secret, site, ttlSeconds, now = nowSeconds() } = options;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('ttlSeconds must be a positive integer');
  }
  if (site === '') throw new Error('site must not be empty');
  const payload = Buffer.from(
    JSON.stringify({ site, exp: now + ttlSeconds }),
  ).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

// The signature is checked before the payload is read, so a changed payload is
// reported as a signature failure. Then expiry, then the site: a token that is both
// expired and for another site is reported as expired.
export function verifyPreviewToken(
  token: string,
  options: VerifyPreviewTokenOptions,
): PreviewTokenVerdict {
  const { secret, site, now = nowSeconds() } = options;
  const [payload, signature, extra] = token.split('.');
  if (
    payload === undefined ||
    signature === undefined ||
    extra !== undefined ||
    !BASE64URL.test(payload) ||
    !BASE64URL.test(signature)
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (!sameText(signature, sign(secret, payload))) {
    return { ok: false, reason: 'signature' };
  }
  const parsed = parsePayload(payload);
  if (parsed === undefined) return { ok: false, reason: 'malformed' };
  if (now >= parsed.exp) return { ok: false, reason: 'expired' };
  if (parsed.site !== site) return { ok: false, reason: 'site' };
  return { ok: true, exp: parsed.exp };
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// Compared as bytes in constant time. Equal lengths are checked first, because
// timingSafeEqual throws on different lengths.
function sameText(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parsePayload(payload: string): z.infer<typeof PAYLOAD> | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const result = PAYLOAD.safeParse(raw);
  return result.success ? result.data : undefined;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
