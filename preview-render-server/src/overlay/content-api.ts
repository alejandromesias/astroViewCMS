// The `astro:content` API as site code sees it in a preview build: the real
// module's data with the request's draft overlay applied (SYSTEM-DESIGN.md
// D2, D3, D4, D5, D10). Built as a factory so tests can hand it fakes; the
// binding to the real module is content-shim.ts.
import posix from 'node:path/posix';
import type { ImageMetadata } from 'astro';
import type { CollectionInfo, SchemaHooks } from '../schema/stubs-flavor2.ts';
import { currentOverlay, hasDocument } from './context.ts';
import { reviveDates } from './dates.ts';
import type { OverlayContext } from './context.ts';
import { DraftError } from './errors.ts';
import type { FieldIssue } from './errors.ts';
import { DATA_PREFIX, entryKey, splitKey } from './keys.ts';
import { mediaMetadata } from './media.ts';

/** Marks entries built from a draft; `render()` needs to tell them apart. */
export const DRAFT = Symbol.for('preview-render-server.draft');

/** One field of one document that the schema rejects (the validate route's answer). */
export interface ValidationError extends FieldIssue {
  key: string;
}

export interface DraftInfo {
  /** The file extension of the document that holds the draft (`md`, `json`, ...). */
  extension: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Astro's entry types depend on the site's collections */
export interface RealContent {
  getCollection(collection: string, filter?: (entry: any) => unknown): Promise<any[]>;
  getEntry(...args: any[]): Promise<any>;
  render(entry: any): Promise<any>;
}

export interface ContentApiDeps {
  real: RealContent;
  /** The site's collections compiled with the flavor 2 stubs (D3). */
  collections: Record<string, CollectionInfo> | undefined;
  /** Every image in the bundle, by project path. */
  images: Record<string, ImageMetadata>;
  /** The stubs' hooks; the API fills them in. */
  hooks: SchemaHooks;
  /** Renders a Markdown draft's body (D2). Without it, such drafts render empty. */
  renderMarkdown?: (entry: any) => Promise<any>;
  /** What a draft MDX body renders when there is nothing saved to show. */
  emptyContent: () => any;
}

const BODY_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);

