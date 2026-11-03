// Loads a site's `cms.config.ts` (PHASE-2-DESIGN 5.10). The file's default export is the config.
import { pathToFileURL } from 'node:url';
import { type CmsConfig, parseConfig } from './schema.ts';

/** Imports the config file and parses its default export. Rejects with a `ZodError` if it is invalid. */
export async function loadConfig(path: string): Promise<CmsConfig> {
  const loaded: unknown = await import(pathToFileURL(path).href);
  return parseConfig(defaultExport(loaded));
}

function defaultExport(loaded: unknown): unknown {
  return typeof loaded === 'object' && loaded !== null && 'default' in loaded
    ? loaded.default
    : undefined;
}
