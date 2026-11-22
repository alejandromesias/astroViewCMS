import { describe, expect, it } from 'vitest';
import {
  changesAnswerSchema,
  documentAnswerSchema,
  documentListAnswerSchema,
  mediaAnswerSchema,
  overlayAnswerSchema,
  previewUrlAnswerSchema,
  publishAnswerSchema,
  saveAnswerSchema,
  schemaAnswerSchema,
  statusAnswerSchema,
} from './answers.ts';

describe('answer schemas accept the bodies the routes send', () => {
  it.each([
    [
      'GET /api/schema',
      schemaAnswerSchema,
      {
        collections: [
          {
            name: 'posts',
            loader: { kind: 'glob', pattern: '*.md' },
            schema: {},
          },
        ],
      },
    ],
    [
      'GET /api/documents?collection=',
      documentListAnswerSchema,
      {
        documents: [
          {
            key: 'posts/a',
            revision: 'r1',
            format: 'md',
            editable: true,
            buildTime: false,
            title: 'A',
          },
          {
            key: 'posts/b',
            revision: null,
            format: 'json',
            editable: false,
            buildTime: true,
            error: true,
          },
        ],
      },
    ],
    [
      'GET /api/documents?key=',
      documentAnswerSchema,
      {
        key: 'posts/a',
        file: 'src/a.md',
        value: {},
        revision: 'r1',
        format: 'md',
        editable: true,
        buildTime: false,
      },
    ],
    [
      'GET /api/status with no status source',
      statusAnswerSchema,
      { bundle: null },
    ],
    [
      'GET /api/changes',
      changesAnswerSchema,
      {
        documents: [
          { key: 'posts/a', status: 'modified', baseRevision: 'r1', value: {} },
        ],
        createdRecords: [
          { key: 'posts/b', format: 'json', buildTime: false, revision: 'r2' },
        ],
        fileErrors: [
          {
            path: 'src/x.json',
            error: { code: 'parse-error', message: 'bad' },
          },
        ],
      },
    ],
    [
      'PUT /api/changes, 200',
      saveAnswerSchema,
      {
        revisions: { 'posts/a': 'r2' },
        warnings: [
          { key: 'posts/a', path: ['cover'], code: 'public-image-missing' },
        ],
        rebuild: true,
      },
    ],
    [
      'GET /api/overlay',
      overlayAnswerSchema,
      {
        documents: { 'posts/a': {} },
        media: {
          'https://cms/media/staging/x.png': {
            url: 'https://cms/media/staging/x.png',
            width: 1,
            height: 2,
            format: 'png',
          },
        },
      },
    ],
    [
      'GET /api/preview-url',
      previewUrlAnswerSchema,
      { url: 'http://preview/about?token=t', origin: 'http://preview' },
    ],
    [
      'POST /api/publish, 200',
      publishAnswerSchema,
      {
        commit: null,
        overwritten: [],
        renamed: [],
        buildCheckSkipped: 'upstream-broken',
      },
    ],
    [
      'POST /api/media, 201',
      mediaAnswerSchema,
      {
        id: 'abc',
        url: 'http://cms/media/staging/abc.png',
        width: 10,
        height: 20,
        format: 'png',
      },
    ],
  ])('%s', (_route, schema, body) => {
    expect(schema.safeParse(body).success).toBe(true);
  });
});

