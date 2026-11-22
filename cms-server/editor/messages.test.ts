import { describe, expect, it, vi } from 'vitest';
import {
  type ApiFailure,
  type FetchLike,
  publishChanges,
  saveChanges,
} from './api.ts';
import {
  failureMessages,
  failureText,
  publishFailureMessages,
  publishMessages,
  saveMessages,
  statusMessages,
} from './messages.ts';

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

/** The failure of a publish answered with this status and JSON body, as the API reads it. */
async function publishRefusedWith(
  status: number,
  body: unknown,
): Promise<ApiFailure> {
  const result = await publishChanges(
    vi.fn<FetchLike>(async () => Response.json(body, { status })),
  );
  if (result.ok) throw new Error('the answer was not a failure');
  return result.failure;
}

describe('publishMessages', () => {
  it('says nothing was published when the commit is null', () => {
    expect(
      publishMessages({ commit: null, overwritten: [], renamed: [] }),
    ).toEqual([
      {
        level: 'ok',
        text: 'Nothing to publish. Nothing differs from upstream.',
      },
    ]);
  });

  it('says the commit, with its short id', () => {
    expect(
      publishMessages({ commit: 'c0ffee1234', overwritten: [], renamed: [] }),
    ).toEqual([{ level: 'ok', text: 'Published c0ffee1.' }]);
  });

  it('warns about each renamed document, so it is checked before the next publish', () => {
    expect(
      publishMessages({
        commit: 'c0ffee1234',
        overwritten: [],
        renamed: [{ key: 'blog/b', from: 'blog/b.md', to: 'blog/b-2.md' }],
      }),
    ).toEqual([
      { level: 'ok', text: 'Published c0ffee1.' },
      {
        level: 'warning',
        text: 'blog/b was renamed from blog/b.md to blog/b-2.md. Check it before you publish again: a rename duplicate would be pushed.',
      },
    ]);
  });

  it('warns about a renamed document even when the commit is null', () => {
    expect(
      publishMessages({
        commit: null,
        overwritten: [],
        renamed: [{ key: 'blog/b', from: 'blog/b.md', to: 'blog/b-2.md' }],
      }).map((message) => message.level),
    ).toEqual(['ok', 'warning']);
  });

  it('warns about each overwritten document, with the commit it replaced', () => {
    expect(
      publishMessages({
        commit: 'c0ffee1234',
        overwritten: [{ key: 'blog/a', commit: 'abc123456' }],
        renamed: [],
      }),
    ).toEqual([
      { level: 'ok', text: 'Published c0ffee1.' },
      {
        level: 'warning',
        text: 'Overwrote the upstream change to blog/a (from abc1234).',
      },
    ]);
  });

  it('warns when the build check was skipped because the upstream code does not build', () => {
    expect(
      publishMessages({
        commit: 'c0ffee1234',
        overwritten: [],
        renamed: [],
        buildCheckSkipped: 'upstream-broken',
      }),
    ).toEqual([
      { level: 'ok', text: 'Published c0ffee1.' },
      {
        level: 'warning',
        text: 'The upstream code does not build, so the build check was skipped.',
      },
    ]);
  });
});

