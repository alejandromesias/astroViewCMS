import { describe, expect, it, vi } from 'vitest';
import { type ApiFailure, type FetchLike, saveChanges } from './api.ts';
import { failureMessages, failureText, saveMessages } from './messages.ts';

const CHANGES = {
  changes: [{ document: 'blog/a', baseRevision: 'r1', data: {} }],
};

/** The failure of a save whose request is answered by `answer`, as the API reads it. */
async function failureOf(answer: () => Promise<Response>): Promise<ApiFailure> {
  const result = await saveChanges(vi.fn<FetchLike>(answer), CHANGES);
  if (result.ok) throw new Error('the answer was not a failure');
  return result.failure;
}

/** The failure of a save answered with this status and JSON body. */
const refusedWith = (status: number, body: unknown) =>
  failureOf(async () => Response.json(body, { status }));

describe('saveMessages', () => {
  it('says the save was made, when nothing else came back', () => {
    expect(
      saveMessages({ revisions: {}, warnings: [], rebuild: false }),
    ).toEqual([{ level: 'ok', text: 'Saved.' }]);
  });

  it('says the change applies after a rebuild', () => {
    expect(
      saveMessages({ revisions: {}, warnings: [], rebuild: true }),
    ).toEqual([{ level: 'ok', text: 'Saved. Applies after rebuild.' }]);
  });

  it('shows a known warning with its path, next to its document', () => {
    expect(
      saveMessages({
        revisions: {},
        warnings: [
          { key: 'blog/a', path: ['image'], code: 'public-image-missing' },
        ],
        rebuild: false,
      }),
    ).toEqual([
      { level: 'ok', text: 'Saved.' },
      {
        level: 'warning',
        text: 'image: An image this document uses is not in the public folder',
        field: 'blog/a',
      },
    ]);
  });

  it('joins a numeric path with dots', () => {
    const [, warning] = saveMessages({
      revisions: {},
      warnings: [
        {
          key: 'blog/a',
          path: ['links', 0, 'url'],
          code: 'public-image-missing',
        },
      ],
      rebuild: false,
    });
    expect(warning).toEqual({
      level: 'warning',
      text: 'links.0.url: An image this document uses is not in the public folder',
      field: 'blog/a',
    });
  });

  it.each([
    ['an unknown code', 'some-code', 'Warning: some-code'],
    ['a prototype key', 'constructor', 'Warning: constructor'],
  ])('shows %s with the code as its text', (_, code, text) => {
    expect(
      saveMessages({
        revisions: {},
        warnings: [{ key: 'blog/b', path: [], code }],
        rebuild: false,
      }),
    ).toEqual([
      { level: 'ok', text: 'Saved.' },
      { level: 'warning', text, field: 'blog/b' },
    ]);
  });
});

