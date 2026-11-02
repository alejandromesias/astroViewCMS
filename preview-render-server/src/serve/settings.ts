// Reads the preview node's front-server environment (PHASE-2-DESIGN 5.7).
// The gate is on whenever a secret is set. With no secret the node refuses to
// start unless PREVIEW_INSECURE=1, so an unprotected preview is always a choice.

type Env = Readonly<Record<string, string | undefined>>;

export type GateSettings =
  | { readonly kind: 'open' }
  | {
      readonly kind: 'gated';
      // The site this node serves; a token for any other site is refused (2.8c).
      readonly site: string;
      readonly tokenSecret: string;
      readonly internalSecret: string;
    };

// Both secrets must be at least this long (WORKPLAN 2.8c).
const MIN_SECRET_LENGTH = 32;

interface ServeSettings {
  // The Content-Security-Policy value sent on every response.
  readonly csp: string;
  readonly gate: GateSettings;
}

export function readServeSettings(env: Env): ServeSettings {
  return {
    csp: frameAncestorsCsp(env.PREVIEW_EDITOR_ORIGINS),
    gate: readGate(env),
  };
}

// PREVIEW_EDITOR_ORIGINS is a list separated by spaces or commas. Each item must be
// a bare http(s) origin: a `;` or a path would otherwise add CSP directives to the header.
export function frameAncestorsCsp(origins: string | undefined): string {
  return ["frame-ancestors 'self'", ...parseEditorOrigins(origins)].join(' ');
}

// The same parser serves GET /__preview/config (preview-config.ts), so the CSP and the bridge agree.
export function parseEditorOrigins(origins: string | undefined): string[] {
  const items = (origins ?? '').split(/[\s,]+/).filter((item) => item !== '');
  return items.map(parseOrigin);
}

const ORIGIN = /^https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d+)?$/i;

function parseOrigin(item: string): string {
  if (!ORIGIN.test(item)) {
    throw new Error(`PREVIEW_EDITOR_ORIGINS: "${item}" is not an origin`);
  }
  return item;
}

function readGate(env: Env): GateSettings {
  const tokenSecret = nonEmpty(env.PREVIEW_TOKEN_SECRET);
  const internalSecret = nonEmpty(env.PREVIEW_INTERNAL_SECRET);
  if (tokenSecret !== undefined || internalSecret !== undefined) {
    if (tokenSecret === undefined || internalSecret === undefined) {
      throw new Error(
        'PREVIEW_TOKEN_SECRET and PREVIEW_INTERNAL_SECRET must be set together',
      );
    }
    if (tokenSecret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `PREVIEW_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
      );
    }
    if (internalSecret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `PREVIEW_INTERNAL_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
      );
    }
    const site = nonEmpty(env.PREVIEW_SITE);
    if (site === undefined) {
      throw new Error('PREVIEW_SITE must be set when the gate is on');
    }
    return { kind: 'gated', site, tokenSecret, internalSecret };
  }
  if (env.PREVIEW_INSECURE === '1') return { kind: 'open' };
  throw new Error(
    'Refusing to start without the preview gate: set PREVIEW_TOKEN_SECRET and PREVIEW_INTERNAL_SECRET, or PREVIEW_INSECURE=1 for local runs',
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}
