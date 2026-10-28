import { describe, expect, it, vi } from 'vitest';
import { previewImageService, wrapService } from './image-service.ts';
import { mediaMetadata } from './media.ts';

const built = {
  src: '/_astro/a.hash.png',
  width: 10,
  height: 10,
  format: 'png' as const,
};

describe('wrapService (D12)', () => {
  const service = {
    getURL: vi.fn(
      async (_options: unknown, _config: unknown) => '/_image?href=optimized',
    ),
    transform: vi.fn(),
    other: 1,
  };
  const wrapped = wrapService(service);

  it('returns the URL of media-map images unchanged, without asking the service of the site', async () => {
    const tagged = mediaMetadata({
      url: 'https://elsewhere.example/x.png',
      width: 5,
      height: 5,
      format: 'png',
    });
    expect(await wrapped.getURL({ src: tagged }, {})).toBe(
      'https://elsewhere.example/x.png',
    );
    expect(service.getURL).not.toHaveBeenCalled();
  });

  it('sends everything else to the service of the site', async () => {
    expect(await wrapped.getURL({ src: built }, { cfg: 1 })).toBe(
      '/_image?href=optimized',
    );
    expect(service.getURL).toHaveBeenCalledWith({ src: built }, { cfg: 1 });
    expect(await wrapped.getURL({ src: 'https://remote/x.png' }, {})).toBe(
      '/_image?href=optimized',
    );
  });

  it('keeps the rest of the service', () => {
    expect(wrapped.transform).toBe(service.transform);
    expect(wrapped.other).toBe(1);
  });
});

describe('previewImageService plugin', () => {
  const plugin = previewImageService({
    wrapperFile: 'C:\\x\\image-service.ts',
  });
  const resolveId = plugin.resolveId as unknown as (
    this: object,
    ...args: unknown[]
  ) => Promise<unknown>;
  const load = plugin.load as unknown as (id: string) => string | undefined;

  it('wraps the service that Astro resolves for the server build', async () => {
    const context = {
      environment: { name: 'ssr' },
      resolve: vi.fn(async () => ({ id: '/site/node_modules/astro/sharp.js' })),
    };
    const id = (await resolveId.call(
      context,
      'virtual:image-service',
      '/x.astro',
      {},
    )) as string;
    const source = load(id)!;
    expect(source).toContain(
      'import service from "/site/node_modules/astro/sharp.js";',
    );
    expect(source).toContain(
      'import { wrapService } from "C:/x/image-service.ts";',
    );
    expect(source).toContain('export default wrapService(service);');
  });

  it('leaves the client build and other ids alone', async () => {
    const context = { environment: { name: 'client' }, resolve: vi.fn() };
    expect(
      await resolveId.call(context, 'virtual:image-service', '/x', {}),
    ).toBeUndefined();
    expect(
      await resolveId.call(
        { environment: { name: 'ssr' }, resolve: vi.fn() },
        './other',
        '/x',
        {},
      ),
    ).toBeUndefined();
    expect(load('/some/file.ts')).toBeUndefined();
  });
});

describe('wrapService details', () => {
  const make = () => {
    const getURL = vi.fn(
      async (_options: unknown, _config: unknown) => 'site-url',
    );
    return { getURL, wrapped: wrapService({ getURL }) };
  };

  it('does not fail when there are no options or no src', async () => {
    const { wrapped, getURL } = make();
    expect(await wrapped.getURL(undefined, 'cfg')).toBe('site-url');
    expect(await wrapped.getURL(null, 'cfg')).toBe('site-url');
    expect(await wrapped.getURL({}, 'cfg')).toBe('site-url');
    expect(getURL).toHaveBeenCalledTimes(3);
    expect(getURL).toHaveBeenLastCalledWith({}, 'cfg');
  });

  it('only a tagged src is bypassed, not an object that merely has a src', async () => {
    const { wrapped, getURL } = make();
    expect(
      await wrapped.getURL(
        { src: { src: '/x.png', width: 1, height: 1, format: 'png' } },
        {},
      ),
    ).toBe('site-url');
    expect(getURL).toHaveBeenCalledTimes(1);
  });

  it('returns the src of the metadata, not the options', async () => {
    const { wrapped } = make();
    const tagged = mediaMetadata({
      url: '/m/b.png',
      width: 1,
      height: 1,
      format: 'png',
    });
    expect(await wrapped.getURL({ src: tagged, width: 100 }, {})).toBe(
      '/m/b.png',
    );
  });
});

