// The Markdown-format helpers of the save stages (WORKPLAN 2.10c, moved from delete-guard.ts and warnings.ts, which each had
// a copy). A document whose format is md or mdx holds `{ data, body }`, and the stages that read its values look at `data`
// only. The format of a create is the one the planner gives its new file. Keys come from content, so the lookups use Maps
// and Sets, and the collections' config is read with Object.hasOwn.
import { collectionOf, formatOfExtension } from '../documents/paths.ts';
import type { SaveContext } from './context.ts';

/** What the format helpers read from a save: the documents it sees, the bundle's collections, and the config's formats. */
type MarkdownInput = Pick<SaveContext, 'bundle' | 'documents' | 'config'>;

/** The formats whose value is `{ data, body }`. */
const MARKDOWN: ReadonlySet<string> = new Set(['md', 'mdx']);

/**
 * Whether the document `key` holds Markdown values (`{ data, body }`). A document the bundle or an earlier save holds has
 * its format, unless it is one entry of a shared file (a raw value). A create has the format its new file gets (see
 * `createdFormatOf`).
 */
export function isMarkdownDocument(key: string, ctx: MarkdownInput): boolean {
  const known = ctx.documents.get(key);
  if (known !== undefined)
    return MARKDOWN.has(known.format) && known.entryKey === undefined;
  const format = createdFormatOf(key, ctx);
  return format !== undefined && MARKDOWN.has(format);
}

/** The `data` of a Markdown value. A value with no `data` has no fields to read, so it gives undefined. */
export function dataOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'data' in value
    ? value.data
    : undefined;
}

/**
 * The format a create of `key` gets from the planner: the collection's `newEntryFormat`, or else the first extension of
 * its glob pattern (plan-write's rule). Undefined for a collection without a glob loader, which the planner refuses.
 */
function createdFormatOf(key: string, ctx: MarkdownInput): string | undefined {
  const collection = collectionOf(key);
  if (collection === undefined) return undefined;
  const loader = ctx.bundle.collections.get(collection)?.loader;
  if (loader?.kind !== 'glob') return undefined;
  const configured = Object.hasOwn(ctx.config.collections, collection)
    ? ctx.config.collections[collection]?.newEntryFormat
    : undefined;
  const extension = configured ?? extensionOfPattern(loader.pattern);
  return extension === undefined ? undefined : formatOfExtension(extension);
}

/** The extension a glob names first: `md` for `*.{md,mdx}`, `json` for `*.json`. Undefined when the pattern names none. */
function extensionOfPattern(pattern: string): string | undefined {
  const brace = /\.\{([^}]*)\}$/.exec(pattern);
  if (brace !== null) return brace[1]?.split(',')[0];
  return /\.([A-Za-z0-9]+)$/.exec(pattern)?.[1];
}