describe('publishFailureMessages', () => {
  it.each([
    [
      503,
      { error: 'busy', message: 'Busy' },
      'The repository is busy, so nothing was published. Try again.',
    ],
    [
      503,
      { error: 'build-in-progress', message: 'Rebuilding' },
      'The preview is still being rebuilt, so nothing was published. Try again once the build is done.',
    ],
    [
      503,
      { error: 'upstream-changed', message: 'New code' },
      'The upstream code changed while the publish ran, so nothing was published. Your saves are kept. Try again.',
    ],
    [
      503,
      { error: 'no-bundle' },
      'The site is not built yet, so nothing was published.',
    ],
    [
      409,
      { error: 'publish-in-progress', message: 'Running' },
      'Another publish is running, so nothing was published. Try again when it ends.',
    ],
    [
      409,
      { error: 'remote-moved', message: 'Moved' },
      'The remote moved while the publish ran, so nothing was published. Your saves are kept. Publish again.',
    ],
    [502, { error: 'push-failed', message: 'Refused' }, 'Refused'],
    [502, { error: 'push-rejected', message: 'Moved on' }, 'Moved on'],
    [502, { error: 'sync-failed', message: 'No remote' }, 'No remote'],
    [500, { error: 'publish-failed', message: 'Failed' }, 'Failed'],
  ])(
    'shows the text of a %i answer with the code in its body',
    async (status, body, text) => {
      expect(
        publishFailureMessages(await publishRefusedWith(status, body)),
      ).toEqual([{ level: 'error', text }]);
    },
  );

  it('shows the first error of a 424 build-failed after the message', async () => {
    expect(
      publishFailureMessages(
        await publishRefusedWith(424, {
          error: 'build-failed',
          message: 'The site does not build.',
          firstError: 'Unexpected token',
        }),
      ),
    ).toEqual([
      {
        level: 'error',
        text: 'The site does not build. First error: Unexpected token',
      },
    ]);
  });

  it('shows the message of a 424 build-failed alone when it has no first error', async () => {
    expect(
      publishFailureMessages(
        await publishRefusedWith(424, {
          error: 'build-failed',
          message: 'The site does not build.',
          firstError: '',
        }),
      ),
    ).toEqual([{ level: 'error', text: 'The site does not build.' }]);
  });

  it('names each invalid document with its path, and the known image codes in full', async () => {
    expect(
      publishFailureMessages(
        await publishRefusedWith(422, {
          error: 'invalid',
          errors: [
            { key: 'blog/a', path: ['links', 0, 'url'], message: 'Bad url' },
            {
              key: 'blog/a',
              path: ['image'],
              message: 'x',
              code: 'media-collision',
            },
          ],
        }),
      ),
    ).toEqual([
      { level: 'error', text: 'blog/a: links.0.url: Bad url' },
      {
        level: 'error',
        text: 'blog/a: image: Another image already has this name. Pick another image.',
      },
    ]);
  });

  it('says a document is invalid when a 422 names no field', async () => {
    expect(
      publishFailureMessages(
        await publishRefusedWith(422, { error: 'invalid', errors: [] }),
      ),
    ).toEqual([
      {
        level: 'error',
        text: 'The publish did not happen: a document is invalid.',
      },
    ]);
  });

  it('says a developer must change the referrers when needsDeveloper is set', async () => {
    expect(
      publishFailureMessages(
        await publishRefusedWith(409, {
          error: 'referenced-by',
          document: 'data:src/config/menu.json',
          referrers: ['blog/a'],
          needsDeveloper: true,
        }),
      ),
    ).toEqual([
      {
        level: 'error',
        text: 'data:src/config/menu.json is used by blog/a. A developer has to change those first.',
      },
    ]);
  });

  it('says to remove the references, then publish again, when a developer is not needed', async () => {
    expect(
      publishFailureMessages(
        await publishRefusedWith(409, {
          error: 'referenced-by',
          document: 'data:src/config/menu.json',
          referrers: ['blog/a', 'blog/b'],
        }),
      ),
    ).toEqual([
      {
        level: 'error',
        text: 'data:src/config/menu.json is used by blog/a, blog/b. Remove those references, then publish again.',
      },
    ]);
  });

  it('shows a code the publish does not name with its status and text', async () => {
    expect(
      publishFailureMessages(
        await publishRefusedWith(500, { error: 'internal_error' }),
      ),
    ).toEqual([
      {
        level: 'error',
        text: 'The publish did not happen (500): {"error":"internal_error"}',
      },
    ]);
  });

  it('shows a plain answer with its status and text', async () => {
    const failure = await publishChanges(
      vi.fn<FetchLike>(
        async () => new Response('gateway down', { status: 500 }),
      ),
    );
    if (failure.ok) throw new Error('the answer was not a failure');
    expect(publishFailureMessages(failure.failure)).toEqual([
      {
        level: 'error',
        text: 'The publish did not happen (500): gateway down',
      },
    ]);
  });

  it('says a request that got no answer must be reloaded before the next publish', async () => {
    const failure = await publishChanges(
      vi.fn<FetchLike>(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    if (failure.ok) throw new Error('the answer was not a failure');
    expect(publishFailureMessages(failure.failure)).toEqual([
      {
        level: 'error',
        text: 'Could not reach the server (Failed to fetch). Reload before you publish again.',
      },
    ]);
  });

  it('says the answer was not understood when it has the wrong shape', async () => {
    const failure = await publishChanges(
      vi.fn<FetchLike>(async () => Response.json({ commit: 'x' })),
    );
    if (failure.ok) throw new Error('the answer was not a failure');
    expect(publishFailureMessages(failure.failure)).toEqual([
      {
        level: 'error',
        text: "The server's answer was not understood. Reload before you publish again.",
      },
    ]);
  });
});

describe('a save made during a publish', () => {
  it('says a publish is running, and to save again when it ends', async () => {
    expect(
      failureMessages(
        await refusedWith(409, {
          error: 'publish-in-progress',
          message: 'Running',
        }),
      ),
    ).toEqual([
      {
        level: 'error',
        text: 'A publish is running. Save again when it ends.',
      },
    ]);
  });
});

describe('statusMessages', () => {
  it('shows nothing while idle with no upstream error', () => {
    expect(
      statusMessages({ state: 'idle', error: null, upstreamBuildFailed: null }),
    ).toEqual([]);
  });

  it('shows nothing when the status has no publish part', () => {
    expect(
      statusMessages({
        state: undefined,
        error: null,
        upstreamBuildFailed: null,
      }),
    ).toEqual([]);
  });

  it('warns that a publish is running, and that Save and Publish are off', () => {
    expect(
      statusMessages({
        state: 'publishing',
        error: null,
        upstreamBuildFailed: null,
      }),
    ).toEqual([
      {
        level: 'warning',
        text: 'A publish is running. Save and Publish are off until it ends.',
      },
    ]);
  });

  it('shows the error of the last publish that failed', () => {
    expect(
      statusMessages({
        state: 'failed',
        error: 'The remote refused the push',
        upstreamBuildFailed: null,
      }),
    ).toEqual([
      {
        level: 'error',
        text: 'The last publish failed: The remote refused the push',
      },
    ]);
  });

  it('says the last publish failed when no error is kept', () => {
    expect(
      statusMessages({
        state: 'failed',
        error: null,
        upstreamBuildFailed: null,
      }),
    ).toEqual([{ level: 'error', text: 'The last publish failed.' }]);
  });

  it('warns about an upstream build error, with the commit that does not build (2.10f)', () => {
    expect(
      statusMessages({
        state: 'idle',
        error: null,
        upstreamBuildFailed: {
          sha: 'a1b2c3d4e5f6',
          firstError: 'Unexpected token',
        },
      }),
    ).toEqual([
      {
        level: 'warning',
        text: 'The upstream code does not build (commit a1b2c3d): Unexpected token',
      },
    ]);
  });

  it('shows why Save is off while the preview node is not ready', () => {
    expect(
      statusMessages({
        state: 'idle',
        error: null,
        upstreamBuildFailed: null,
        node: 'restarting',
      }),
    ).toEqual([{ level: 'warning', text: 'Preview is restarting' }]);
  });

  it('shows nothing for a ready preview node', () => {
    expect(
      statusMessages({
        state: 'idle',
        error: null,
        upstreamBuildFailed: null,
        node: 'ready',
      }),
    ).toEqual([]);
  });
});
