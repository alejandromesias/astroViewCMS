// The rewrite of staged images (WORKPLAN 2.7b step 1, PHASE-2-DESIGN 5.3 and 5.5). Before planning, each `image` field
// whose value is a staging URL gets the path of its future file, relative to the file that holds the document (D5), and
// the copy from the staging folder is listed in `ctx.copies`. The stage only reads: the copy is made by the write stage,
// after validation. `ctx.changes` is reassigned to a new list, so the delete guard's view stays what the client sent.
// Keys and values come from content, so the stage uses Maps, never a plain object lookup.
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { collectionOf } from '../documents/paths.ts';
import { holdingFileOfCreate } from '../documents/plan-write.ts';
import { errorCode } from '../fs/atomic.ts';
import type { Measures } from '../media/measure.ts';
import { readMedia } from '../media/metadata.ts';
import { readStaged, stagedFormat } from '../media/staging.ts';
import { walkMarkers } from '../schema/walk.ts';
import type { SaveChange } from './body.ts';
import type { SaveContext, SaveStage, SaveStop } from './context.ts';
import { dataOf, isMarkdownDocument } from './markdown.ts';
import { schemaOf } from './warnings.ts';

/** The code of an image whose upload is not in `media.json`, or whose staged file is gone. */
const STAGED_IMAGE_MISSING = 'staged-image-missing';
/** The code of an image whose name in the media folder holds other bytes. */
const MEDIA_COLLISION = 'media-collision';

/** The length of the image name: `revisionOf`, the first 16 hex characters of the sha256 (WORKPLAN 2.7b). */
const NAME_LENGTH = 16;

type PathSegment = string | number;

/** One refusal, in the shape of a FieldError with a code. */
interface ImageError {
  readonly key: string;
  readonly path: readonly PathSegment[];
  readonly message: string;
  readonly code: string;
}

/** What one run of the stage shares. */
interface State {
  readonly ctx: SaveContext;
  /** The staging URL prefix: `${origins.cms}/media/staging/`. */
  readonly prefix: string;
  /** The entries of media.json, read on the first staged image. */
  entries: Promise<Map<string, Measures>> | undefined;
  /** The bytes of each staged file read so far, by file name. Undefined when there is none. */
  readonly staged: Map<string, Promise<Buffer<ArrayBuffer> | undefined>>;
  /** The copies to make: the site-relative target, and the absolute staging path it comes from. */
  readonly copies: Map<string, string>;
  readonly errors: ImageError[];
}

/**
 * The rewrite stage. Answers 422 for a staged image that is gone or whose name holds other bytes; otherwise it
 * replaces the staging URLs in `ctx.changes` with relative paths and adds the copies to `ctx.copies`.
 */
export const rewriteStagedImages: SaveStage = async (ctx) => {
  const state: State = {
    ctx,
    prefix: `${ctx.media.cmsOrigin}/media/staging/`,
    entries: undefined,
    staged: new Map(),
    copies: new Map(),
    errors: [],
  };
  const changes: SaveChange[] = [];
  for (const change of ctx.changes)
    changes.push(await rewriteChange(change, state));
  if (state.errors.length > 0) return refusal(state.errors);
  ctx.changes = changes;
  if (state.copies.size > 0)
    ctx.copies = [
      ...ctx.copies,
      ...[...state.copies].map(([to, from]) => ({ from, to })),
    ];
  return undefined;
};

function refusal(errors: readonly ImageError[]): SaveStop {
  return { status: 422, body: { error: 'invalid', errors } };
}

/** The change with its staged image values rewritten, or the same change when it has none. */
async function rewriteChange(
  change: SaveChange,
  state: State,
): Promise<SaveChange> {
  if (change.deleted) return change;
  const hits = stagedHitsOf(change, state);
  if (hits.length === 0) return change;
  const holding = holdingFileOf(change, state.ctx);
  // A document the planner cannot place is refused by planChanges, with its own code.
  if (holding === undefined) return change;
  let data = change.data;
  for (const hit of hits) {
    const ref = await refOf(change.document, hit, holding, state);
    if (ref !== undefined) data = withValueAt(data, hit.path, ref);
  }
  return { ...change, data };
}

/** A staged image field: where it is in `change.data`, and its staging URL. */
interface StagedHit {
  readonly path: readonly PathSegment[];
  readonly url: string;
}

/**
 * The `image` fields of the change that hold a staging URL. A Markdown document is walked by its `data`, and its paths
 * start with `data`, as in `change.data`. A document with no schema has no image fields. A schema that cannot be walked
 * is logged and skipped, so that it never fails the save (as in warnings.ts).
 */
