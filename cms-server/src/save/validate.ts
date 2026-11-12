// The validation stage of a save (WORKPLAN 2.5c items 3 and 4, PHASE-2-DESIGN 5.3): the new values go to the preview
// node, with cms-server's own media map (D12), before anything is written. A refinement that threw does not block
// the save (5.1 item 9); its key is kept for the build check.
import { posix } from 'node:path';
import type { FieldError, MediaInfo } from 'preview-protocol';
import type { Logger } from '../log.ts';
import { readMedia } from '../media/metadata.ts';
import {
  PREVIEW_UNAVAILABLE_TEXT,
  PreviewUnavailableError,
} from '../preview/client.ts';
import type { MediaFiles, SaveContext, SaveStop } from './context.ts';

/** Checks the new values of the created and updated documents. Deletes are not checked. */
export async function validateChanges(
  ctx: SaveContext,
): Promise<SaveStop | undefined> {
  const documents = Object.fromEntries(
    ctx.changes
      .filter((change) => !change.deleted)
      .map((change) => [change.document, change.data]),
  );
  const media = await mediaMapOf(ctx.media, ctx.config.media.folder, ctx.log);
  let errors: readonly FieldError[];
  try {
    errors = await ctx.preview.validate(documents, media);
  } catch (error) {
    return previewUnavailableStop(error, ctx.log);
  }
  ctx.refinements = [
    ...new Set(
      errors
        .filter((error) => error.kind === 'refinement-threw')
        .map((error) => error.key),
    ),
  ];
  return invalidStop(errors);
}

/**
 * The 503 for a node that could not check the values. The client's error names the build or node error, and the log gets
 * its HTTP status when there was an answer. A save and a publish (2.10d) both answer with it.
 */
export function previewUnavailableStop(error: unknown, log: Logger): SaveStop {
  const reason = error instanceof Error ? error.message : String(error);
  log.warn(
    'the preview node did not check the save',
    error instanceof PreviewUnavailableError && error.status !== null
      ? { reason, status: error.status }
      : { reason },
  );
  return {
    status: 503,
    body: {
      error: 'preview-unavailable',
      message:
        error instanceof PreviewUnavailableError
          ? error.message
          : PREVIEW_UNAVAILABLE_TEXT,
    },
  };
}

/**
 * The 422 for the errors of a check, or undefined when none blocks. A refinement that threw does not block (5.1 item 9).
 * A save and a publish (2.10d) both answer with it.
 */
export function invalidStop(
  errors: readonly FieldError[],
): SaveStop | undefined {
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

/**
 * The media of `media.json` in the shape of the render request (D12). Each entry is keyed by its staging URL on the CMS
 * origin (a draft's ref) and by `<folder>/<id16>.<format>` (a saved image's project path), the two refs that the
 * renderer looks up (WORKPLAN 2.7b). Two ids with the same 16-character prefix share one path: the first keeps it, the
 * clash is logged, and nothing throws, so that one clash never fails every save of the site.
 * `keep` takes the 16-character name of an entry (its `revisionOf`) and says whether the entry is mapped; the overlay
 * maps only the images the bundle lacks (WORKPLAN 2.9e). Every entry is mapped when it is not given.
 */
export async function mediaMapOf(
  media: MediaFiles,
  folder: string,
  log: Logger,
  keep: (name: string) => boolean = () => true,
): Promise<Record<string, MediaInfo>> {
  const entries = await readMedia(media.mediaFile);
  const map = new Map<string, MediaInfo>();
  const pathOwners = new Map<string, string>();
  for (const [id, measures] of entries) {
    if (!keep(id.slice(0, 16))) continue;
    const info: MediaInfo = {
      url: `${media.cmsOrigin}/media/staging/${id}.${measures.format}`,
      width: measures.width,
      height: measures.height,
      format: measures.format,
    };
    map.set(info.url, info);
    const path = posix.join(folder, `${id.slice(0, 16)}.${measures.format}`);
    const owner = pathOwners.get(path);
    if (owner === undefined) {
      pathOwners.set(path, id);
      map.set(path, info);
    } else {
      log.warn('two staged images share one file name; the first keeps it', {
        path,
        kept: owner,
        skipped: id,
      });
    }
  }
  return Object.fromEntries(map);
}
