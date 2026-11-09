// Bundle routes (WORKPLAN 2.4a and 2.4b, PHASE-2-DESIGN 5.9): GET /api/schema, GET /api/documents (a collection
// or one document by key) and GET /api/status. Each one reads the current bundle through the store, and the
// documents' revisions and values from the working copy. No bundle answers 503 (status: 200 with null), and a
// file of the bundle that fails to parse answers 500 with its message, which names the file and the field.
import type { Context, Hono } from 'hono';
import {
  type Bundle,
  BundleError,
  type DocumentEntry,
} from '../bundle/read.ts';
import type { BundleSource } from '../bundle/source.ts';
import { type BundleStore, createBundleStore } from '../bundle/store.ts';
import { type ChangesetRepo, changesetOf } from '../documents/changeset.ts';
import { collectionOf } from '../documents/paths.ts';
import type { FileReads } from '../documents/read.ts';
import {
  type DocumentError,
  errorOf,
  revisionOfDocument,
} from '../documents/revision.ts';
import { GitError } from '../git/exec.ts';
import type { StatusSource } from '../preview/status.ts';

/** One document in the list of GET /api/documents?collection=. `editable` is always a boolean. `revision` is null when the working copy cannot give one, and `error` is set (true) when the document cannot be read. */
interface DocumentListItem {
  key: string;
  file?: string | undefined;
  revision: string | null;
  format: DocumentEntry['format'];
  editable: boolean;
  buildTime: boolean;
  buildTimeFields?: string[] | undefined;
  title?: string;
  error?: true;
}

/** The answer of GET /api/documents?key=. `value` is present for an editable document; `error` when its file does not parse. */
interface DocumentAnswer {
  key: string;
  file: string | undefined;
  value?: unknown;
  revision: string | null;
  format: DocumentEntry['format'];
  editable: boolean;
  buildTime: boolean;
  buildTimeFields?: string[] | undefined;
  error?: DocumentError;
}

/** Registers the bundle routes on `app`. All of them read the bundle through one store; the documents are read from `workingCopy`, the site folder of the working copy. `repo`, when given, lets `GET /api/documents?key=` find a document that a save created (WORKPLAN 2.5c). `status`, when given, adds the preview status to GET /api/status (2.9c). */
export function registerBundleRoutes(
  app: Hono,
  source: BundleSource,
  workingCopy: string,
  repo?: ChangesetRepo,
  status?: StatusSource,
): void {
  const store = createBundleStore(source);

  app.get('/api/schema', (c) =>
    withBundle(c, store, (bundle) =>
      c.json({
        collections: [...bundle.collections].map(([name, entry]) => ({
          name,
          ...entry,
        })),
      }),
    ),
  );

  app.get('/api/documents', (c) =>
    withBundle(c, store, (bundle) =>
      documentsAnswer(c, bundle, workingCopy, repo),
    ),
  );

  // The bundle key is as before; the preview status (when given) is added beside it, with or without a bundle.
  app.get('/api/status', async (c) => {
    const extra = status === undefined ? {} : await status.snapshot();
    return withBundle(
      c,
      store,
      ({ identity }) =>
        c.json({
          bundle: {
            bundleId: identity.bundleId,
            siteCommit: identity.siteCommit,
          },
          ...extra,
        }),
      () => c.json({ bundle: null, ...extra }),
    );
  });
}

/** Runs `answer` on the current bundle. Without one it runs `missing`, which answers 503 unless a route says otherwise. */
export async function withBundle(
  c: Context,
  store: BundleStore,
  answer: (bundle: Bundle) => Response | Promise<Response>,
  missing: () => Response = () => c.json({ error: 'no-bundle' }, 503),
): Promise<Response> {
  try {
    const bundle = await store.current();
    return bundle === null ? missing() : await answer(bundle);
  } catch (error) {
    if (error instanceof BundleError) {
      return c.json({ error: 'bundle-invalid', message: error.message }, 500);
    }
    throw error;
  }
}

