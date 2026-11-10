import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewClient,
  PREVIEW_UNAVAILABLE_TEXT,
  PreviewUnavailableError,
} from './client.ts';
import { createStatus, type StatusSource } from './status.ts';
import type { Supervisor } from './supervisor.ts';

const PORT = 4401;
const SECRET = 'b'.repeat(64);
const VALIDATE_URL = `http://127.0.0.1:${PORT}/__preview/validate`;
const WARM_URL = `http://127.0.0.1:${PORT}/__preview/warm`;
const DOCUMENTS = { 'authors/ana': { name: 'Ana' } };
const MEDIA = {
  abc: {
    url: 'http://cms/media/staging/abc.png',
    width: 2,
    height: 3,
    format: 'png' as const,
  },
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

afterEach(() => {
  vi.restoreAllMocks();
});

/** An answer of the node: JSON with `status`, or no body for 204. */
function answer(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
}

/** The error a call rejects with (or a marker error when it resolves). */
async function errorOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => new Error('the call did not reject'),
    (error: unknown) => error,
  );
}

/** A status holder with a build error and a node error set (or none). */
function statusOf(
  buildError: string | null,
  nodeError: string | null,
): StatusSource {
  const status = createStatus({
    builder: 'on',
    node: () => ({
      state: 'failed',
      port: PORT,
      bundleId: null,
      failures: 1,
      error: nodeError,
    }),
    changedPaths: () => Promise.resolve([]),
  });
  status.setBuildError(buildError);
  return status;
}

/** A client on the test port. The node is `ready` unless a test says otherwise. */
function clientOf(
  fetch: Fetch,
  state: ReturnType<Supervisor['status']>['state'] = 'ready',
  buildError: string | null = null,
  nodeError: string | null = null,
) {
  return createPreviewClient({
    port: PORT,
    secret: SECRET,
    nodeState: () => state,
    status: statusOf(buildError, nodeError),
    fetch,
  });
}

describe('validate: the answers of the node', () => {
  it('posts the documents and the media to 127.0.0.1 with the internal bearer, and resolves with no errors on 200', async () => {
    const fetch = vi.fn<Fetch>(async () => answer(200, { valid: true }));
    const client = clientOf(fetch);
    expect(await client.validate(DOCUMENTS, MEDIA)).toStrictEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(VALIDATE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ documents: DOCUMENTS, media: MEDIA }),
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('answers the errors of a 422, and reads a missing kind as invalid', async () => {
    const fetch = vi.fn<Fetch>(async () =>
      answer(422, {
        errors: [
          {
            key: 'authors/ana',
            path: ['name'],
            message: 'Required',
            kind: 'invalid',
          },
          { key: 'authors/ana', path: ['tags', 0], message: 'Too short' },
          {
            key: 'authors/ana',
            path: ['bio'],
            message: 'boom',
            kind: 'refinement-threw',
          },
        ],
      }),
    );
    expect(await clientOf(fetch).validate(DOCUMENTS, {})).toStrictEqual([
      {
        key: 'authors/ana',
        path: ['name'],
        message: 'Required',
        kind: 'invalid',
      },
      {
        key: 'authors/ana',
        path: ['tags', 0],
        message: 'Too short',
        kind: 'invalid',
      },
      {
        key: 'authors/ana',
        path: ['bio'],
        message: 'boom',
        kind: 'refinement-threw',
      },
    ]);
  });

  it.each([400, 401, 413, 500])(
    'rejects with a PreviewUnavailableError that carries the %i status and the fixed text',
    async (status) => {
      const fetch = vi.fn<Fetch>(async () => answer(status, { error: 'x' }));
      expect(
        await errorOf(clientOf(fetch).validate(DOCUMENTS, {})),
      ).toStrictEqual(
        new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT, status),
      );
    },
  );

  it('rejects a 422 whose body is not the error shape, with status 422', async () => {
    const fetch = vi.fn<Fetch>(async () => answer(422, { errors: 'nope' }));
    expect(
      await errorOf(clientOf(fetch).validate(DOCUMENTS, {})),
    ).toStrictEqual(new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT, 422));
  });

  it('rejects a 200 whose body is not { valid: true }, with status 200', async () => {
    const fetch = vi.fn<Fetch>(async () => answer(200, { valid: false }));
    expect(
      await errorOf(clientOf(fetch).validate(DOCUMENTS, {})),
    ).toStrictEqual(new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT, 200));
  });

  it('rejects an answer that is not JSON, with its status', async () => {
    const fetch = vi.fn<Fetch>(
      async () => new Response('<html>', { status: 422 }),
    );
    expect(
      await errorOf(clientOf(fetch).validate(DOCUMENTS, {})),
    ).toStrictEqual(new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT, 422));
  });

  it('maps a refused connection to the same error, with no status', async () => {
    const fetch = vi.fn<Fetch>(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    expect(
      await errorOf(clientOf(fetch).validate(DOCUMENTS, {})),
    ).toStrictEqual(new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT));
  });

  it('gives the call a 10 s timeout, and maps a timeout to the same error', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetch = vi.fn<Fetch>(() =>
      Promise.reject(new DOMException('timed out', 'TimeoutError')),
    );
    expect(
      await errorOf(clientOf(fetch).validate(DOCUMENTS, {})),
    ).toStrictEqual(new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT));
    expect(timeout).toHaveBeenCalledWith(10_000);
  });
});

