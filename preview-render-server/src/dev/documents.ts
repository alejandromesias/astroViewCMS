// GET /__dev/documents?key=<document key>: the raw value of one document, read
// from the site's working copy. STOPGAP (WORKPLAN task 1.7) for the CMS app's
// `GET /api/documents?key=` (phase 2), and a stated exception to D13's "the
// preview node never parses file text": the test editor needs the raw value
// (D2, D13), which Astro's data store no longer has (images are placeholders,
// dates are Dates, `data:` files aren't in it). Local dev only: it is injected
// when the build runs with PREVIEW_DEV=1. Remove it with the stopgap.
import { parse } from 'yaml';
import type { DocumentRecord } from '../manifest/types.ts';
import { methodNotAllowed, rejectCrossSite } from '../request-guard.ts';

export interface DevDocumentsDeps {
  /** documents.json, if the build wrote it. */
  documents: () => DocumentRecord[] | undefined;
  /** Text of a site file (path relative to the site root), undefined if it can't be read. */
  readFile: (file: string) => string | undefined;
}

/** Answer of the route: the shape of the future `GET /api/documents?key=`
 *  (design section 3, minus `revision`) plus the build-time flags. `value` is
 *  absent for documents that aren't editable. */
export interface DevDocument {
  key: string;
  file: string;
  format: DocumentRecord['format'];
  editable?: false;
  buildTime: boolean;
  buildTimeFields?: string[];
  value?: unknown;
}

/** YAML as Astro reads it: merge keys (`<<: *anchor`) are expanded, so the
 *  editor shows the same document the build did. Dates stay as text. */
const parseYaml = (text: string): unknown => parse(text, { merge: true });

const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

/** `{ data, body }` of a Markdown or MDX file: the YAML between the `---`
 *  fences and the text after them. A file without fences is all body. */
export function splitFrontmatter(text: string): { data: unknown; body: string } {
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {}, body: text };
  return { data: (match[1] === undefined ? undefined : parseYaml(match[1])) ?? {}, body: match[2]!.replace(/^(?:\r?\n)+/, '') };
}

/** The document's raw value (D2): the parsed object for JSON and YAML, the
 *  entry at `entryKey` for a `file()` entry, `{ data, body }` for Markdown and
 *  MDX. */
export function parseDocument(text: string, record: Pick<DocumentRecord, 'format' | 'entryKey'>): unknown {
  switch (record.format) {
    case 'md':
    case 'mdx':
      return splitFrontmatter(text);
    case 'json':
    case 'yaml': {
      const parsed: unknown = record.format === 'json' ? JSON.parse(text) : parseYaml(text);
      return record.entryKey === undefined ? parsed : entryOf(parsed, record.entryKey);
    }
    default:
      throw new Error(`Cannot read a ${record.format} document`);
  }
}

/** An entry of a `file()` file: an array of objects with an `id`, or an object
 *  keyed by id. */
function entryOf(parsed: unknown, id: string): unknown {
  const entry = Array.isArray(parsed)
    ? parsed.find((item) => {
        const itemId = typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : undefined;
        return itemId !== undefined && String(itemId) === id;
      })
    : typeof parsed === 'object' && parsed !== null && Object.hasOwn(parsed, id)
      ? (parsed as Record<string, unknown>)[id]
      : undefined;
  if (entry === undefined) throw new Error(`No entry "${id}" in the file`);
  return entry;
}

/** 200 with the document, 400 without a key, 404 for a key the build doesn't
 *  list or a file that is gone, 500 for a file that doesn't parse. */
export function handleDocument(request: Request, deps: DevDocumentsDeps): Response {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const rejection = rejectCrossSite(request);
  if (rejection) return rejection;

  const key = new URL(request.url).searchParams.get('key');
  if (!key) return new Response('Missing ?key=', { status: 400 });
  const record = deps.documents()?.find((doc) => doc.key === key);
  if (!record?.file) return new Response(`Unknown document "${key}"`, { status: 404 });

  const answer: DevDocument = {
    key,
    file: record.file,
    format: record.format,
    ...(record.editable === false ? { editable: false as const } : {}),
    buildTime: record.buildTime,
    ...(record.buildTimeFields ? { buildTimeFields: record.buildTimeFields } : {}),
  };
  // Read-only formats (D13) are listed without a value: the preview shows them as built.
  if (record.editable === false) return Response.json(answer);

  const text = deps.readFile(record.file);
  if (text === undefined) return new Response(`File not found: ${record.file}`, { status: 404 });
  try {
    return Response.json({ ...answer, value: parseDocument(text, record) });
  } catch (error) {
    return new Response(`Cannot parse ${record.file}: ${(error as Error).message}`, { status: 500 });
  }
}
