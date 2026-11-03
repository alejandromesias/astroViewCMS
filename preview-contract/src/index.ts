// The contract between the renderer (preview-render-server) and cms-server:
// the build manifests, schema.json, the render request body and the preview token.
// Depends only on Zod, node:crypto (the token) and preview-protocol (see the
// contract-is-a-leaf rule in .dependency-cruiser.cjs). Parsed at the trust boundary, not cast.

export type { BundleJson } from './bundle.ts';
export { bundleIdPattern, bundleJsonSchema } from './bundle.ts';
export type { RenderRequest, RenderRequestResult } from './envelope.ts';
export { parseRenderRequest, renderRequestSchema } from './envelope.ts';
export type {
  BuildTimeFields,
  DocumentRecord,
  ImageRecord,
  RouteRecord,
} from './manifest.ts';
export {
  documentRecordSchema,
  imageRecordSchema,
  imagesJsonSchema,
  routeRecordSchema,
} from './manifest.ts';
export type { PreviewConfig } from './preview-config.ts';
export { previewConfigSchema } from './preview-config.ts';
export {
  canonicalEntryText,
  revisionOf,
  revisionOfEntry,
  revisionOfKeyedEntry,
} from './revision.ts';
export type { CollectionSchemaJson } from './schema.ts';
export {
  collectionSchemaJson,
  loaderInfoSchema,
  schemaJsonSchema,
} from './schema.ts';
export type {
  MintPreviewTokenOptions,
  PreviewTokenVerdict,
  VerifyPreviewTokenOptions,
} from './token.ts';
export { mintPreviewToken, verifyPreviewToken } from './token.ts';
