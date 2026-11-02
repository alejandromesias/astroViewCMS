import type { IncomingMessage } from 'node:http';
import type { GateSettings } from './settings.ts';

export interface Gate {
  allows(req: IncomingMessage): boolean;
}

// The seam for task 2.8c: the token exchange and the cookie check (design 5.7,
// steps 1 and 2) go here. Until 2.8c exists, a gated node must not start, because
// it would answer without checking anything.
export function createGate(settings: GateSettings): Gate {
  if (settings.kind === 'open') return { allows: () => true };
  throw new Error(
    'The preview gate (token exchange and cookie check, task 2.8c) is not built yet, so the node refuses to start with PREVIEW_TOKEN_SECRET and PREVIEW_INTERNAL_SECRET set. Unset them and use PREVIEW_INSECURE=1 for local runs',
  );
}