/** GET /api/documents: `key` (one document) wins over `collection`, which lists a collection. */
async function documentsAnswer(
  c: Context,
  bundle: Bundle,
  workingCopy: string,
  repo: ChangesetRepo | undefined,
): Promise<Response> {
  const key = c.req.query('key');
  if (key !== undefined)
    return documentAnswer(c, bundle, key, workingCopy, repo);
  const collection = c.req.query('collection');
  if (collection === undefined) {
    return c.json(
      { error: 'missing-query', message: 'Give a collection or a key.' },
      400,
    );
  }
  if (!bundle.collections.has(collection)) {
    return c.json(
      {
        error: 'unknown-collection',
        message: `The bundle has no collection "${collection}".`,
      },
      404,
    );
  }
  // One memo for the request: a file shared by several entries is read once.
  const reads: FileReads = new Map();
  const documents = await Promise.all(
    [...bundle.documents.values()]
      .filter((doc) => collectionOf(doc.key) === collection)
      .map((doc) => listItem(workingCopy, doc, reads)),
  );
  return c.json({ documents });
}

/** GET /api/documents?key=: one document with its revision and, when it is editable, its value. A key the bundle lacks, or a document whose file or entry is gone, is 404. A file that does not parse answers 200 with `error` and no value. */
async function documentAnswer(
  c: Context,
  bundle: Bundle,
  key: string,
  workingCopy: string,
  repo: ChangesetRepo | undefined,
): Promise<Response> {
  let document: DocumentEntry | undefined;
  try {
    document = await documentOf(bundle, key, workingCopy, repo);
  } catch (error: unknown) {
    // The changes could not be read, so the key is not known to be absent: a 404 would say it is.
    if (!(error instanceof GitError)) throw error;
    return c.json(
      { error: 'changes-unavailable', message: error.message },
      500,
    );
  }
  if (document === undefined) {
    return c.json(
      {
        error: 'unknown-document',
        message: `The bundle has no document "${key}".`,
      },
      404,
    );
  }
  // A read-only document (editable false in the manifest) is not parsed, so it has no value.
  const readable = document.editable !== false;
  const facts = await revisionOfDocument(
    workingCopy,
    document,
    new Map(),
    readable,
  );
  if (facts === null) {
    return c.json(
      {
        error: 'document-missing',
        message: `Document "${key}" is missing from the working copy.`,
      },
      404,
    );
  }
  const editable = readable && facts.value !== undefined;
  const answer: DocumentAnswer = {
    key,
    file: document.file,
    revision: facts.revision,
    format: document.format,
    editable,
    buildTime: document.buildTime,
    buildTimeFields: document.buildTimeFields,
    ...(editable ? { value: facts.value } : {}),
    ...(facts.error === undefined ? {} : { error: errorOf(facts.error) }),
  };
  return c.json(answer);
}

/** The entry of a key: the bundle's, or else the one an earlier save created (the changeset's createdRecords, WORKPLAN 2.5c item 6). Undefined when neither has it. */
async function documentOf(
  bundle: Bundle,
  key: string,
  workingCopy: string,
  repo: ChangesetRepo | undefined,
): Promise<DocumentEntry | undefined> {
  const listed = bundle.documents.get(key);
  if (listed !== undefined || repo === undefined) return listed;
  const { createdRecords } = await changesetOf({
    bundle,
    repo,
    siteFolder: workingCopy,
  });
  return createdRecords.find((record) => record.key === key);
}

/** One list item. The revision and error come from the working copy, and a document that cannot be read has no title. Only an editable document is parsed, for its title. */
async function listItem(
  workingCopy: string,
  document: DocumentEntry,
  reads: FileReads,
): Promise<DocumentListItem> {
  const { key, file, format, buildTime, buildTimeFields } = document;
  const editable = document.editable !== false;
  const facts = await revisionOfDocument(
    workingCopy,
    document,
    reads,
    editable,
  );
  const title =
    facts?.value === undefined ? undefined : titleOf(facts.value, format);
  return {
    key,
    file,
    revision: facts === null ? null : facts.revision,
    format,
    editable,
    buildTime,
    buildTimeFields,
    ...(title === undefined ? {} : { title }),
    ...(facts === null || facts.error !== undefined ? { error: true } : {}),
  };
}

/** The title of a document: its `title`, or else its `name`, when it is a string. Markdown and MDX keep their fields under `data`. */
function titleOf(
  value: unknown,
  format: DocumentEntry['format'],
): string | undefined {
  const fields =
    (format === 'md' || format === 'mdx') && isRecord(value)
      ? value.data
      : value;
  if (!isRecord(fields)) return undefined;
  if (typeof fields.title === 'string') return fields.title;
  return typeof fields.name === 'string' ? fields.name : undefined;
}

/** True for a plain object: not null and not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
