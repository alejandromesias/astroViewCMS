// Per-request state of the content overlay (WORKPLAN task 1.4). It lives in
// AsyncLocalStorage, not in a global, so concurrent renders never see each
// other's drafts.
import { AsyncLocalStorage } from 'node:async_hooks';

/** What the editor or the CMS app knows about an image that the bundle
 *  doesn't contain (D12): where it is, and its measures. */
export interface MediaEntry {
  url: string;
  width: number;
  height: number;
  format: string;
}

/** Image reference (a staging URL or a project path) to its entry. */
export type MediaMap = Record<string, MediaEntry>;

export interface OverlayContext {
  /** Document key to its raw value; `null` means the document is removed. JSON
   *  and YAML documents are the raw object, Markdown and MDX ones `{ data, body }`. */
  documents: Record<string, unknown>;
  media: MediaMap;
  /** What the render read, as `collection` (a whole collection),
   *  `collection/id` or `data:<path>`. */
  reads: Set<string>;
  /** Known gaps that applied to this render (`mdx-body`, `schema-refinement`). */
  limits: Set<string>;
  /** Parsed drafts by document key, so one render parses each once. */
  parsed: Map<string, unknown>;
}

const storage = new AsyncLocalStorage<OverlayContext>();

export function createOverlayContext(
  input: { documents?: Record<string, unknown>; media?: MediaMap } = {},
): OverlayContext {
  return {
    documents: input.documents ?? {},
    media: input.media ?? {},
    reads: new Set(),
    limits: new Set(),
    parsed: new Map(),
  };
}

/** Runs `fn` (and everything it awaits) with `context` as the current overlay. */
export function runWithOverlay<T>(context: OverlayContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The overlay of the render in progress; undefined outside a preview render. */
export function currentOverlay(): OverlayContext | undefined {
  return storage.getStore();
}

/** True if the document has an entry in the overlay (also when it is `null`). */
export function hasDocument(context: OverlayContext, key: string): boolean {
  return Object.hasOwn(context.documents, key);
}
