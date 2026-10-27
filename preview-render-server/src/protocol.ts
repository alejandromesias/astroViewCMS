// The postMessage protocol between an editor (parent window) and the bridge
// (src/client/bridge.ts, inside the previewed page). Any editor that speaks
// it can drive the preview.

export type Props = Record<string, unknown>;

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

/** 422 answer of POST /__preview/render and /__preview/validate. */
export interface ValidationResponse {
  errors: Array<{ key: string; path: (string | number)[]; message: string }>;
}

/** editor -> page */
export interface DraftMessage {
  type: 'preview:draft';
  region: string;
  props: Props;
}

/** page -> editor */
export type PageMessage =
  | { type: 'preview:ready'; regions: string[] }
  | { type: 'preview:rendered'; region: string; renderMs: number }
  | { type: 'preview:error'; region: string; status: number; message: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Runtime check for what the bridge receives. Only the shape is checked; the
 *  render route validates the props themselves. */
export function isDraftMessage(data: unknown): data is DraftMessage {
  return isObject(data) && data.type === 'preview:draft' && typeof data.region === 'string';
}

/** Runtime check for what the editor receives from the bridge. */
export function isPageMessage(data: unknown): data is PageMessage {
  if (!isObject(data)) return false;
  switch (data.type) {
    case 'preview:ready':
      return Array.isArray(data.regions);
    case 'preview:rendered':
    case 'preview:error':
      return typeof data.region === 'string';
    default:
      return false;
  }
}
