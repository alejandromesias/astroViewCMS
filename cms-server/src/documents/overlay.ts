// The overlay of GET /api/overlay (WORKPLAN 2.9e, PHASE-2-DESIGN 5.9): what the working copy changes against the bundle, in
// the render request's shape (preview-contract's RenderRequest), so the editor sends it to the render route unconverted.
// A document is compared by revision with the bundle's documents.json, and a document the CMS created (the changeset's
// createdRecords) is added. A document with no value to give (not editable, or a file that does not parse) is left out,
// so the preview keeps its bundle version rather than a broken one. Keys come from content: the documents object is built
// with Object.fromEntries, never by assignment.
import type { RenderRequest } from 'preview-contract';
import type { Bundle, DocumentEntry } from '../bundle/read.ts';
import type { Logger } from '../log.ts';
import type { MediaFiles } from '../save/context.ts';
import { mediaMapOf } from '../save/validate.ts';
import { type ChangesetRepo, changesetOf } from './changeset.ts';
import type { FileReads } from './read.ts';
import { revisionOfDocument } from './revision.ts';

/** What the overlay reads: the bundle, the repo and the working copy, the media files, and the folder of the site's images. */
interface OverlayInput {
  readonly bundle: Bundle;
  readonly repo: ChangesetRepo;
  /** The site folder of the working copy, where the files of the documents are. */
  readonly siteFolder: string;
  readonly media: MediaFiles;
  /** config.media.folder: a saved image's project path starts with it. */
  readonly mediaFolder: string;
  readonly log: Logger;
}

/**
 * The render request of the working copy's changes. `documents` holds each changed document's value by key, and null for
 * a document the bundle has that the working copy no longer does. `media` holds the staged images that the bundle's
 * images.json lacks, under their staging URL and their project path (mediaMapOf).
 */
export async function overlayOf(input: OverlayInput): Promise<RenderRequest> {
  const { bundle, repo, siteFolder, media, mediaFolder, log } = input;
  const { createdRecords } = await changesetOf({ bundle, repo, siteFolder });
  // One memo for the request: a file shared by several entries is read once.
  const reads: FileReads = new Map();
  const entries: [string, unknown][] = [];
  for (const document of bundle.documents.values()) {
    const entry = await overlayEntry(
      siteFolder,
      document,
      reads,
      document.revision,
    );
    if (entry !== undefined) entries.push(entry);
  }
  for (const record of createdRecords) {
    const entry = await overlayEntry(siteFolder, record, reads, undefined);
    if (entry !== undefined) entries.push(entry);
  }
  // An image whose 16-character name the bundle's images.json holds is in the bundle already (revisionOf is that name).
  const bundled = new Set(bundle.images.map((image) => image.hash));
  return {
    documents: Object.fromEntries(entries),
    media: await mediaMapOf(
      media,
      mediaFolder,
      log,
      (name) => !bundled.has(name),
    ),
  };
}

/**
 * The overlay entry of one document, or undefined when the overlay leaves it out. `bundled` is the revision the bundle
 * holds, or undefined for a document the bundle lacks. A document whose file or entry is gone is null. A document with
 * no file has nothing in the working copy to compare, so it is left out, not taken for a deleted one.
 */
async function overlayEntry(
  siteFolder: string,
  document: DocumentEntry,
  reads: FileReads,
  bundled: string | undefined,
): Promise<[string, unknown] | undefined> {
  if (document.file === undefined) return undefined;
  // A read-only document (editable false) is not parsed, so it has no value and is left out when it changed.
  const facts = await revisionOfDocument(
    siteFolder,
    document,
    reads,
    document.editable !== false,
  );
  if (facts === null) return [document.key, null];
  if (facts.revision === bundled || facts.value === undefined) return undefined;
  return [document.key, facts.value];
}