describe('failureMessages', () => {
  it('says a request that got no answer may not have been saved', async () => {
    const failure = await failureOf(async () => {
      throw new Error('offline');
    });
    expect(failureMessages(failure)).toEqual([
      {
        level: 'error',
        text: 'Could not reach the server (offline). Reload before you save again.',
      },
    ]);
  });

  it("says an answer that is not the contract's has to be read again", async () => {
    const failure = await failureOf(async () =>
      Response.json({}, { status: 200 }),
    );
    expect(failureMessages(failure)).toEqual([
      {
        level: 'error',
        text: "The server's answer was not understood. Reload before you save again.",
      },
    ]);
  });

  it('shows an answer without a code with its status and text', async () => {
    const failure = await failureOf(
      async () => new Response('boom', { status: 500 }),
    );
    expect(failureMessages(failure)).toEqual([
      { level: 'error', text: 'The save did not happen (500): boom' },
    ]);
  });

  it('names each document of a 409 conflict, next to its form', async () => {
    const failure = await refusedWith(409, {
      error: 'conflict',
      documents: [
        { key: 'blog/a', revision: 'r2' },
        { key: 'blog/b', revision: null },
      ],
    });
    const changed =
      'Changed since you opened it. Reload to take the saved version, or keep yours.';
    expect(failureMessages(failure)).toEqual([
      { level: 'error', text: changed, field: 'blog/a' },
      { level: 'error', text: changed, field: 'blog/b' },
    ]);
  });

  it('puts each 422 issue next to its document, with its path', async () => {
    const failure = await refusedWith(422, {
      error: 'invalid',
      errors: [
        { key: 'blog/a', path: ['links', 0, 'url'], message: 'Invalid url' },
      ],
    });
    expect(failureMessages(failure)).toEqual([
      { level: 'error', text: 'links.0.url: Invalid url', field: 'blog/a' },
    ]);
  });

  it.each([
    [
      'media-collision',
      'Another image already has this name. Pick another image.',
    ],
    ['staged-image-missing', 'The uploaded image is gone. Upload it again.'],
  ])(
    'says what the 422 code %s means, next to its field',
    async (code, text) => {
      const failure = await refusedWith(422, {
        error: 'invalid',
        errors: [{ key: 'blog/a', path: ['image'], message: 'x', code }],
      });
      expect(failureMessages(failure)).toEqual([
        { level: 'error', text: `image: ${text}`, field: 'blog/a' },
      ]);
    },
  );

  it('shows the message of a 422 issue whose code is a prototype key', async () => {
    const failure = await refusedWith(422, {
      error: 'invalid',
      errors: [
        { key: 'blog/a', path: [], message: 'Required', code: 'constructor' },
      ],
    });
    expect(failureMessages(failure)).toEqual([
      { level: 'error', text: 'Required', field: 'blog/a' },
    ]);
  });

  it('keeps a 422 issue without a path as its message alone', async () => {
    const failure = await refusedWith(422, {
      error: 'invalid',
      errors: [{ key: 'blog/a', path: [], message: 'Broken' }],
    });
    expect(failureMessages(failure)).toEqual([
      { level: 'error', text: 'Broken', field: 'blog/a' },
    ]);
  });

  it('says the save did not happen when a 422 has no issues', async () => {
    const failure = await refusedWith(422, { error: 'invalid', errors: [] });
    expect(failureMessages(failure)).toEqual([
      { level: 'error', text: 'The save did not happen: a field is invalid.' },
    ]);
  });

  it.each([
    'exists',
    'file-missing',
    'read-only',
    'unwritable',
    'unreadable',
    'duplicate-key',
    'outside-site',
    'pattern-mismatch',
  ])('shows the message of %s next to its document', async (code) => {
    const failure = await refusedWith(409, {
      error: code,
      key: 'blog/a',
      message: 'The server says so',
    });
    expect(failureMessages(failure)).toEqual([
      { level: 'error', text: 'The server says so', field: 'blog/a' },
    ]);
  });

  it('names the document that other documents refer to, and what to do', async () => {
    const failure = await refusedWith(409, {
      error: 'referenced-by',
      document: 'authors/ana',
      referrers: ['blog/a', 'blog/b'],
    });
    expect(failureMessages(failure)).toEqual([
      {
        level: 'error',
        text: 'authors/ana is used by blog/a, blog/b. Remove those references, then save again.',
        field: 'authors/ana',
      },
    ]);
  });

  it('says a developer has to change a reference that needs one', async () => {
    const failure = await refusedWith(409, {
      error: 'referenced-by',
      document: 'authors/ana',
      referrers: ['blog/a'],
      needsDeveloper: true,
    });
    expect(failureMessages(failure)).toEqual([
      {
        level: 'error',
        text: 'authors/ana is used by blog/a. A developer has to change those first.',
        field: 'authors/ana',
      },
    ]);
  });

  it('says nothing was kept after save-failed', async () => {
    const failure = await refusedWith(500, {
      error: 'save-failed',
      message: 'git refused',
    });
    expect(failureMessages(failure)).toEqual([
      {
        level: 'error',
        text: 'The save failed, and nothing was kept. Try again.',
      },
    ]);
  });

  it('says the revisions could not be read after save-committed', async () => {
    const failure = await refusedWith(500, {
      error: 'save-committed',
      message: 'no revisions',
    });
    expect(failureMessages(failure)).toEqual([
      {
        level: 'error',
        text: 'The save was written, but the new revisions could not be read. Reload before you save again.',
      },
    ]);
  });

  it.each(['busy', 'preview-unavailable'])(
    'answers %s with a plain "try again"',
    async (code) => {
      const failure = await refusedWith(503, { error: code, message: 'x' });
      expect(failureMessages(failure)).toEqual([
        { level: 'error', text: 'The save did not happen. Try again.' },
      ]);
    },
  );

  it('says the site is not built yet after no-bundle', async () => {
    const failure = await refusedWith(503, { error: 'no-bundle' });
    expect(failureMessages(failure)).toEqual([
      {
        level: 'error',
        text: 'The site is not built yet, so the save did not happen.',
      },
    ]);
  });

  it('shows the message of any other code with its status', async () => {
    const failure = await refusedWith(413, {
      error: 'body-too-large',
      message: 'Too big',
    });
    expect(failureMessages(failure)).toEqual([
      { level: 'error', text: 'The save did not happen (413): Too big' },
    ]);
  });
});

describe('failureText', () => {
  it('puts the status in front of the text of an answer', () => {
    expect(
      failureText('Could not load', {
        kind: 'http',
        status: 404,
        text: 'Unknown document',
      }),
    ).toBe('Could not load (404): Unknown document');
  });

  it('leaves the status out when no answer came', () => {
    expect(
      failureText('Could not load', {
        kind: 'network',
        status: 0,
        text: 'offline',
      }),
    ).toBe('Could not load: offline');
  });

  it("leaves the status out when the answer was not the contract's", () => {
    expect(
      failureText('Upload failed', {
        kind: 'shape',
        status: 201,
        text: 'the answer has the wrong shape',
      }),
    ).toBe('Upload failed: the answer has the wrong shape');
  });
});
