// Maps a document's format (the `format` of its DocumentRecord in documents.json) to the codec that reads
// and writes it (PHASE-2-DESIGN 5.4). Markdown and MDX share one codec, because both values are
// `{ data, body }` (D2). TOML and anything else have no codec: callers must handle `null`, and treat the
// document as read-only (D13).
import type { DocumentRecord } from 'preview-contract';
import { markdownCodec } from './frontmatter.ts';
import { jsonCodec } from './json.ts';
import type { Codec } from './types.ts';
import { yamlCodec } from './yaml.ts';

/** The codec for a document's format, or `null` when the CMS cannot read or write that format. */
export function codecFor(format: DocumentRecord['format']): Codec | null {
  switch (format) {
    case 'json':
      return jsonCodec;
    case 'yaml':
      return yamlCodec;
    case 'md':
    case 'mdx':
      return markdownCodec;
    case 'toml':
    case 'other':
      return null;
  }
}
