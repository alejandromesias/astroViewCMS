// Shapes of the build manifests (WORKPLAN task 1.3), written to
// <outDir>/manifest/ inside the bundle. The shapes live in the contract
// package (step 2.0a); this file re-exports them so imports don't churn.
export type {
  BuildTimeFields,
  DocumentRecord,
  RouteRecord,
} from 'preview-contract';
