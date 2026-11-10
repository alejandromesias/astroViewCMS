import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentLog } from '../../test/helpers/repo.ts';
import {
  MEDIA,
  mediaEntry,
  previewSays,
  saveContext,
} from '../../test/helpers/save-context.ts';
import {
  removeWorkingCopies,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import { PreviewUnavailableError } from '../preview/client.ts';
import type { SaveChange } from './body.ts';
import { mediaMapOf, validateChanges } from './validate.ts';

const UPDATE: SaveChange = {
  document: 'authors/ana',
  baseRevision: 'r',
  deleted: false,
  data: { name: 'Ana' },
};

afterEach(removeWorkingCopies);

describe('validateChanges', () => {
  it('sends the new values of the changed documents, and the media map, to the preview', async () => {
    const folder = await tempWorkingCopy({
      'media.json': '{"abc":{"width":2,"height":3,"format":"png"}}\n',
    });
    const preview = previewSays();
    const ctx = saveContext({
      changes: [
        UPDATE,
        { document: 'authors/old', baseRevision: 'r', deleted: true },
      ],
      preview,
      media: {
        stagingDir: join(folder, 'staging'),
        mediaFile: join(folder, 'media.json'),
        cmsOrigin: MEDIA.cmsOrigin,
      },
    });
    expect(await validateChanges(ctx)).toBeUndefined();
    expect(preview.validate).toHaveBeenCalledTimes(1);
    expect(preview.validate).toHaveBeenCalledWith(
      { 'authors/ana': { name: 'Ana' } },
      {
        [mediaEntry('abc', 'png').url]: mediaEntry('abc', 'png'),
        'src/assets/uploads/abc.png': mediaEntry('abc', 'png'),
      },
    );
  });

  it('answers 422 with the errors that block the save, without their kind', async () => {
    const ctx = saveContext({
      changes: [UPDATE],
      preview: previewSays([
        {
          key: 'authors/ana',
          path: ['name'],
          message: 'Required',
          kind: 'invalid',
        },
        { key: 'authors/ana', path: ['role'], message: 'Too short' },
      ]),
    });
    expect(await validateChanges(ctx)).toStrictEqual({
      status: 422,
      body: {
        error: 'invalid',
        errors: [
          { key: 'authors/ana', path: ['name'], message: 'Required' },
          { key: 'authors/ana', path: ['role'], message: 'Too short' },
        ],
      },
    });
  });

  it('lets a refinement that threw through, and keeps its key for the build check', async () => {
    const ctx = saveContext({
      changes: [UPDATE],
      preview: previewSays([
        {
          key: 'authors/ana',
          path: ['name'],
          message: 'boom',
          kind: 'refinement-threw',
        },
      ]),
    });
    expect(await validateChanges(ctx)).toBeUndefined();
    expect(ctx.refinements).toStrictEqual(['authors/ana']);
  });

  it('blocks on an invalid error next to a refinement that threw, and reports only the invalid one', async () => {
    const ctx = saveContext({
      changes: [UPDATE],
      preview: previewSays([
        {
          key: 'authors/ana',
          path: ['name'],
          message: 'boom',
          kind: 'refinement-threw',
        },
        {
          key: 'authors/ana',
          path: ['role'],
          message: 'Required',
          kind: 'invalid',
        },
      ]),
    });
    expect(await validateChanges(ctx)).toStrictEqual({
      status: 422,
      body: {
        error: 'invalid',
        errors: [{ key: 'authors/ana', path: ['role'], message: 'Required' }],
      },
    });
    expect(ctx.refinements).toStrictEqual(['authors/ana']);
  });

  it('answers 503 preview-unavailable and logs the reason when the preview does not answer', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const preview = {
      validate: vi.fn(() => Promise.reject(new Error('timed out'))),
    };
    const ctx = saveContext({ changes: [UPDATE], preview, log });
    expect(await validateChanges(ctx)).toStrictEqual({
      status: 503,
      body: {
        error: 'preview-unavailable',
        message:
          'The preview node did not answer, so nothing was saved. Try again once it is ready.',
      },
    });
    expect(log.warn).toHaveBeenCalledWith(
      'the preview node did not check the save',
      {
        reason: 'timed out',
      },
    );
  });

  it('answers 503 with the message of a PreviewUnavailableError, and logs its status', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const preview = {
      validate: vi.fn(() =>
        Promise.reject(
          new PreviewUnavailableError('The preview build failed: boom', 500),
        ),
      ),
    };
    const ctx = saveContext({ changes: [UPDATE], preview, log });
    expect(await validateChanges(ctx)).toStrictEqual({
      status: 503,
      body: {
        error: 'preview-unavailable',
        message: 'The preview build failed: boom',
      },
    });
    expect(log.warn).toHaveBeenCalledWith(
      'the preview node did not check the save',
      {
        reason: 'The preview build failed: boom',
        status: 500,
      },
    );
  });
});

describe('mediaMapOf', () => {
  const FOLDER = 'src/assets/uploads';
  const ID_A = `${'a'.repeat(16)}${'1'.repeat(48)}`;
  const ID_B = `${'a'.repeat(16)}${'2'.repeat(48)}`;
  const mediaOf = (folder: string) => ({
    stagingDir: join(folder, 'staging'),
    mediaFile: join(folder, 'media.json'),
    cmsOrigin: MEDIA.cmsOrigin,
  });
  const entry = (format: string): string =>
    `{"width":2,"height":3,"format":"${format}"}`;

  it('is empty when there is no media.json yet', async () => {
    const folder = await tempWorkingCopy({});
    expect(
      await mediaMapOf(mediaOf(folder), FOLDER, silentLog()),
    ).toStrictEqual({});
  });

  it('keys each entry by its staging URL and by its project path', async () => {
    const folder = await tempWorkingCopy({
      'media.json': `{"${ID_A}":${entry('png')},"${'b'.repeat(64)}":${entry('webp')}}\n`,
    });
    const map = await mediaMapOf(mediaOf(folder), FOLDER, silentLog());
    expect(Object.keys(map)).toStrictEqual([
      `${MEDIA.cmsOrigin}/media/staging/${ID_A}.png`,
      `${FOLDER}/${'a'.repeat(16)}.png`,
      `${MEDIA.cmsOrigin}/media/staging/${'b'.repeat(64)}.webp`,
      `${FOLDER}/${'b'.repeat(16)}.webp`,
    ]);
    expect(map[`${FOLDER}/${'a'.repeat(16)}.png`]).toStrictEqual(
      mediaEntry(ID_A, 'png'),
    );
    expect(map[`${MEDIA.cmsOrigin}/media/staging/${ID_A}.png`]).toStrictEqual(
      mediaEntry(ID_A, 'png'),
    );
  });

  it('keeps the first entry of two ids with one 16-character prefix, logs the clash and does not throw', async () => {
    const folder = await tempWorkingCopy({
      'media.json': `{"${ID_A}":${entry('png')},"${ID_B}":${entry('png')}}\n`,
    });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const map = await mediaMapOf(mediaOf(folder), FOLDER, log);
    expect(map[`${FOLDER}/${'a'.repeat(16)}.png`]).toStrictEqual(
      mediaEntry(ID_A, 'png'),
    );
    expect(map[`${MEDIA.cmsOrigin}/media/staging/${ID_B}.png`]).toStrictEqual(
      mediaEntry(ID_B, 'png'),
    );
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'two staged images share one file name; the first keeps it',
      { path: `${FOLDER}/${'a'.repeat(16)}.png`, kept: ID_A, skipped: ID_B },
    );
  });
});
