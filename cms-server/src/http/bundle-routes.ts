// Bundle routes (WORKPLAN 2.4a, PHASE-2-DESIGN 5.9): GET /api/schema, GET /api/documents and GET /api/status.
// Each one reads the current bundle through the store. No bundle answers 503 (status: 200 with null), and a
// file that fails to parse answers 500 with its message, which names the file and the field.
import type { Context, Hono } from 'hono';
import {
  type Bundle,
  BundleError,
  type DocumentEntry,
} from '../bundle/read.ts';
import type { BundleSource } from '../bundle/source.ts';
import { type BundleStore, createBundleStore } from '../bundle/store.ts';

/** One document in the list of GET /api/documents?collection=. `editable` is always a boolean; the record leaves it out when true. */
interface DocumentListItem {
  key: string;
  file?: string | undefined;
  revision: string;
  format: DocumentEntry['format'];
  editable: boolean;
  buildTime: boolean;
  buildTimeFields?: string[] | undefined;
}

/** Registers the bundle routes on `app`. All of them read the bundle through one store. */
export function registerBundleRoutes(app: Hono, source: BundleSource): void {
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
    withBundle(c, store, (bundle) => documentsAnswer(c, bundle)),
  );

  app.get('/api/status', (c) =>
    withBundle(
      c,
      store,
      ({ identity }) =>
        c.json({
          bundle: {
            bundleId: identity.bundleId,
            siteCommit: identity.siteCommit,
          },
        }),
      () => c.json({ bundle: null }),
    ),
  );
}

/** Runs `answer` on the current bundle. Without one it runs `missing`, which answers 503 unless a route says otherwise. */
async function withBundle(
  c: Context,
  store: BundleStore,
  answer: (bundle: Bundle) => Response,
  missing: () => Response = () => c.json({ error: 'no-bundle' }, 503),
): Promise<Response> {
  try {
    const bundle = await store.current();
    return bundle === null ? missing() : answer(bundle);
  } catch (error) {
    if (error instanceof BundleError) {
      return c.json({ error: 'bundle-invalid', message: error.message }, 500);
    }
    throw error;
  }
}

/** GET /api/documents: `collection` lists a collection; `key` (one document) answers 501 until 2.4b and wins over `collection`. */
function documentsAnswer(c: Context, bundle: Bundle): Response {
  if (c.req.query('key') !== undefined) {
    return c.json(
      {
        error: 'not-implemented',
        message: 'Reading one document by key is not built yet.',
      },
      501,
    );
  }
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
  const documents = [...bundle.documents.values()]
    .filter((doc) => collectionOf(doc.key) === collection)
    .map(listItem);
  return c.json({ documents });
}

/** The collection a document key belongs to: the part before the first slash (D10). A key with no slash is in none. */
function collectionOf(key: string): string | undefined {
  const slash = key.indexOf('/');
  return slash === -1 ? undefined : key.slice(0, slash);
}

function listItem({
  key,
  file,
  revision,
  format,
  editable,
  buildTime,
  buildTimeFields,
}: DocumentEntry): DocumentListItem {
  return {
    key,
    file,
    revision,
    format,
    editable: editable !== false,
    buildTime,
    buildTimeFields,
  };
}
