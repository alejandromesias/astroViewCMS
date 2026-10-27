import { describe, expect, it, vi } from 'vitest';
import { previewImageService, wrapService } from './image-service.ts';
import { mediaMetadata } from './media.ts';

const built = { src: '/_astro/a.hash.png', width: 10, height: 10, format: 'png' as const };

describe('wrapService (D12)', () => {
  const service = { getURL: vi.fn(async (_options: unknown, _config: unknown) => '/_image?href=optimized'), transform: vi.fn(), other: 1 };
  const wrapped = wrapService(service);

  it('returns the URL of media-map images unchanged, without asking the service of the site', async () => {
    const tagged = mediaMetadata({ url: 'https://elsewhere.example/x.png', width: 5, height: 5, format: 'png' });
    expect(await wrapped.getURL({ src: tagged }, {})).toBe('https://elsewhere.example/x.png');
    expect(service.getURL).not.toHaveBeenCalled();
  });

  it('sends everything else to the service of the site', async () => {
    expect(await wrapped.getURL({ src: built }, { cfg: 1 })).toBe('/_image?href=optimized');
    expect(service.getURL).toHaveBeenCalledWith({ src: built }, { cfg: 1 });
    expect(await wrapped.getURL({ src: 'https://remote/x.png' }, {})).toBe('/_image?href=optimized');
  });

  it('keeps the rest of the service', () => {
    expect(wrapped.transform).toBe(service.transform);
    expect(wrapped.other).toBe(1);
  });
});

describe('previewImageService plugin', () => {
  const plugin = previewImageService({ wrapperFile: 'C:\\x\\image-service.ts' });
  const resolveId = plugin.resolveId as unknown as (this: object, ...args: unknown[]) => Promise<unknown>;
  const load = plugin.load as unknown as (id: string) => string | undefined;

  it('wraps the service that Astro resolves for the server build', async () => {
    const context = { environment: { name: 'ssr' }, resolve: vi.fn(async () => ({ id: '/site/node_modules/astro/sharp.js' })) };
    const id = (await resolveId.call(context, 'virtual:image-service', '/x.astro', {})) as string;
    const source = load(id)!;
    expect(source).toContain('import service from "/site/node_modules/astro/sharp.js";');
    expect(source).toContain('import { wrapService } from "C:/x/image-service.ts";');
    expect(source).toContain('export default wrapService(service);');
  });

  it('leaves the client build and other ids alone', async () => {
    const context = { environment: { name: 'client' }, resolve: vi.fn() };
    expect(await resolveId.call(context, 'virtual:image-service', '/x', {})).toBeUndefined();
    expect(await resolveId.call({ environment: { name: 'ssr' }, resolve: vi.fn() }, './other', '/x', {})).toBeUndefined();
    expect(load('/some/file.ts')).toBeUndefined();
  });
});
