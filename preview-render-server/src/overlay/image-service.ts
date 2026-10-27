// Media-map images bypass the image optimizer (SYSTEM-DESIGN.md D12). Draft
// images come from the request's media map and are rendered as-is: their URL
// never reaches Astro's `/_image` endpoint, so a URL chosen by whoever sends
// the request can't make the preview node fetch an arbitrary address. The
// site's own image service handles everything else.
import type { Plugin } from 'vite';
import { isMediaMetadata } from './media.ts';

interface ImageServiceLike {
  getURL: (options: any, imageConfig: any) => string | Promise<string>;
  [key: string]: unknown;
}

/** The site's image service, except that `getURL` returns the `src` of
 *  media-map metadata unchanged. */
export function wrapService<T extends ImageServiceLike>(service: T): T {
  return {
    ...service,
    getURL: (options, imageConfig) =>
      isMediaMetadata(options?.src) ? options.src.src : service.getURL(options, imageConfig),
  };
}

const PREFIX = '\0preview-image-service:';

/** Vite plugin: for the server build, `virtual:image-service` (which Astro
 *  resolves to the site's service) becomes a module that wraps that service. */
export function previewImageService({ wrapperFile }: { wrapperFile: string }): Plugin {
  return {
    name: 'preview-render-server:image-service',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (id !== 'virtual:image-service' || this.environment?.name === 'client') return;
      const original = await this.resolve(id, importer, { ...options, skipSelf: true });
      return original ? `${PREFIX}${original.id}` : undefined;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return;
      return [
        `import service from ${JSON.stringify(id.slice(PREFIX.length))};`,
        `import { wrapService } from ${JSON.stringify(wrapperFile.replaceAll('\\', '/'))};`,
        'export default wrapService(service);',
      ].join('\n');
    },
  };
}
