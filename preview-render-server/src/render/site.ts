// The Astro `site` of the running bundle (WORKPLAN 2.14a-1, F6). A layout that
// reads Astro.site, such as the stock BaseHead that builds its canonical URL
// from it, throws "Invalid URL" in a Container without a site. The build writes
// the site's `site` into bundle.json when the site sets one; runtime.ts passes it
// to AstroContainer.create through these options.
import type { AstroContainerOptions } from 'astro/container';

/** The options that give a Container the bundle's site: `{ astroConfig: { site } }`
 *  when the parsed bundle.json has a string `site`, and `{}` otherwise, so an
 *  unset site keeps the Container as it was. The build writes a string or nothing,
 *  so any other value counts as absent. `{}` rather than `{ site: undefined }`,
 *  because exactOptionalPropertyTypes refuses an explicit undefined. */
export function containerSiteOptions(
  bundle: unknown,
): Pick<AstroContainerOptions, 'astroConfig'> {
  if (typeof bundle !== 'object' || bundle === null || !('site' in bundle))
    return {};
  return typeof bundle.site === 'string'
    ? { astroConfig: { site: bundle.site } }
    : {};
}
