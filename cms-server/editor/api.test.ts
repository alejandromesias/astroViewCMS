import { describe, expect, it, vi } from 'vitest';
import {
  type FetchLike,
  getChanges,
  getDocument,
  getOverlay,
  getPreviewUrl,
  getStatus,
  saveChanges,
  uploadMedia,
  waitForNewBundle,
} from './api.ts';

/** A fake `fetch` that answers once with the response, or fails with the error. */
function fetchAnswering(answer: Response | Error) {
  return vi.fn<FetchLike>(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

const SHAPE = {
  kind: 'shape',
  status: 200,
  text: 'the answer has the wrong shape',
};

describe('getOverlay', () => {
  it('reads the documents and the media of the working copy', async () => {
    const fetchImpl = fetchAnswering(
      Response.json({
        documents: { 'authors/ana': { name: 'Ana' } },
        media: {
          '/media/staging/a.png': {
            url: '/media/staging/a.png',
            width: 2,
            height: 3,
            format: 'png',
          },
        },
      }),
    );
    const answer = await getOverlay(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/overlay');
    expect(answer).toEqual({
      ok: true,
      body: {
        documents: { 'authors/ana': { name: 'Ana' } },
        media: {
          '/media/staging/a.png': {
            url: '/media/staging/a.png',
            width: 2,
            height: 3,
            format: 'png',
          },
        },
      },
    });
  });

  it('is a shape failure when a media entry has no size', async () => {
    const answer = await getOverlay(
      fetchAnswering(
        Response.json({
          documents: {},
          media: { '/a.png': { url: '/a.png', format: 'png' } },
        }),
      ),
    );
    expect(answer).toEqual({ ok: false, failure: SHAPE });
  });
});

describe('getPreviewUrl', () => {
  it('asks for the path, encoded, and reads the URL and the origin', async () => {
    const fetchImpl = fetchAnswering(
      Response.json({
        url: 'http://preview.localhost:4401/blog/a%20b?token=t',
        origin: 'http://preview.localhost:4401',
      }),
    );
    const answer = await getPreviewUrl(fetchImpl, '/blog/a b');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/preview-url?path=%2Fblog%2Fa%20b',
    );
    expect(answer).toEqual({
      ok: true,
      body: {
        url: 'http://preview.localhost:4401/blog/a%20b?token=t',
        origin: 'http://preview.localhost:4401',
      },
    });
  });

  it('keeps the message of a refusal that has no code', async () => {
    const answer = await getPreviewUrl(
      fetchAnswering(
        Response.json(
          { error: 'not-found', message: 'No such page' },
          { status: 404 },
        ),
      ),
      '/x',
    );
    expect(answer).toEqual({
      ok: false,
      failure: { kind: 'http', status: 404, text: 'No such page' },
    });
  });
});

describe('getDocument', () => {
  it('reads an editable document with its value', async () => {
    const answer = await getDocument(
      fetchAnswering(
        Response.json({
          key: 'authors/ana',
          file: 'src/content/authors/ana.json',
          format: 'json',
          editable: true,
          buildTime: false,
          revision: 'r-ana',
          value: { name: 'Ana' },
        }),
      ),
      'authors/ana',
    );
    expect(answer).toEqual({
      ok: true,
      body: {
        key: 'authors/ana',
        file: 'src/content/authors/ana.json',
        format: 'json',
        editable: true,
        buildTime: false,
        revision: 'r-ana',
        value: { name: 'Ana' },
      },
    });
  });

  it('encodes the key in the query', async () => {
    const fetchImpl = fetchAnswering(
      Response.json(
        { error: 'unknown-document', message: 'Unknown document' },
        { status: 404 },
      ),
    );
    await getDocument(fetchImpl, 'data:src/config.json');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/documents?key=data%3Asrc%2Fconfig.json',
    );
  });

  it('gives a read-only document without a value', async () => {
    const answer = await getDocument(
      fetchAnswering(
        Response.json({
          key: 'rules/one',
          format: 'toml',
          editable: false,
          buildTime: false,
          revision: 'r-rules',
        }),
      ),
      'rules/one',
    );
    expect(answer.ok).toBe(true);
  });

  it.each([
    ['an editable JSON document without a value', { format: 'json' }],
    [
      'an editable Markdown document whose value is null',
      { format: 'md', value: null },
    ],
    [
      'an editable Markdown document whose value is a list',
      { format: 'mdx', value: [] },
    ],
  ])('is a shape failure for %s', async (_, fields) => {
    const answer = await getDocument(
      fetchAnswering(
        Response.json({
          key: 'broken/doc',
          editable: true,
          buildTime: false,
          revision: 'r-broken',
          ...fields,
        }),
      ),
      'broken/doc',
    );
    expect(answer).toEqual({ ok: false, failure: SHAPE });
  });

  it('keeps the error code of a 404 from the table', async () => {
    const answer = await getDocument(
      fetchAnswering(
        Response.json(
          { error: 'unknown-document', message: 'Unknown document "nope"' },
          { status: 404 },
        ),
      ),
      'nope',
    );
    expect(answer).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 404,
        text: 'Unknown document "nope"',
        code: 'unknown-document',
        body: { error: 'unknown-document', message: 'Unknown document "nope"' },
      },
    });
  });

  it('is a plain failure when a code of the table has no message, with the body as the text', async () => {
    const answer = await getDocument(
      fetchAnswering(
        new Response('{"error":"unknown-document"}', { status: 404 }),
      ),
      'nope',
    );
    expect(answer).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 404,
        text: '{"error":"unknown-document"}',
      },
    });
  });

  it.each(['toString', 'constructor', '__proto__', 'not-a-code'])(
    'treats the error %s as a code the table does not have',
    async (error) => {
      const answer = await getDocument(
        fetchAnswering(
          new Response(JSON.stringify({ error, message: 'x' }), {
            status: 500,
          }),
        ),
        'nope',
      );
      expect(answer).toEqual({
        ok: false,
        failure: { kind: 'http', status: 500, text: 'x' },
      });
    },
  );

  it('shows the trimmed body of an error that is not JSON', async () => {
    const answer = await getDocument(
      fetchAnswering(new Response('  Bad Gateway \n', { status: 502 })),
      'nope',
    );
    expect(answer).toEqual({
      ok: false,
      failure: { kind: 'http', status: 502, text: 'Bad Gateway' },
    });
  });

  it('is a shape failure when the answer is not JSON', async () => {
    const answer = await getDocument(
      fetchAnswering(new Response('<html>', { status: 200 })),
      'nope',
    );
    expect(answer).toEqual({ ok: false, failure: SHAPE });
  });

  it('is a network failure, with the error message, when no answer came', async () => {
    const answer = await getDocument(
      fetchAnswering(new Error('offline')),
      'nope',
    );
    expect(answer).toEqual({
      ok: false,
      failure: { kind: 'network', status: 0, text: 'offline' },
    });
  });

  it('is a network failure with the thrown value as text when it is not an Error', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw 'boom';
    });
    const answer = await getDocument(fetchImpl, 'nope');
    expect(answer).toEqual({
      ok: false,
      failure: { kind: 'network', status: 0, text: 'boom' },
    });
  });
});

