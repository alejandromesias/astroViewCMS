// The postMessage protocol between an editor (parent window) and the bridge
// (preview-render-server/src/client/bridge.ts, inside the previewed page), v2
// (WORKPLAN tasks 1.6, 1.6a), and the shapes of the render route's answers.
// Any editor that speaks it can drive the preview. No dependencies.

/** Bumped when a message changes shape. Carried by `preview:ready` and
 *  `preview:draft`; the render route's answers don't carry it (the route and
 *  the bridge ship in the same bundle). */
export const PROTOCOL_VERSION = 2;

/** What a render could not show (SYSTEM-DESIGN.md D2, D3, D11). Add new
 *  values here so the render route and the editor agree on them. */
export type Limit =
  | 'mdx-body' // an MDX draft shows its saved body (D11)
  | 'schema-refinement' // a schema refinement threw instead of returning false (D3)
  | 'markdown-plugins' // a Markdown plugin failed; the draft rendered without plugins (D2)
  | `code-language:${string}`; // a fence in a language not highlighted until publish (D2)

/** The head data of a rendered page that the bridge patches. */
export interface RenderedHead {
  title?: string;
  meta: Array<Record<string, string>>;
}

/** 200 answer of POST /__preview/render. */
export interface RenderResponse {
  html: string;
  head: RenderedHead;
  /** Keys of the documents the page read. */
  documents: string[];
  limits: Limit[];
  renderMs: number;
}

/** One failing field, in the 422 answers of POST /__preview/render and /__preview/validate. */
export interface FieldError {
  key: string;
  path: (string | number)[];
  message: string;
}

/** 422 answer of POST /__preview/render and /__preview/validate. */
export interface ValidationResponse {
  errors: FieldError[];
}

/** Metadata of an image that is not in the site's bundle (D12). */
export interface MediaInfo {
  url: string;
  width: number;
  height: number;
  format: string;
}

/** editor -> page: the whole overlay, on every change. */
export interface DraftMessage {
  type: 'preview:draft';
  protocol: number;
  /** Document key to its raw value; `null` means deleted in the draft. */
  documents: Record<string, unknown>;
  media: Record<string, MediaInfo>;
}

/** page -> editor */
export type PageMessage =
  | { type: 'preview:ready'; path: string; protocol: number }
  | { type: 'preview:rendered'; path: string; documents: string[]; limits: Limit[]; renderMs: number }
  | { type: 'preview:error'; path: string; status: number; message: string; errors?: FieldError[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Runtime check for what the bridge receives. Only the envelope is checked;
 *  the render route validates the documents and the media entries. */
export function isDraftMessage(data: unknown): data is DraftMessage {
  return isObject(data) && data.type === 'preview:draft' && isObject(data.documents) && isObject(data.media);
}

/** Runtime check for what the editor receives from the bridge. */
export function isPageMessage(data: unknown): data is PageMessage {
  if (!isObject(data) || typeof data.path !== 'string') return false;
  switch (data.type) {
    case 'preview:ready':
      return true;
    case 'preview:rendered':
      return Array.isArray(data.documents) && Array.isArray(data.limits) && typeof data.renderMs === 'number';
    case 'preview:error':
      return typeof data.status === 'number' && typeof data.message === 'string' && (data.errors === undefined || Array.isArray(data.errors));
    default:
      return false;
  }
}

/** Why a message from the other side can't be trusted to mean what we think,
 *  or null when its version matches. A missing `protocol` counts as a
 *  mismatch: it comes from a bundle built before the field existed. The guards
 *  above accept both shapes on purpose, so a mismatch is reported rather than
 *  looking like a preview that never loads. */
export function protocolMismatch(message: { protocol?: unknown }): string | null {
  if (message.protocol === PROTOCOL_VERSION) return null;
  const theirs = message.protocol === undefined ? 'none' : String(message.protocol);
  return `protocol mismatch: this side speaks ${PROTOCOL_VERSION}, the other sent ${theirs}; rebuild the preview bundle or update the editor`;
}
