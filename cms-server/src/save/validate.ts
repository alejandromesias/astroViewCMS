// The validation stage of a save (WORKPLAN 2.5c items 3 and 4, PHASE-2-DESIGN 5.3): the new values go to the preview
// node, with cms-server's own media map (D12), before anything is written. A refinement that threw does not block
// the save (5.1 item 9); its key is kept for the build check.
import type { FieldError, MediaInfo } from 'preview-protocol';
import { readMedia } from '../media/metadata.ts';
import type {
  MediaFiles,
  PreviewClient,
  SaveContext,
  SaveStop,
} from './context.ts';

/** The preview client until 2.9d: every check fails, so a save answers `503 preview-unavailable`. */
export const previewNotReady: PreviewClient = {
  validate: () =>
    Promise.reject(new Error('The preview node is not connected yet')),
};

/** Checks the new values of the created and updated documents. Deletes are not checked. */
export async function validateChanges(
  ctx: SaveContext,
): Promise<SaveStop | undefined> {
  const documents = Object.fromEntries(
    ctx.changes
      .filter((change) => !change.deleted)
      .map((change) => [change.document, change.data]),
  );
  const media = await mediaMapOf(ctx.media);
  let errors: readonly FieldError[];
  try {
    errors = await ctx.preview.validate(documents, media);
  } catch (error) {
    ctx.log.warn('the preview node did not check the save', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      status: 503,
      body: {
        error: 'preview-unavailable',
        message:
          'The preview node did not answer, so nothing was saved. Try again once it is ready.',
      },
    };
  }
  ctx.refinements = [
    ...new Set(
      errors
        .filter((error) => error.kind === 'refinement-threw')
        .map((error) => error.key),
    ),
  ];
  const blocking = errors.filter((error) => error.kind !== 'refinement-threw');
  if (blocking.length === 0) return undefined;
  return {
    status: 422,
    body: {
      error: 'invalid',
      errors: blocking.map((error) => ({
        key: error.key,
        path: error.path,
        message: error.message,
      })),
    },
  };
}

/** The media of `media.json` in the shape of the render request (D12): each staged image's URL on the CMS origin. */
export async function mediaMapOf(
  media: MediaFiles,
): Promise<Record<string, MediaInfo>> {
  const entries = await readMedia(media.mediaFile);
  return Object.fromEntries(
    [...entries].map(([id, measures]) => [
      id,
      {
        url: `${media.cmsOrigin}/media/staging/${id}.${measures.format}`,
        width: measures.width,
        height: measures.height,
        format: measures.format,
      },
    ]),
  );
}
