// The pieces that more than one route answer shares (PHASE-2-DESIGN 5.9). Zod only, so the editor can import the
// contract without pulling a server module. The bundle and render shapes of preview-contract are mirrored here, not
// imported: preview-contract pulls in node:crypto. A test in cms-server checks that the mirrors match it.
import { z } from 'zod';

/** A segment of a path into a document: a key or an index. */
export const pathSegmentSchema = z.union([z.string(), z.number()]);

/** The formats a document can have (the bundle's DocumentRecord). */
export const documentFormatSchema = z.enum([
  'json',
  'md',
  'mdx',
  'yaml',
  'toml',
  'other',
]);

/** A failure to read or check a document. `code` names the failure; `line` and `column` locate it when known. */
export const documentErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
});

/** One document of the bundle as the working copy's changes and listings carry it (DocumentRecord, preview-contract). */
export const documentEntrySchema = z.object({
  key: z.string(),
  file: z.string().optional(),
  format: documentFormatSchema,
  editable: z.literal(false).optional(),
  entryKey: z.string().optional(),
  buildTime: z.boolean(),
  buildTimeFields: z.array(z.string()).optional(),
  revision: z.string(),
});

/** A document that a publish moved, as the re-apply reports it. */
export const renamedDocumentSchema = z.object({
  key: z.string(),
  from: z.string(),
  to: z.string(),
});

/** The metadata of an image that is not in the site's bundle (the editor's MediaInfo). */
export const mediaInfoSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
  format: z.string(),
});

/** The image formats the CMS accepts (media/measure.ts). */
export const mediaFormatSchema = z.enum(['png', 'jpg', 'webp', 'avif', 'gif']);

/** One failing field of a save or a publish: the document, the path inside it, and the message. `code` is set by the image rewrite. */
export const validationIssueSchema = z.object({
  key: z.string(),
  path: z.array(pathSegmentSchema).readonly(),
  message: z.string(),
  code: z.string().optional(),
});

/** One document of a 409 `conflict`: its revision in the working copy now, and its value when it can be read. */
export const conflictingDocumentSchema = z.object({
  key: z.string(),
  revision: z.string().nullable(),
  value: z.unknown().optional(),
});

/** One document of a 409 `conflict` (see conflictingDocumentSchema). */
export type ConflictingDocument = z.infer<typeof conflictingDocumentSchema>;

/** A refusal of one write plan (documents/plan-write.ts): the key, the message, and the position of the problem when known. */
export const planRefusalFieldsSchema = z.object({
  key: z.string(),
  message: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
});
