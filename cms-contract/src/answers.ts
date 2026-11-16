// The 200 and 201 answers of the CMS API (PHASE-2-DESIGN 5.9). One schema per route; the error answers are in errors.ts.
import { z } from 'zod';
import {
  documentEntrySchema,
  documentErrorSchema,
  documentFormatSchema,
  mediaFormatSchema,
  mediaInfoSchema,
  pathSegmentSchema,
  renamedDocumentSchema,
} from './shapes.ts';

// GET /api/schema: the collections of the bundle, each with its name beside its schema.json entry.
const loaderInfoSchema = z.object({
  kind: z.enum(['glob', 'file']),
  pattern: z.string(),
  base: z.string().optional(),
  customId: z.literal(true).optional(),
});

export const schemaAnswerSchema = z.object({
  collections: z
    .array(
      z.object({
        name: z.string(),
        loader: loaderInfoSchema.optional(),
        schema: z.record(z.string(), z.unknown()).optional(),
        error: z.string().optional(),
        readOnly: z.boolean().optional(),
      }),
    )
    .readonly(),
});

export type SchemaBody = z.infer<typeof schemaAnswerSchema>;

// GET /api/documents?collection=: the list items.
export const documentListItemSchema = z.object({
  key: z.string(),
  file: z.string().optional(),
  revision: z.string().nullable(),
  format: documentFormatSchema,
  editable: z.boolean(),
  buildTime: z.boolean(),
  buildTimeFields: z.array(z.string()).readonly().optional(),
  title: z.string().optional(),
  error: z.literal(true).optional(),
});

export const documentListAnswerSchema = z.object({
  documents: z.array(documentListItemSchema).readonly(),
});

export type DocumentListBody = z.infer<typeof documentListAnswerSchema>;
export type DocumentListItem = z.infer<typeof documentListItemSchema>;

// GET /api/documents?key=: one document, with its value when it is editable.
export const documentAnswerSchema = z.object({
  key: z.string(),
  file: z.string().optional(),
  value: z.unknown().optional(),
  revision: z.string().nullable(),
  format: documentFormatSchema,
  editable: z.boolean(),
  buildTime: z.boolean(),
  buildTimeFields: z.array(z.string()).readonly().optional(),
  error: documentErrorSchema.optional(),
});

export type DocumentBody = z.infer<typeof documentAnswerSchema>;

// GET /api/status: the bundle, and beside it the preview status (preview/status.ts). Without a status source only `bundle`.
export const publishStateSchema = z.enum(['idle', 'publishing', 'failed']);

export const statusBodySchema = z.object({
  builder: z.enum(['on', 'off']),
  build: z.object({
    state: z.enum(['off', 'idle', 'building', 'failed']),
    error: z.string().nullable(),
    failedCommit: z.string().nullable(),
  }),
  node: z.object({
    state: z.enum(['stopped', 'starting', 'ready', 'restarting', 'failed']),
    bundleId: z.string().nullable(),
    error: z.string().nullable(),
  }),
  lastSync: z.string().nullable(),
  syncError: z.string().nullable(),
  renamed: z.array(renamedDocumentSchema).readonly(),
  changesetSize: z.number().nullable(),
  publish: z.object({
    state: publishStateSchema,
    error: z.string().nullable(),
  }),
  errors: z.object({
    protocolMismatch: z.string().nullable(),
    upstreamBuildFailed: z.string().nullable(),
    swap: z.string().nullable(),
  }),
});

export type StatusBody = z.infer<typeof statusBodySchema>;

export const statusAnswerSchema = statusBodySchema.partial().extend({
  bundle: z
    .object({
      bundleId: z.string(),
      siteCommit: z.string().nullable(),
    })
    .nullable(),
});

export type StatusAnswerBody = z.infer<typeof statusAnswerSchema>;

// GET /api/changes: the documents that differ from the merge base, the documents cms/work created, and the broken shared files.
export const changedDocumentSchema = z.object({
  key: z.string(),
  status: z.enum(['created', 'modified', 'deleted']),
  baseRevision: z.string().nullable(),
  value: z.unknown().optional(),
  overwritten: z.string().optional(),
  error: documentErrorSchema.optional(),
});

export type ChangedDocument = z.infer<typeof changedDocumentSchema>;

export const changesAnswerSchema = z.object({
  documents: z.array(changedDocumentSchema).readonly(),
  createdRecords: z.array(documentEntrySchema).readonly(),
  fileErrors: z
    .array(z.object({ path: z.string(), error: documentErrorSchema }))
    .readonly(),
});

export type ChangesBody = z.infer<typeof changesAnswerSchema>;

// PUT /api/changes, 200: the revisions after the commit, the warnings (never blocking) and whether a rebuild was asked.
export const saveWarningSchema = z.object({
  key: z.string(),
  path: z.array(pathSegmentSchema).readonly(),
  code: z.string(),
});

export const saveAnswerSchema = z.object({
  revisions: z.record(z.string(), z.string()),
  warnings: z.array(saveWarningSchema).readonly(),
  rebuild: z.boolean(),
});

export type SaveBody = z.infer<typeof saveAnswerSchema>;
export type SaveWarning = z.infer<typeof saveWarningSchema>;

// GET /api/overlay: the working copy against the bundle, in the render request's shape (preview-contract's RenderRequest).
export const overlayAnswerSchema = z.object({
  documents: z.record(z.string(), z.unknown()),
  media: z.record(z.string(), mediaInfoSchema),
});

export type OverlayBody = z.infer<typeof overlayAnswerSchema>;

// GET /api/preview-url: the iframe URL with a fresh token, and the preview origin.
export const previewUrlAnswerSchema = z.object({
  url: z.string(),
  origin: z.string(),
});

export type PreviewUrlBody = z.infer<typeof previewUrlAnswerSchema>;

// POST /api/publish, 200. `commit` is null when nothing differed from upstream. `buildCheckSkipped` is set when the build
// check was skipped because the upstream code does not build (decision U1).
export const publishAnswerSchema = z.object({
  commit: z.string().nullable(),
  overwritten: z
    .array(z.object({ key: z.string(), commit: z.string() }))
    .readonly(),
  renamed: z.array(renamedDocumentSchema).readonly(),
  buildCheckSkipped: z.literal('upstream-broken').optional(),
});

export type PublishBody = z.infer<typeof publishAnswerSchema>;

// POST /api/media, 201: the staged image, its id, its URL on the CMS origin and its measures.
export const mediaAnswerSchema = z.object({
  id: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  format: mediaFormatSchema,
});

export type MediaBody = z.infer<typeof mediaAnswerSchema>;