describe('getChanges', () => {
  it('reads the documents that differ, the new records and the broken files', async () => {
    const body = {
      documents: [
        { key: 'authors/ana', status: 'modified', baseRevision: 'r-ana' },
      ],
      createdRecords: [],
      fileErrors: [
        {
          path: 'src/config/bad.json',
          error: { code: 'parse', message: 'Unexpected token' },
        },
      ],
    };
    const fetchImpl = fetchAnswering(Response.json(body));
    const answer = await getChanges(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/changes');
    expect(answer).toEqual({ ok: true, body });
  });

  it('is a shape failure when the documents are not a list', async () => {
    const answer = await getChanges(
      fetchAnswering(
        Response.json({ documents: {}, createdRecords: [], fileErrors: [] }),
      ),
    );
    expect(answer).toEqual({ ok: false, failure: SHAPE });
  });

  it('is a plain failure with the server message when the list cannot be read', async () => {
    const answer = await getChanges(
      fetchAnswering(
        Response.json(
          { error: 'changes-unavailable', message: 'git is down' },
          { status: 500 },
        ),
      ),
    );
    expect(answer).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 500,
        text: 'git is down',
        code: 'changes-unavailable',
        body: { error: 'changes-unavailable', message: 'git is down' },
      },
    });
  });
});

