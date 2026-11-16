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
});
