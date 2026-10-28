import { describe, expect, it } from 'vitest';
import { islandResolver } from './islands.ts';

const entries = {
  '@/components/PricingPlans': '_astro/PricingPlans.7PWtkfAQ.js',
  '@astrojs/react/client.js': '_astro/client.OzTcoKK0.js',
  'astro:scripts/before-hydration.js': '',
};

describe('islandResolver', () => {
  it('maps a source specifier to the built chunk, under the site base', () => {
    expect(islandResolver(entries, '/')('@/components/PricingPlans')).toBe(
      '/_astro/PricingPlans.7PWtkfAQ.js',
    );
    expect(islandResolver(entries, '/docs/')('@astrojs/react/client.js')).toBe(
      '/docs/_astro/client.OzTcoKK0.js',
    );
  });

  it('keeps an empty entry empty, so the attribute is left out', () => {
    expect(
      islandResolver(entries, '/')('astro:scripts/before-hydration.js'),
    ).toBe('');
  });

  it('leaves unknown specifiers as they are', () => {
    expect(islandResolver(entries, '/')('./Other.tsx')).toBe('./Other.tsx');
  });
});

describe('islandResolver: names of Object.prototype', () => {
  it('leaves a specifier that is only an inherited member of the map as it is', () => {
    const resolve = islandResolver(entries, '/');
    for (const specifier of [
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
    ])
      expect(resolve(specifier)).toBe(specifier);
  });
});