describe('previewImageService plugin details', () => {
  const create = (wrapperFile = '/w/image-service.ts') =>
    previewImageService({ wrapperFile });
  const resolveOf = (plugin: ReturnType<typeof create>) =>
    plugin.resolveId as unknown as (
      this: object,
      ...args: unknown[]
    ) => Promise<unknown>;
  const loadOf = (plugin: ReturnType<typeof create>) =>
    plugin.load as unknown as (id: string) => string | undefined;

  it('is a pre-enforced plugin with a name', () => {
    const plugin = create();
    expect(plugin.name).toBe('preview-render-server:image-service');
    expect(plugin.enforce).toBe('pre');
  });

  it('asks for the original with skipSelf and keeps the other options', async () => {
    const plugin = create();
    const resolve = vi.fn(async () => ({ id: '/orig.js' }));
    await resolveOf(plugin).call(
      { environment: { name: 'ssr' }, resolve },
      'virtual:image-service',
      '/imp.astro',
      { ssr: true, scan: false },
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(
      'virtual:image-service',
      '/imp.astro',
      { ssr: true, scan: false, skipSelf: true },
    );
  });

  it('gives an id that load recognizes, with the original after the prefix', async () => {
    const plugin = create();
    const context = {
      environment: { name: 'ssr' },
      resolve: async () => ({ id: '/orig.js' }),
    };
    const id = await resolveOf(plugin).call(
      context,
      'virtual:image-service',
      '/imp',
      {},
    );
    expect(id).toBe('\0preview-image-service:/orig.js');
  });

  it('wraps also when the plugin context has no environment', async () => {
    const plugin = create();
    const context = { resolve: async () => ({ id: '/orig.js' }) };
    expect(
      await resolveOf(plugin).call(
        context,
        'virtual:image-service',
        '/imp',
        {},
      ),
    ).toBe('\0preview-image-service:/orig.js');
  });

  it('wraps for any environment except the client', async () => {
    const plugin = create();
    for (const name of ['ssr', 'prerender', 'server']) {
      const context = {
        environment: { name },
        resolve: async () => ({ id: '/o.js' }),
      };
      expect(
        await resolveOf(plugin).call(
          context,
          'virtual:image-service',
          '/imp',
          {},
        ),
      ).toBe('\0preview-image-service:/o.js');
    }
  });

  it('does not even look for the original in the client build', async () => {
    const plugin = create();
    const resolve = vi.fn(async () => ({ id: '/o.js' }));
    expect(
      await resolveOf(plugin).call(
        { environment: { name: 'client' }, resolve },
        'virtual:image-service',
        '/imp',
        {},
      ),
    ).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does nothing when the original cannot be resolved', async () => {
    const plugin = create();
    const context = { environment: { name: 'ssr' }, resolve: async () => null };
    expect(
      await resolveOf(plugin).call(
        context,
        'virtual:image-service',
        '/imp',
        {},
      ),
    ).toBeUndefined();
  });

  it('only handles the exact virtual id', async () => {
    const plugin = create();
    for (const id of [
      'virtual:image-service2',
      'xvirtual:image-service',
      'virtual:image-services',
      '',
    ]) {
      const resolve = vi.fn(async () => ({ id: '/o.js' }));
      expect(
        await resolveOf(plugin).call(
          { environment: { name: 'ssr' }, resolve },
          id,
          '/imp',
          {},
        ),
      ).toBeUndefined();
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it('builds the wrapper module exactly, with every backslash of the wrapper path replaced', () => {
    const plugin = create('C:\\a\\b\\image-service.ts');
    expect(loadOf(plugin)('\0preview-image-service:/site/o"s.js')).toBe(
      [
        'import service from "/site/o\\"s.js";',
        'import { wrapService } from "C:/a/b/image-service.ts";',
        'export default wrapService(service);',
      ].join('\n'),
    );
  });

  it('only loads ids that start with the prefix', () => {
    const plugin = create();
    expect(loadOf(plugin)('x\0preview-image-service:/o.js')).toBeUndefined();
    expect(loadOf(plugin)('preview-image-service:/o.js')).toBeUndefined();
    expect(loadOf(plugin)('\0preview-image-service')).toBeUndefined();
    expect(loadOf(plugin)('\0preview-image-service:')).toContain(
      'import service from "";',
    );
  });
});
