import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  removeWorkingCopies,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import {
  MEDIA,
  mediaEntry,
  previewSays,
  saveContext,
} from '../../test/helpers/save-context.ts';
import type { SaveChange } from './body.ts';
import { mediaMapOf, previewNotReady, validateChanges } from './validate.ts';

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
        mediaFile: join(folder, 'media.json'),
        cmsOrigin: MEDIA.cmsOrigin,
      },
    });
    expect(await validateChanges(ctx)).toBeUndefined();
    expect(preview.validate).toHaveBeenCalledTimes(1);
    expect(preview.validate).toHaveBeenCalledWith(
      { 'authors/ana': { name: 'Ana' } },
      { abc: mediaEntry('abc', 'png') },
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
});

describe('previewNotReady', () => {
  it('rejects every check, so a save answers 503', async () => {
    await expect(previewNotReady.validate({}, {})).rejects.toThrow(
      'The preview node is not connected yet',
    );
  });
});

describe('mediaMapOf', () => {
  it('is empty when there is no media.json yet', async () => {
    const folder = await tempWorkingCopy({});
    expect(
      await mediaMapOf({
        mediaFile: join(folder, 'media.json'),
        cmsOrigin: MEDIA.cmsOrigin,
      }),
    ).toStrictEqual({});
  });

  it('gives each entry its staged URL on the CMS origin', async () => {
    const folder = await tempWorkingCopy({
      'media.json': '{"abc":{"width":2,"height":3,"format":"png"}}\n',
    });
    expect(
      await mediaMapOf({
        mediaFile: join(folder, 'media.json'),
        cmsOrigin: MEDIA.cmsOrigin,
      }),
    ).toStrictEqual({ abc: mediaEntry('abc', 'png') });
  });
});
