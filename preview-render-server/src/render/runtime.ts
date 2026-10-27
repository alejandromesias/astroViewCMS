// Binds the render handlers to the running preview build: the page modules,
// the manifests next to the bundle, the Container with the site's renderers
// and the content shim's validate. Imports virtual modules, so only the build
// can load it; the logic worth testing is in handlers.ts and render-page.ts.
import fs from 'node:fs';
import path from 'node:path';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { manifest } from 'virtual:astro:manifest';
import { renderers } from 'virtual:astro:renderers';
import { manifestDir, pages, urlRules } from 'virtual:preview-site';
import type { DocumentRecord, RouteRecord } from '../manifest/types.ts';
import { validate } from '../overlay/content-shim.ts';
import type { HandlerDeps } from './handlers.ts';
import { renderPage } from './render-page.ts';
import type { PageModule } from './render-page.ts';
import { islandResolver } from './islands.ts';

// Written by the build before the server starts and never changed after.
const cache = new Map<string, unknown>();
function readManifest<T>(name: string): T | undefined {
  if (!cache.has(name)) {
    const file = path.join(manifestDir, name);
    cache.set(name, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined);
  }
  return cache.get(name) as T | undefined;
}

// One container for the process, with the renderers the site's integrations
// registered (React, MDX, ...): without them hydrated components fail with
// NoMatchingRenderer. `resolve` points the islands at the built chunks (D6).
// Renders don't share state.
let container: Promise<AstroContainer> | undefined;
const resolve = islandResolver(manifest.entryModules, urlRules.base);
const getContainer = () => (container ??= AstroContainer.create({ renderers: renderers as never, resolve: async (specifier) => resolve(specifier) }));

export const deps: HandlerDeps = {
  renderPage: async (url) => {
    const routes = readManifest<RouteRecord[]>('routes.json') ?? [];
    const containerInstance = await getContainer();
    return renderPage(
      {
        routes,
        rules: urlRules,
        loadPage: (route) => pages['/' + route.component]?.() as Promise<PageModule> | undefined,
        renderToString: (component, options) => containerInstance.renderToString(component as never, options),
      },
      url,
    );
  },
  validate,
  builtDocuments: () => readManifest<DocumentRecord[]>('documents.json'),
};
