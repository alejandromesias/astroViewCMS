// The contract between the renderer (preview-render-server) and cms-server:
// the build manifests, schema.json and the render request body. Depends only on
// Zod and preview-protocol (see the contract-is-a-leaf rule in
// .dependency-cruiser.cjs). Parsed at the trust boundary, not cast.

export type {
  BuildTimeFields,
  DocumentRecord,
  RouteRecord,
} from './manifest.ts';
export { documentRecordSchema, routeRecordSchema } from './manifest.ts';
export type { CollectionSchemaJson } from './schema.ts';
export {
  collectionSchemaJson,
  loaderInfoSchema,
  schemaJsonSchema,
} from './schema.ts';
export type { RenderRequest, RenderRequestResult } from './envelope.ts';
export { parseRenderRequest, renderRequestSchema } from './envelope.ts';