export function createContentApi(deps: ContentApiDeps) {
  const { real, collections, images, hooks } = deps;

  // Set around each synchronous schema parse, for the image hook (D5).
  let parsingFile = '';

  // Ids of the built entries per collection: reference() checks need them
  // synchronously, so they are loaded before a parse. Built data never changes.
  let builtIdsPromise: Promise<Map<string, Set<string>>> | undefined;
  const builtIds = () =>
    (builtIdsPromise ??= (async () => {
      const index = new Map<string, Set<string>>();
      for (const name of Object.keys(collections ?? {})) {
        index.set(name, new Set((await real.getCollection(name)).map((entry) => entry.id)));
      }
      return index;
    })());

  // Called right before a synchronous parse, with no await in between, so
  // concurrent renders can't swap the hooks under each other.
  function setHooks(context: OverlayContext, index: Map<string, Set<string>>) {
    hooks.referenceExists = (collection, id) => {
      const key = entryKey(collection, id);
      if (hasDocument(context, key)) return context.documents[key] !== null;
      return index.get(collection)?.has(id) ?? false;
    };
    hooks.resolveImage = (ref) => resolveImage(context, ref);
  }

  function resolveImage(context: OverlayContext, ref: string): ImageMetadata | undefined {
    // D5: relative to the folder of the file that holds the document.
    const projectPath = posix.normalize(posix.join(posix.dirname(parsingFile), ref));
    const built = images[projectPath] ?? images[posix.normalize(ref)];
    if (built) return built;
    // D12: images added since the bundle, from the request's media map.
    const entry = context.media[ref] ?? context.media[projectPath];
    return entry ? mediaMetadata(entry) : undefined;
  }

  /** The file that holds a document: the built entry's, or where a new one
   *  would be written (the loader's base, or its single file). */
  function holdingFile(collection: string, id: string, built?: { filePath?: string }): string {
    if (built?.filePath) return built.filePath.replaceAll('\\', '/');
    const loader = collections?.[collection]?.loader;
    if (loader?.kind === 'file') return loader.pattern;
    const extension = /\*\.(?:\{([^}]*)\}|([a-z0-9]+))/.exec(loader?.pattern ?? '');
    const first = (extension?.[1]?.split(',')[0] ?? extension?.[2] ?? 'json').trim();
    return posix.join(loader?.base ?? '', `${id}.${first}`);
  }

  /** Parses a draft with the site's schema (flavor 2): defaults, coercion,
   *  transforms, image and reference resolution. */
  async function buildEntry(context: OverlayContext, collection: string, id: string, raw: any, built?: any) {
    const key = entryKey(collection, id);
    const cached = context.parsed.get(key);
    if (cached) return cached;

    const file = holdingFile(collection, id, built);
    const extension = posix.extname(file).slice(1).toLowerCase();
    const hasBody = BODY_EXTENSIONS.has(extension);
    let rawData = hasBody ? (raw?.data ?? {}) : raw;
    const body: string | undefined = hasBody ? String(raw?.body ?? '') : undefined;

    const schema = collections?.[collection]?.schema;
    let data = rawData;
    if (schema) {
      const index = await builtIds();
      setHooks(context, index);
      parsingFile = file;
      try {
        let result = schema.safeParse(rawData);
        // Plain z.date() fields get ISO strings from JSON: revive and retry (D13).
        for (let round = 0; !result.success && round < 5; round++) {
          const revived = reviveDates(rawData, result.error.issues);
          if (!revived) break;
          rawData = revived;
          result = schema.safeParse(rawData);
        }
        if (!result.success) {
          const issues: FieldIssue[] = result.error.issues.map((issue) => ({
            path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
            message: issue.message,
          }));
          throw new DraftError(key, issues);
        }
        data = result.data;
      } catch (error) {
        if (error instanceof DraftError) throw error;
        // A refinement or transform that throws instead of returning false (D3).
        context.limits.add('schema-refinement');
        throw new DraftError(key, [{ path: [], message: (error as Error).message }]);
      } finally {
        parsingFile = '';
      }
    }

    const entry = {
      id,
      collection,
      data,
      ...(body === undefined ? {} : { body }),
      filePath: file,
      digest: 'preview-draft',
      [DRAFT]: { extension } satisfies DraftInfo,
    };
    context.parsed.set(key, entry);
    return entry;
  }

  async function getCollection(collection: string, filter?: (entry: any) => unknown) {
    const context = currentOverlay();
    context?.reads.add(collection);
    const touched = context ? Object.keys(context.documents).filter((key) => splitKey(key)?.collection === collection) : [];
    if (!context || touched.length === 0) return real.getCollection(collection, filter);

    const result: any[] = [];
    const seen = new Set<string>();
    for (const built of await real.getCollection(collection)) {
      const key = entryKey(collection, built.id);
      seen.add(key);
      if (!hasDocument(context, key)) result.push(built);
      else if (context.documents[key] !== null) result.push(await buildEntry(context, collection, built.id, context.documents[key], built));
    }
    for (const key of touched) {
      if (seen.has(key) || context.documents[key] === null) continue;
      result.push(await buildEntry(context, collection, splitKey(key)!.id, context.documents[key]));
    }
    return filter ? result.filter(filter) : result;
  }

  /** `getEntry(collection, id)` and `getEntry({ collection, id })`. */
  async function getEntry(...args: any[]) {
    const [first, second] = args;
    const ref = typeof first === 'string' ? { collection: first, id: second } : first;
    const context = currentOverlay();
    if (!ref || ref.id === undefined) return real.getEntry(...args);
    const key = entryKey(ref.collection, ref.id);
    context?.reads.add(key);
    if (!context || !hasDocument(context, key)) return real.getEntry(...args);
    const raw = context.documents[key];
    if (raw === null) return undefined;
    return buildEntry(context, ref.collection, ref.id, raw, await real.getEntry(ref.collection, ref.id));
  }

  /** One result per reference, in order, `undefined` for a missing one (as Astro does). */
  async function getEntries(refs: any[]) {
    return Promise.all(refs.map((ref) => getEntry(ref)));
  }

  async function render(entry: any) {
    const draft: DraftInfo | undefined = entry?.[DRAFT];
    if (!draft) return real.render(entry);
    if (draft.extension === 'mdx') {
      // D11: MDX bodies aren't compiled at run time. Show the saved body.
      currentOverlay()?.limits.add('mdx-body');
      const saved = await real.getEntry(entry.collection, entry.id);
      return saved ? real.render(saved) : { Content: deps.emptyContent(), headings: [], remarkPluginFrontmatter: {} };
    }
    if (deps.renderMarkdown) return deps.renderMarkdown(entry);
    return { Content: deps.emptyContent(), headings: [], remarkPluginFrontmatter: {} };
  }

  /** Parses every content document of the overlay with the site's schema and
   *  returns what fails, one item per field. Renders nothing (D3). */
  async function validate(context: OverlayContext): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    for (const [key, raw] of Object.entries(context.documents)) {
      // Removed documents and data files have nothing to parse.
      if (raw === null || key.startsWith(DATA_PREFIX)) continue;
      const split = splitKey(key);
      if (!split) {
        errors.push({ key, path: [], message: 'Not a document key (expected "collection/id" or "data:<path>")' });
      } else if (collections && !collections[split.collection]) {
        errors.push({ key, path: [], message: `Unknown collection "${split.collection}"` });
      } else {
        try {
          await buildEntry(context, split.collection, split.id, raw, await real.getEntry(split.collection, split.id));
        } catch (error) {
          if (error instanceof DraftError) errors.push(...error.issues.map((issue) => ({ key, ...issue })));
          else throw error;
        }
      }
    }
    return errors;
  }

  return { getCollection, getEntry, getEntries, render, validate };
}