describe('getStatus', () => {
  it('reads the bundle, which is null before the first build', async () => {
    const answer = await getStatus(
      fetchAnswering(Response.json({ bundle: null })),
    );
    expect(answer).toEqual({ ok: true, body: { bundle: null } });
  });

  it('reads the bundle id', async () => {
    const answer = await getStatus(
      fetchAnswering(
        Response.json({ bundle: { bundleId: 'b1', siteCommit: 'abc' } }),
      ),
    );
    expect(answer).toEqual({
      ok: true,
      body: { bundle: { bundleId: 'b1', siteCommit: 'abc' } },
    });
  });

  it('keeps the code of 503 no-bundle, which has no fields', async () => {
    const answer = await getStatus(
      fetchAnswering(Response.json({ error: 'no-bundle' }, { status: 503 })),
    );
    expect(answer).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 503,
        text: '{"error":"no-bundle"}',
        code: 'no-bundle',
        body: { error: 'no-bundle' },
      },
    });
  });
});

describe('saveChanges', () => {
  const changes = {
    changes: [
      { document: 'authors/ana', baseRevision: 'r-ana', data: { name: 'Ana' } },
    ],
  };

  it('sends a PUT with the changes as JSON', async () => {
    const fetchImpl = fetchAnswering(
      Response.json({ revisions: {}, warnings: [], rebuild: false }),
    );
    await saveChanges(fetchImpl, changes);
    expect(fetchImpl).toHaveBeenCalledWith('/api/changes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
  });

  it('reads the revisions, the warnings and the rebuild flag', async () => {
    const body = {
      revisions: { 'authors/ana': 'r-ana-2' },
      warnings: [
        { key: 'authors/ana', path: ['image'], code: 'public-image-missing' },
      ],
      rebuild: true,
    };
    const answer = await saveChanges(
      fetchAnswering(Response.json(body)),
      changes,
    );
    expect(answer).toEqual({ ok: true, body });
  });

  it('keeps the conflicting documents of a 409 conflict', async () => {
    const documents = [
      { key: 'authors/ana', revision: 'r-ana-3', value: { name: 'Theirs' } },
    ];
    const answer = await saveChanges(
      fetchAnswering(
        Response.json({ error: 'conflict', documents }, { status: 409 }),
      ),
      changes,
    );
    expect(answer).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 409,
        text: '{"error":"conflict","documents":[{"key":"authors/ana","revision":"r-ana-3","value":{"name":"Theirs"}}]}',
        code: 'conflict',
        body: { error: 'conflict', documents },
      },
    });
  });

  it('keeps the key and message of a 409 exists', async () => {
    const answer = await saveChanges(
      fetchAnswering(
        Response.json(
          { error: 'exists', key: 'blog/new', message: 'Already there' },
          { status: 409 },
        ),
      ),
      changes,
    );
    expect(answer).toMatchObject({
      ok: false,
      failure: {
        code: 'exists',
        status: 409,
        text: 'Already there',
        body: { error: 'exists', key: 'blog/new', message: 'Already there' },
      },
    });
  });

  it('keeps the field errors of a 422 invalid, with their code', async () => {
    const errors = [
      {
        key: 'blog/one',
        path: ['image'],
        message: 'Another image has this name',
        code: 'media-collision',
      },
    ];
    const answer = await saveChanges(
      fetchAnswering(
        Response.json({ error: 'invalid', errors }, { status: 422 }),
      ),
      changes,
    );
    expect(answer).toMatchObject({
      ok: false,
      failure: { code: 'invalid', status: 422, body: { errors } },
    });
  });

  it('keeps the message of a 500 save-failed', async () => {
    const answer = await saveChanges(
      fetchAnswering(
        Response.json(
          { error: 'save-failed', message: 'git refused' },
          { status: 500 },
        ),
      ),
      changes,
    );
    expect(answer).toMatchObject({
      ok: false,
      failure: { code: 'save-failed', status: 500, text: 'git refused' },
    });
  });

  it('keeps the message of a 503 busy', async () => {
    const answer = await saveChanges(
      fetchAnswering(
        Response.json(
          { error: 'busy', message: 'Another save' },
          { status: 503 },
        ),
      ),
      changes,
    );
    expect(answer).toMatchObject({
      ok: false,
      failure: { code: 'busy', status: 503 },
    });
  });

  it('is a plain failure when a 413 body is not in the shape of its code', async () => {
    const answer = await saveChanges(
      fetchAnswering(new Response('Too big', { status: 413 })),
      changes,
    );
    expect(answer).toEqual({
      ok: false,
      failure: { kind: 'http', status: 413, text: 'Too big' },
    });
  });

  it('is a shape failure when the rebuild flag is not a boolean', async () => {
    const answer = await saveChanges(
      fetchAnswering(
        Response.json({ revisions: {}, warnings: [], rebuild: 'yes' }),
      ),
      changes,
    );
    expect(answer).toEqual({ ok: false, failure: SHAPE });
  });
});