function stagedHitsOf(change: SaveChange, state: State): StagedHit[] {
  const { ctx, prefix } = state;
  if (change.document.startsWith('data:')) return [];
  const schema = schemaOf(change.document, ctx);
  if (schema === undefined) return [];
  const markdown = isMarkdownDocument(change.document, ctx);
  const root = markdown ? dataOf(change.data) : change.data;
  const hits: StagedHit[] = [];
  try {
    walkMarkers(schema, root, (hit) => {
      if (
        hit.marker === 'image' &&
        typeof hit.value === 'string' &&
        hit.value.startsWith(prefix)
      )
        hits.push({
          path: markdown ? ['data', ...hit.path] : hit.path,
          url: hit.value,
        });
    });
  } catch (error) {
    ctx.log.warn(
      'the staged images of a document are skipped: its schema cannot be walked',
      {
        document: change.document,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
    return [];
  }
  return hits;
}

/**
 * The file that holds the document, relative to the site: the document's own file for an update, and the file that
 * planWrite would pick for a create. Undefined when the planner will refuse the change.
 */
function holdingFileOf(
  change: SaveChange,
  ctx: SaveContext,
): string | undefined {
  const known = ctx.documents.get(change.document);
  if (known !== undefined) return known.file;
  if (change.baseRevision !== null) return undefined;
  const collection = collectionOf(change.document);
  if (collection === undefined) return undefined;
  return holdingFileOfCreate(
    collection,
    change.document.slice(collection.length + 1),
    { collections: ctx.bundle.collections, config: ctx.config },
  );
}

/**
 * The relative path for one staged image, and the copy it needs. Undefined when the image is refused: the error is
 * recorded.
 */
async function refOf(
  key: string,
  hit: StagedHit,
  holding: string,
  state: State,
): Promise<string | undefined> {
  const { ctx } = state;
  const name = hit.url.slice(state.prefix.length);
  const format = stagedFormat(name);
  const id = name.slice(0, 64);
  const bytes =
    format === undefined || !(await entriesOf(state)).has(id)
      ? undefined
      : await stagedBytes(state, name);
  if (format === undefined || bytes === undefined) {
    state.errors.push({
      key,
      path: hit.path,
      message: 'The uploaded image is not available any more. Upload it again.',
      code: STAGED_IMAGE_MISSING,
    });
    return undefined;
  }
  const to = posix.join(
    ctx.config.media.folder,
    `${id.slice(0, NAME_LENGTH)}.${format}`,
  );
  const from = join(ctx.media.stagingDir, name);
  if (!(await isUsable(state, to, from, bytes))) {
    state.errors.push({
      key,
      path: hit.path,
      message: `Another image is already saved as "${to}". Pick a different image.`,
      code: MEDIA_COLLISION,
    });
    return undefined;
  }
  return relativeRef(holding, to);
}

/**
 * Whether the name `to` can take the staged bytes. A name already planned in this save must come from the same staged
 * file. A file on disk must hold the same bytes, and is then listed for the commit with no copy. Otherwise the copy is
 * planned.
 */
async function isUsable(
  state: State,
  to: string,
  from: string,
  bytes: Buffer,
): Promise<boolean> {
  const planned = state.copies.get(to);
  if (planned !== undefined) return planned === from;
  const existing = await readIfExists(join(state.ctx.siteFolder, to));
  if (existing !== undefined && !existing.equals(bytes)) return false;
  // A reused file is listed too, so the commit holds it even when it is untracked. The write stage copies nothing
  // for it (the bytes are the same).
  state.copies.set(to, from);
  return true;
}

/** The path from the folder of `holding` to `to`, both relative to the site: `../../assets/x.png` or `./x.png`. */
function relativeRef(holding: string, to: string): string {
  const ref = posix.relative(posix.dirname(holding), to);
  return ref.startsWith('../') ? ref : `./${ref}`;
}

function entriesOf(state: State): Promise<Map<string, Measures>> {
  state.entries ??= readMedia(state.ctx.media.mediaFile);
  return state.entries;
}

function stagedBytes(
  state: State,
  name: string,
): Promise<Buffer<ArrayBuffer> | undefined> {
  let bytes = state.staged.get(name);
  if (bytes === undefined) {
    bytes = readStaged(state.ctx.media.stagingDir, name);
    state.staged.set(name, bytes);
  }
  return bytes;
}

/** The bytes of a file, or undefined when it does not exist. */
async function readIfExists(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * A copy of `root` with `value` at `path`; the objects and arrays along the path are copied, nothing is changed in
 * place. Keys come from content, so an object is rebuilt with Object.fromEntries.
 */
function withValueAt(
  root: unknown,
  path: readonly PathSegment[],
  value: string,
): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  if (Array.isArray(root))
    return root.map((item: unknown, index) =>
      index === head ? withValueAt(item, rest, value) : item,
    );
  if (typeof root === 'object' && root !== null)
    return Object.fromEntries(
      Object.entries(root).map(([key, item]) => [
        key,
        key === head ? withValueAt(item, rest, value) : item,
      ]),
    );
  return root;
}
