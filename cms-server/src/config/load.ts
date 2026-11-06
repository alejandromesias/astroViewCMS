// Loads a site's `cms.config.ts` (PHASE-2-DESIGN 5.10). The file's default export is the config.
import { pathToFileURL } from 'node:url';
import { type CmsConfig, parseConfig } from './schema.ts';

/** Imports the config file and parses its default export. Rejects with a `ZodError` if it is invalid. */
export async function loadConfig(path: string): Promise<CmsConfig> {
  // A dynamic import is always a module namespace object, so `.default` is the only check needed:
  // it is undefined when the file has no default export, and parseConfig refuses that.
  const loaded: { default?: unknown } = await import(pathToFileURL(path).href);
  return parseConfig(loaded.default);
}
