// The module that stands in for `astro:content` in the site's own code in
// preview builds (see plugins.ts for the import rewrite). Everything the real
// module exports stays; the read functions go through the request's overlay.
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js';
import * as real from 'astro:content';
import { cmsCollections, images } from 'virtual:preview-site';
import { hooks } from '../schema/stubs-flavor2.ts';
import { createContentApi } from './content-api.ts';
import { markdown } from './markdown-instance.ts';

export * from 'astro:content';

const api = createContentApi({
  real: real as never,
  collections: cmsCollections,
  images,
  hooks,
  renderMarkdown: markdown,
  emptyContent: () => createComponent(() => renderTemplate``),
});

export const getCollection = api.getCollection;
export const getEntry = api.getEntry;
export const getEntries = api.getEntries;
export const render = api.render;
export const validate = api.validate;
