import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'devalue';
import type { BuildTimeFields, DocumentRecord } from './types.ts';
import type { ProjectScan } from './import-scan.ts';

/** One entry of Astro's content data store (.astro/data-store.json). */
export interface StoreEntry {
  id: string;
  filePath?: string;
}

/** Collection name -> entry id -> entry, as Astro's content layer keeps them. */
export type DataStore = Map<string, Map<string, StoreEntry>>;

/** Loader kinds by collection, from the CMS schema pass. */
export type LoaderKinds = Record<string, 'glob' | 'file' | undefined>;

/** Reads Astro's data store, which a build writes to `<root>/.astro/`. A site
 *  without content collections has none: that is an empty store. */
export function readDataStore(root: string): DataStore {
  const file = path.join(root, '.astro', 'data-store.json');
  if (!fs.existsSync(file)) return new Map();
  const store = parse(fs.readFileSync(file, 'utf8')) as Map<string, Map<string, StoreEntry> | unknown>;
  // `meta::meta` holds Astro's own bookkeeping, not documents.
  return new Map([...store].filter(([name]) => !name.includes('::')) as [string, Map<string, StoreEntry>][]);
}

/** Shapes documents.json: every content entry (D5, D10) and every JSON data
 *  module, with the build-time flags of D1. Pure: no file access. */
export function shapeDocuments({
  store,
  loaderKinds,
  scan,
  buildTimeFields = {},
}: {
  store: DataStore;
  loaderKinds: LoaderKinds;
  scan: ProjectScan;
  buildTimeFields?: BuildTimeFields;
}): DocumentRecord[] {
  const documents: DocumentRecord[] = [];
  const buildTime = (key: string, scanned: boolean): Pick<DocumentRecord, 'buildTime' | 'buildTimeFields'> => {
    // A flagged file without a list counts as all build-time (D1); an entry
    // in buildTimeFields flags a document the scan missed.
    const fields = buildTimeFields[key] ?? (scanned ? ['*'] : undefined);
    return fields ? { buildTime: true, buildTimeFields: fields } : { buildTime: false };
  };

  for (const [collection, entries] of [...store].sort(([a], [b]) => a.localeCompare(b))) {
    for (const entry of [...entries.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const key = `${collection}/${entry.id}`;
      documents.push({
        key,
        ...(entry.filePath ? { file: toPosix(entry.filePath) } : {}),
        format: formatOf(entry.filePath),
        ...(loaderKinds[collection] === 'file' ? { entryKey: entry.id } : {}),
        ...buildTime(key, false),
      });
    }
  }

  const scanned = new Set(scan.buildTimeFiles.map((file) => `data:${file}`));
  const dataKeys = new Set([...scan.dataModules.map((file) => `data:${file}`), ...scanned]);
  // A buildTimeFields entry for a data file the scan didn't see adds it too.
  for (const key of Object.keys(buildTimeFields)) if (key.startsWith('data:')) dataKeys.add(key);
  for (const key of [...dataKeys].sort()) {
    const file = key.slice('data:'.length);
    documents.push({ key, file, format: formatOf(file), ...buildTime(key, scanned.has(key)) });
  }
  return documents;
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