describe('answer schemas refuse what the routes never send', () => {
  it('refuses a publish answer that skips the build check for another reason', () => {
    const body = {
      commit: null,
      overwritten: [],
      renamed: [],
      buildCheckSkipped: 'other',
    };
    expect(publishAnswerSchema.safeParse(body).success).toBe(false);
  });

  it('refuses an image format that the upload accepts no other way', () => {
    const body = { id: 'abc', url: 'u', width: 1, height: 1, format: 'svg' };
    expect(mediaAnswerSchema.safeParse(body).success).toBe(false);
  });

  it('refuses a status whose publish state is not one of the three', () => {
    const body = { bundle: null, publish: { state: 'queued', error: null } };
    expect(statusAnswerSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['GET /api/schema', schemaAnswerSchema],
    ['GET /api/documents?collection=', documentListAnswerSchema],
    ['GET /api/documents?key=', documentAnswerSchema],
    ['GET /api/status', statusAnswerSchema],
    ['GET /api/changes', changesAnswerSchema],
    ['PUT /api/changes, 200', saveAnswerSchema],
    ['GET /api/overlay', overlayAnswerSchema],
    ['GET /api/preview-url', previewUrlAnswerSchema],
    ['POST /api/publish, 200', publishAnswerSchema],
    ['POST /api/media, 201', mediaAnswerSchema],
  ])('refuses an empty body for %s', (_route, schema) => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it.each([
    [
      'a collection with no name',
      schemaAnswerSchema,
      { collections: [{ schema: {} }] },
    ],
    [
      'a loader with no kind',
      schemaAnswerSchema,
      { collections: [{ name: 'posts', loader: { pattern: '*' } }] },
    ],
    [
      'a loader of a kind the server never sends',
      schemaAnswerSchema,
      {
        collections: [{ name: 'posts', loader: { kind: 'dir', pattern: '*' } }],
      },
    ],
    [
      'a list item with no key',
      documentListAnswerSchema,
      {
        documents: [
          { revision: null, format: 'md', editable: true, buildTime: false },
        ],
      },
    ],
    [
      'a changed document with no key',
      changesAnswerSchema,
      {
        documents: [{ status: 'modified', baseRevision: null }],
        createdRecords: [],
        fileErrors: [],
      },
    ],
    [
      'a file error with no path',
      changesAnswerSchema,
      {
        documents: [],
        createdRecords: [],
        fileErrors: [{ error: { code: 'parse-error', message: 'bad' } }],
      },
    ],
    [
      'a save warning with no path',
      saveAnswerSchema,
      {
        revisions: {},
        warnings: [{ key: 'posts/a', code: 'public-image-missing' }],
        rebuild: false,
      },
    ],
    [
      'an overwritten document with no commit',
      publishAnswerSchema,
      { commit: null, overwritten: [{ key: 'posts/a' }], renamed: [] },
    ],
  ])('refuses %s', (_case, schema, body) => {
    expect(schema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['a build with no state', { build: {} }],
    ['a node with no bundle id', { node: { state: 'ready', error: null } }],
    [
      'a node state the server never sends',
      { node: { state: 'paused', bundleId: null, error: null } },
    ],
    ['errors with no keys', { errors: {} }],
    ['a bundle with no id', { bundle: { siteCommit: null } }],
    [
      'an upstream build failure as text (the shape before 2.10f)',
      {
        errors: {
          protocolMismatch: null,
          upstreamBuildFailed: 'Unexpected token',
          swap: null,
        },
      },
    ],
    [
      'an upstream build failure with no first error',
      {
        errors: {
          protocolMismatch: null,
          upstreamBuildFailed: { sha: 'a1b2c3d' },
          swap: null,
        },
      },
    ],
  ])('refuses a status with %s', (_case, part) => {
    expect(
      statusAnswerSchema.safeParse({ ...statusBody(), ...part }).success,
    ).toBe(false);
  });

  // 2.10f: the upstream build failure names the commit that does not build, and its first error.
  it('takes an upstream build failure with its sha and first error (2.10f)', () => {
    const failure = { sha: 'a1b2c3d', firstError: 'src/x.astro: boom' };
    const parsed = statusAnswerSchema.parse({
      ...statusBody(),
      errors: {
        protocolMismatch: null,
        upstreamBuildFailed: failure,
        swap: null,
      },
    });
    expect(parsed.errors?.upstreamBuildFailed).toStrictEqual(failure);
  });
});

// A status body in which every part is valid, so a test that replaces one part shows only that part.
function statusBody(): Record<string, unknown> {
  return {
    bundle: null,
    builder: 'on',
    build: { state: 'idle', error: null, failedCommit: null },
    node: { state: 'ready', bundleId: 'b1', error: null },
    lastSync: null,
    syncError: null,
    renamed: [],
    changesetSize: null,
    publish: { state: 'idle', error: null },
    errors: { protocolMismatch: null, upstreamBuildFailed: null, swap: null },
  };
}

// Every value of an enum or literal is accepted, one case each: a mutant that drops or changes one value fails its case.
describe('answer schemas take every value of their enums and literals', () => {
  it.each(['glob', 'file'])('takes the loader kind %s', (kind) => {
    const body = {
      collections: [{ name: 'posts', loader: { kind, pattern: '*' } }],
    };
    expect(schemaAnswerSchema.safeParse(body).success).toBe(true);
  });

  it('takes a loader with customId set to true', () => {
    const body = {
      collections: [
        {
          name: 'posts',
          loader: {
            kind: 'file',
            pattern: 'a.json',
            base: 'src',
            customId: true,
          },
        },
      ],
    };
    expect(schemaAnswerSchema.safeParse(body).success).toBe(true);
  });

  it.each(['created', 'modified', 'deleted'])(
    'takes the changed-document status %s',
    (status) => {
      const body = {
        documents: [{ key: 'posts/a', status, baseRevision: null }],
        createdRecords: [],
        fileErrors: [],
      };
      expect(changesAnswerSchema.safeParse(body).success).toBe(true);
    },
  );

  it.each(['on', 'off'])('takes the builder state %s', (builder) => {
    const body = { ...statusBody(), builder };
    expect(statusAnswerSchema.safeParse(body).success).toBe(true);
  });

  it.each(['off', 'idle', 'building', 'failed'])(
    'takes the build state %s',
    (state) => {
      const body = {
        ...statusBody(),
        build: { state, error: null, failedCommit: null },
      };
      expect(statusAnswerSchema.safeParse(body).success).toBe(true);
    },
  );

  it.each(['stopped', 'starting', 'ready', 'restarting', 'failed'])(
    'takes the node state %s',
    (state) => {
      const body = {
        ...statusBody(),
        node: { state, bundleId: null, error: null },
      };
      expect(statusAnswerSchema.safeParse(body).success).toBe(true);
    },
  );

  it.each(['idle', 'publishing', 'failed'])(
    'takes the publish state %s',
    (state) => {
      const body = { ...statusBody(), publish: { state, error: null } };
      expect(statusAnswerSchema.safeParse(body).success).toBe(true);
    },
  );
});
