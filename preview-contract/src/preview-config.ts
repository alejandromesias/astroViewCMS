// The answer of GET /__preview/config (PHASE-2-DESIGN 5.7): the editor origins and
// the identity of the bundle that answers (WORKPLAN 2.9b). Not strict: the node may
// add keys later, so an unknown key is dropped rather than refused. The bridge keeps
// its own check of the origins; cms-server's supervisor parses the answer with this.
import { z } from 'zod';

export const previewConfigSchema = z.object({
  editorOrigins: z.array(z.string()),
  // Both are null when the bundle has no bundle.json (a build from before 2.9b).
  bundleId: z.string().nullable(),
  protocolVersion: z.number().int().positive().nullable(),
});

/** The parsed answer of GET /__preview/config. */
export type PreviewConfig = z.infer<typeof previewConfigSchema>;
