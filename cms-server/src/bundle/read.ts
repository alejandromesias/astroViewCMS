// Reads and parses the files of one bundle folder (WORKPLAN 2.4a, PHASE-2-DESIGN 5.2). Each file goes
// through its contract schema at the trust boundary, so a missing key or a wrong type is refused with
// the file and the field named. Nothing is cast.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BundleJson,
  type CollectionSchemaJson,
  documentRecordSchema,
  type ImageRecord,
  imagesJsonSchema,
  type RouteRecord,
  routeRecordSchema,
  schemaJsonSchema,
} from 'preview-contract';
import { z } from 'zod';

/** One document record as the schema parses it. Its optional keys may hold `undefined`, which the
 *  DocumentRecord interface does not allow under exactOptionalPropertyTypes. */
export type DocumentEntry = z.infer<typeof documentRecordSchema>;

/** The files of a bundle folder. bundle.json names the bundle; the other four are its contents. */
export type BundleFile =
  | 'bundle.json'
  | 'documents.json'
  | 'schema.json'
  | 'routes.json'
  | 'images.json';

/** One bundle, all five files parsed. Documents are keyed by document key in a Map, since keys come from content. */
export interface Bundle {
  readonly identity: BundleJson;
  readonly documents: ReadonlyMap<string, DocumentEntry>;
  readonly collections: ReadonlyMap<string, CollectionSchemaJson>;
  readonly routes: readonly RouteRecord[];
  readonly images: readonly ImageRecord[];
}

/** A bundle file that is missing, unreadable or invalid. The message names the file and, when there is one, the field. */
export class BundleError extends Error {
  readonly file: BundleFile;

  constructor(file: BundleFile, detail: string, field = '') {
    super(`${file}${field === '' ? '' : ` at ${field}`}: ${detail}`);
    this.name = 'BundleError';
    this.file = file;
  }
}

/** Reads one file that may be absent. Resolves with null when the file does not exist. */
export async function readOptionalFile<T>(
  dir: string,
  file: BundleFile,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const text = await readText(dir, file);
  return text === null ? null : parseText(file, schema, text);
}

/** Reads one file that must exist. A missing file is a BundleError. */
async function readRequiredFile<T>(
  dir: string,
  file: BundleFile,
  schema: z.ZodType<T>,
): Promise<T> {
  const text = await readText(dir, file);
  if (text === null) throw new BundleError(file, 'is missing');
  return parseText(file, schema, text);
}

/** Reads the four files that follow bundle.json. Each one is parsed in turn, so the first failure names its file. */
export async function readBundle(
  dir: string,
  identity: BundleJson,
): Promise<Bundle> {
  const documents = await readRequiredFile(
    dir,
    'documents.json',
    z.array(documentRecordSchema),
  );
  const collections = await readRequiredFile(
    dir,
    'schema.json',
    schemaJsonSchema,
  );
  const routes = await readRequiredFile(
    dir,
    'routes.json',
    z.array(routeRecordSchema),
  );
  const images = await readRequiredFile(dir, 'images.json', imagesJsonSchema);
  return {
    identity,
    documents: documentsByKey(documents),
    collections: new Map(Object.entries(collections)),
    routes,
    images,
  };
}

async function readText(dir: string, file: BundleFile): Promise<string | null> {
  try {
    return await readFile(join(dir, file), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw new BundleError(file, `cannot be read: ${String(error)}`);
  }
}

function parseText<T>(file: BundleFile, schema: z.ZodType<T>, text: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BundleError(file, 'is not valid JSON');
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new BundleError(
    file,
    issue?.message ?? 'is invalid',
    fieldOf(issue?.path ?? []),
  );
}

/** A Zod path as a field name: `[2].revision`, or `site.name` for a nested key. */
function fieldOf(path: readonly PropertyKey[]): string {
  return path.reduce<string>((field, segment) => {
    if (typeof segment === 'number') return `${field}[${segment}]`;
    return field === '' ? String(segment) : `${field}.${String(segment)}`;
  }, '');
}

/** Builds the Map of documents. A key that appears twice is refused, not overwritten. */
function documentsByKey(
  records: readonly DocumentEntry[],
): Map<string, DocumentEntry> {
  const byKey = new Map<string, DocumentEntry>();
  for (const [index, record] of records.entries()) {
    if (byKey.has(record.key)) {
      throw new BundleError(
        'documents.json',
        `duplicate key "${record.key}"`,
        `[${index}].key`,
      );
    }
    byKey.set(record.key, record);
  }
  return byKey;
}
