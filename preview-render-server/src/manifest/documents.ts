import fs from 'node:fs';
import path from 'node:path';
import { canonicalEntryText, revisionOf } from 'preview-contract';
import { parse } from 'devalue';
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
 *  by the canonical form of its own data, so editing one entry of a shared file
 *  leaves the other entries' revisions alone. Reads the files under `root`. */
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
    const text =
      document.entryKey !== undefined || document.file === undefined
        ? canonicalEntryText(entries.get(document.key)?.data)
        : fs.readFileSync(path.join(root, document.file));
    return { ...document, revision: revisionOf(text) };
  });
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
