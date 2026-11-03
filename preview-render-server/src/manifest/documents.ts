import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'devalue';
import {
  canonicalEntryText,
  revisionOf,
  revisionOfEntry,
  revisionOfKeyedEntry,
} from 'preview-contract';
import { parseDocument } from 'yaml';
import type { ProjectScan } from './import-scan.ts';
import type { BuildTimeFields, DocumentRecord } from './types.ts';

/** One entry of Astro's content data store (.astro/data-store.json). */
interface StoreEntry {
  id: string;
  filePath?: string;
  /** The entry's parsed data, after the collection's schema ran. */
  data?: unknown;
}

/** A document before its revision is added (withRevisions). */
type DocumentDraft = Omit<DocumentRecord, 'revision'>;

/** Collection name -> entry id -> entry, as Astro's content layer keeps them. */
export type DataStore = Map<string, Map<string, StoreEntry>>;

/** Loader kinds by collection, from the CMS schema pass. */
export type LoaderKinds = Record<string, 'glob' | 'file' | undefined>;

/** Reads Astro's data store, which a build writes to its `cacheDir` (by
 *  default `<root>/node_modules/.astro/`; only dev uses `<root>/.astro/`). A
 *  site without content collections has none: that is an empty store. */
export function readDataStore(cacheDir: string): DataStore {
  const file = path.join(cacheDir, 'data-store.json');
  if (!fs.existsSync(file)) return new Map();
  const store = parse(fs.readFileSync(file, 'utf8')) as Map<
    string,
    Map<string, StoreEntry> | unknown
  >;
  // `meta::meta` holds Astro's own bookkeeping, not documents.
  return new Map(
    [...store].filter(([name]) => !name.includes('::')) as [
      string,
      Map<string, StoreEntry>,
    ][],
  );
}

/** Shapes documents.json: every content entry (D5, D10) and every JSON data
 *  module, with the build-time flags of D1. Pure: no file access. */
export function shapeDocuments({
  store,
  loaderKinds,
  scan,
  buildTimeFields = {},
  readOnlyCollections = [],
}: {
  store: DataStore;
  loaderKinds: LoaderKinds;
  scan: ProjectScan;
  buildTimeFields?: BuildTimeFields;
  readOnlyCollections?: string[];
}): DocumentDraft[] {
  const readOnly = new Set(readOnlyCollections);
  const documents: DocumentDraft[] = [];
  const buildTime = (
    key: string,
    scanned: boolean,
  ): Pick<DocumentRecord, 'buildTime' | 'buildTimeFields'> => {
    // A flagged file without a list counts as all build-time (D1); an entry
    // in buildTimeFields flags a document the scan missed.
    const fields = buildTimeFields[key] ?? (scanned ? ['*'] : undefined);
    return fields
      ? { buildTime: true, buildTimeFields: fields }
      : { buildTime: false };
  };

  for (const [collection, entries] of [...store].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const entry of [...entries.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const key = `${collection}/${entry.id}`;
      documents.push({
        key,
        ...(entry.filePath ? { file: toPosix(entry.filePath) } : {}),
        format: formatOf(entry.filePath),
        ...(loaderKinds[collection] === 'file' ? { entryKey: entry.id } : {}),
        ...(readOnly.has(collection) ? { editable: false as const } : {}),
        ...buildTime(key, false),
      });
    }
  }

  const scanned = new Set(scan.buildTimeFiles.map((file) => `data:${file}`));
  const dataKeys = new Set([
    ...scan.dataModules.map((file) => `data:${file}`),
    ...scanned,
  ]);
  // A buildTimeFields entry for a data file the scan didn't see adds it too.
  for (const key of Object.keys(buildTimeFields))
    if (key.startsWith('data:')) dataKeys.add(key);
  for (const key of [...dataKeys].sort()) {
    const file = key.slice('data:'.length);
    documents.push({
      key,
      file,
      format: formatOf(file),
      ...buildTime(key, scanned.has(key)),
    });
  }
  // D13: only these formats can be edited.
  return documents.map((doc) =>
    doc.format === 'toml' || doc.format === 'other'
      ? { ...doc, editable: false }
      : doc,
  );
}

