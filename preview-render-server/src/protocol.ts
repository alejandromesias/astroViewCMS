// The postMessage protocol between an editor (parent window) and the bridge
// (src/client/bridge.ts, inside the previewed page). Any editor that speaks
// it can drive the preview.

export type Props = Record<string, unknown>;

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