describe('validate: the node state is read first', () => {
  it.each(['starting', 'restarting', 'stopped', 'failed'] as const)(
    'refuses at once when the node is %s, without a call',
    async (state) => {
      const fetch = vi.fn<Fetch>(async () => answer(200, { valid: true }));
      expect(
        await errorOf(clientOf(fetch, state).validate(DOCUMENTS, {})),
      ).toStrictEqual(new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT));
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each<[string, string | null, string | null, string]>([
    [
      'a build error comes first',
      'boom',
      'node stopped',
      'The preview build failed: boom',
    ],
    [
      'a node error comes next',
      null,
      'node stopped',
      'The preview node failed: node stopped',
    ],
    [
      'neither error gives the fixed text',
      null,
      null,
      PREVIEW_UNAVAILABLE_TEXT,
    ],
  ])(
    'names the status when the node is not ready: %s',
    async (_name, buildError, nodeError, message) => {
      const fetch = vi.fn<Fetch>(async () => answer(200, { valid: true }));
      expect(
        await errorOf(
          clientOf(fetch, 'failed', buildError, nodeError).validate(
            DOCUMENTS,
            {},
          ),
        ),
      ).toStrictEqual(new PreviewUnavailableError(message));
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe('warm', () => {
  it('posts to the warm-up with the internal bearer, and resolves on 204', async () => {
    const fetch = vi.fn<Fetch>(async () => answer(204));
    expect(await clientOf(fetch).warm()).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(WARM_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SECRET}`,
        'Content-Type': 'application/json',
      },
      body: null,
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it.each([200, 400, 500])(
    'rejects a %i answer with its status',
    async (status) => {
      const fetch = vi.fn<Fetch>(async () => answer(status, { valid: true }));
      expect(await errorOf(clientOf(fetch).warm())).toStrictEqual(
        new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT, status),
      );
    },
  );

  it('refuses at once when the node is not ready, and maps a refused connection', async () => {
    const notReady = vi.fn<Fetch>(async () => answer(204));
    expect(await errorOf(clientOf(notReady, 'starting').warm())).toStrictEqual(
      new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT),
    );
    expect(notReady).not.toHaveBeenCalled();
    const refused = vi.fn<Fetch>(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    expect(await errorOf(clientOf(refused).warm())).toStrictEqual(
      new PreviewUnavailableError(PREVIEW_UNAVAILABLE_TEXT),
    );
  });
});

describe('the real fetch', () => {
  it('calls the node over HTTP when no fetch is injected', async () => {
    const seen: string[] = [];
    const server: Server = createServer((request, response) => {
      seen.push(
        `${request.method} ${request.url} ${request.headers.authorization}`,
      );
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ valid: true }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const { port } = server.address() as AddressInfo;
      const client = createPreviewClient({
        port,
        secret: SECRET,
        nodeState: () => 'ready',
        status: statusOf(null, null),
      });
      expect(await client.validate(DOCUMENTS, {})).toStrictEqual([]);
      expect(seen).toStrictEqual([`POST /__preview/validate Bearer ${SECRET}`]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
