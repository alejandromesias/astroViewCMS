// Document discovery (SYSTEM-DESIGN.md section 3): the render answers with the
// documents the page read, so the editor knows which forms belong to it.
import type { DocumentRecord } from '../manifest/types.ts';

/** `reads` holds `collection` (a whole collection), `collection/id` and
 *  `data:<path>`. A whole-collection read stands for every document in it:
 *  the built ones (documents.json) and the overlay's, except removed ones. */
export function discoveredDocuments(
  reads: Iterable<string>,
  built: DocumentRecord[] | undefined,
  overlay: Record<string, unknown>,
): string[] {
  const found = new Set<string>();
  for (const read of reads) {
    if (read.startsWith('data:') || read.includes('/')) {
      found.add(read);
      continue;
    }
    const prefix = `${read}/`;
    for (const doc of built ?? []) if (doc.key.startsWith(prefix) && overlay[doc.key] !== null) found.add(doc.key);
    for (const [key, value] of Object.entries(overlay)) if (key.startsWith(prefix) && value !== null) found.add(key);
  }
  return [...found].sort();
}
