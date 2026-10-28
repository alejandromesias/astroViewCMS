// Hydrated components (D6): the container writes `component-url` and
// `renderer-url` as source specifiers (`@/components/PricingPlans`,
// `@astrojs/react/client.js`). A page needs the built chunks, as the
// prerendered page has them, and Astro's server manifest maps one to the
// other. An empty entry means "no such script" (e.g. before-hydration) and
// stays empty, so Astro leaves the attribute out.

export function islandResolver(entryModules: Record<string, string>, base: string): (specifier: string) => string {
  const prefix = base.replace(/\/+$/, '');
  return (specifier) => {
    if (!Object.hasOwn(entryModules, specifier)) return specifier;
    const file = entryModules[specifier];
    return file === '' ? '' : `${prefix}/${file.replace(/^\//, '')}`;
  };
}
