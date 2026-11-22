import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import PlainPage from '../../test/fixtures/plain-page.astro';
import SitePage from '../../test/fixtures/site-page.astro';
import { containerSiteOptions } from './site.ts';

describe('containerSiteOptions', () => {
  it('gives the bundle site as the Container astroConfig', () => {
    expect(
      containerSiteOptions({ site: 'https://example.com/' }),
    ).toStrictEqual({ astroConfig: { site: 'https://example.com/' } });
  });

  it.each([
    ['the bundle has no site', { bundleId: 'b1' }],
    ['the site is a number', { site: 42 }],
    ['the site is null', { site: null }],
    ['the site is an object', { site: { href: 'https://example.com/' } }],
    ['there is no bundle', undefined],
    ['the bundle is null', null],
    ['the bundle is a string', 'https://example.com/'],
  ])('gives no options when %s', (_name, bundle) => {
    expect(containerSiteOptions(bundle)).toStrictEqual({});
  });
});

describe('a Container created with the bundle site (real Astro)', () => {
  const request = new Request('http://localhost/blog/one');

  it('renders a page that reads Astro.site, with the site of the bundle', async () => {
    const container = await AstroContainer.create({
      ...containerSiteOptions({ site: 'https://example.com/' }),
    });
    expect(await container.renderToString(SitePage, { request })).toBe(
      '<link rel="canonical" href="https://example.com/blog/one">',
    );
  });

  it('renders a page that does not read Astro.site, when the bundle has no site', async () => {
    const container = await AstroContainer.create({
      ...containerSiteOptions({ bundleId: 'b1' }),
    });
    expect(await container.renderToString(PlainPage, { request })).toBe(
      '<p>No site needed.</p>',
    );
  });

  it('still fails a page that reads Astro.site, when the bundle has no site', async () => {
    const container = await AstroContainer.create({
      ...containerSiteOptions({ bundleId: 'b1' }),
    });
    await expect(
      container.renderToString(SitePage, { request }),
    ).rejects.toThrow(/^Invalid URL$/);
  });
});