/** Adds each document's `revision` (WORKPLAN 2.0c, design 5.3). A document with
 *  a file of its own is hashed by the file's bytes. A `file()` entry is hashed
 *  by its raw value, read from the file as Astro's loader reads it and without
 *  the schema (revisionOfEntry, WORKPLAN 2.4b), so editing one entry of a
 *  shared file leaves the other entries' revisions alone and a schema default
 *  never moves a revision. The store's data is used only for a document with
 *  no file. Reads the files under `root`. */
export function withRevisions(
  documents: DocumentDraft[],
  store: DataStore,
  root: string,
): DocumentRecord[] {
  const entries = new Map<string, StoreEntry>();
  for (const [collection, list] of store) {
    for (const entry of list.values()) {
      entries.set(`${collection}/${entry.id}`, entry);
    }
  }
  return documents.map((document) => {
    const revision =
      document.file === undefined
        ? revisionOf(canonicalEntryText(entries.get(document.key)?.data))
        : document.entryKey !== undefined
          ? fileEntryRevision(root, document.file, document.entryKey)
          : revisionOf(fs.readFileSync(path.join(root, document.file)));
    return { ...document, revision };
  });
}

/** The revision of one entry of a `file()` document, parsed as Astro's loader parses the file: JSON with
 *  JSON.parse, YAML with the options of Astro's `parseYaml`. An array item is hashed without its id
 *  (revisionOfEntry); a value of an object-keyed file whole (revisionOfKeyedEntry), as its key is the id.
 *  Throws when the file, the format or the entry is missing, so the build says which one. */
function fileEntryRevision(
  root: string,
  file: string,
  entryKey: string,
): string {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const extension = path.extname(file).toLowerCase();
  let whole: unknown;
  if (extension === '.json') whole = JSON.parse(text);
  else if (extension === '.yaml' || extension === '.yml')
    whole = parseYamlAsAstro(text);
  else throw new Error(`${file}: a file() entry must be JSON or YAML`);
  const entry = findEntry(whole, entryKey);
  if (entry === undefined)
    throw new Error(`${file} has no entry '${entryKey}'`);
  return Array.isArray(whole)
    ? revisionOfEntry(entry)
    : revisionOfKeyedEntry(entry);
}

/** YAML as Astro's loader reads it (`parseYaml` in @astrojs/internal-helpers): unquoted dates
 *  are Date objects, `<<` merge keys are expanded, the core schema otherwise. cms-server's yaml
 *  codec uses the same options; the two must not drift. */
function parseYamlAsAstro(text: string): unknown {
  const document = parseDocument(text, {
    customTags: ['timestamp'],
    merge: true,
    schema: 'core',
  });
  if (document.errors.length > 0) throw document.errors[0];
  if (document.contents === null) return undefined;
  return document.toJS();
}

/** The entry with this id: in an array, the object whose `id` (or `slug`) names it, as Astro
 *  takes it; in an object, the value under that key. */
function findEntry(whole: unknown, entryKey: string): unknown {
  if (Array.isArray(whole))
    return whole.find((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false;
      const raw =
        (item as Record<string, unknown>).id ??
        (item as Record<string, unknown>).slug;
      return raw !== undefined && raw !== null && String(raw) === entryKey;
    });
  if (
    typeof whole === 'object' &&
    whole !== null &&
    Object.hasOwn(whole, entryKey)
  )
    return (whole as Record<string, unknown>)[entryKey];
  return undefined;
}

function formatOf(file: string | undefined): DocumentRecord['format'] {
  switch (path.extname(file ?? '').toLowerCase()) {
    case '.json':
      return 'json';
    case '.md':
    case '.markdown':
      return 'md';
    case '.mdx':
      return 'mdx';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.toml':
      return 'toml';
    default:
      return 'other';
  }
}

function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}