describe('uploadMedia', () => {
  it('posts the file with its type', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', {
      type: 'image/png',
    });
    const fetchImpl = fetchAnswering(
      Response.json(
        {
          id: 'm1',
          url: '/media/staging/m1.png',
          width: 2,
          height: 3,
          format: 'png',
        },
        { status: 201 },
      ),
    );
    const answer = await uploadMedia(fetchImpl, file);
    expect(fetchImpl).toHaveBeenCalledWith('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: file,
    });
    expect(answer).toEqual({
      ok: true,
      body: {
        id: 'm1',
        url: '/media/staging/m1.png',
        width: 2,
        height: 3,
        format: 'png',
      },
    });
  });

  it('keeps the text of a refusal, which has no code', async () => {
    const answer = await uploadMedia(
      fetchAnswering(
        new Response('Supported types: image/png', { status: 415 }),
      ),
      new File([], 'a.bmp', { type: 'image/bmp' }),
    );
    expect(answer).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 415,
        text: 'Supported types: image/png',
      },
    });
  });

  it('is a shape failure when the format is not an image format of the CMS', async () => {
    const answer = await uploadMedia(
      fetchAnswering(
        Response.json(
          { id: 'm1', url: '/a.bmp', width: 1, height: 1, format: 'bmp' },
          { status: 201 },
        ),
      ),
      new File([], 'a.bmp'),
    );
    expect(answer).toEqual({
      ok: false,
      failure: { ...SHAPE, status: 201 },
    });
  });
});

describe('waitForNewBundle', () => {
  const statusWith = (bundleId: string | null) =>
    Response.json(
      bundleId === null
        ? { bundle: null }
        : { bundle: { bundleId, siteCommit: null } },
    );

  it('resolves true when the bundle id differs from the one before, after a pause before each poll', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(statusWith('b1'))
      .mockResolvedValueOnce(statusWith('b2'));
    const pause = vi.fn(async () => {});
    const changed = await waitForNewBundle(fetchImpl, 'b1', 5, pause, 250);
    expect(changed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith('/api/status');
    expect(pause.mock.calls).toEqual([[250], [250]]);
  });

  it('resolves false after the given number of polls', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => statusWith('b1'));
    const changed = await waitForNewBundle(fetchImpl, 'b1', 3, async () => {});
    expect(changed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps polling after a status that failed', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(statusWith('b2'));
    const changed = await waitForNewBundle(fetchImpl, 'b1', 2, async () => {});
    expect(changed).toBe(true);
  });

  it('does not count a status without a bundle as a change', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => statusWith(null));
    const changed = await waitForNewBundle(
      fetchImpl,
      undefined,
      1,
      async () => {},
    );
    expect(changed).toBe(false);
  });

  it('counts the first bundle as a change when nothing was known before', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => statusWith('b1'));
    const changed = await waitForNewBundle(
      fetchImpl,
      undefined,
      1,
      async () => {},
    );
    expect(changed).toBe(true);
  });

  it('waits one second between polls when no pause is given', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<FetchLike>(async () => statusWith('b1'));
      const waiting = waitForNewBundle(fetchImpl, 'b1', 1);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchImpl).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(waiting).resolves.toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
