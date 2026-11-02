import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createGate } from './gate.ts';

describe('createGate', () => {
  it('lets every request through when the node is open', () => {
    expect(createGate({ kind: 'open' }).allows({} as IncomingMessage)).toBe(
      true,
    );
  });

  it('refuses to build a gate that is not implemented yet (task 2.8c)', () => {
    expect(() =>
      createGate({
        kind: 'gated',
        tokenSecret: 'token',
        internalSecret: 'internal',
      }),
    ).toThrow(
      new Error(
        'The preview gate (token exchange and cookie check, task 2.8c) is not built yet, so the node refuses to start with PREVIEW_TOKEN_SECRET and PREVIEW_INTERNAL_SECRET set. Unset them and use PREVIEW_INSECURE=1 for local runs',
      ),
    );
  });
});
