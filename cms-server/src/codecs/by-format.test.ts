import { describe, expect, it } from 'vitest';
import { codecFor } from './by-format.ts';
import { markdownCodec } from './frontmatter.ts';
import { jsonCodec } from './json.ts';
import { yamlCodec } from './yaml.ts';

// Each format maps to its own codec object, checked by identity; the last test pins the YAML date rule.
describe('codecFor', () => {
  it('maps json to the JSON codec', () => {
    expect(codecFor('json')).toBe(jsonCodec);
  });

  it('maps yaml to the YAML codec', () => {
    expect(codecFor('yaml')).toBe(yamlCodec);
  });

  it('maps md and mdx to the Markdown codec', () => {
    expect(codecFor('md')).toBe(markdownCodec);
    expect(codecFor('mdx')).toBe(markdownCodec);
  });

  it('has no codec for toml or other, so callers must handle null', () => {
    expect(codecFor('toml')).toBeNull();
    expect(codecFor('other')).toBeNull();
  });

  it('reads unquoted YAML dates as Date, as Astro does', () => {
    const value = codecFor('yaml')?.parse('since: 2022-01-20\n');
    expect(value).toEqual({ since: new Date('2022-01-20T00:00:00Z') });
  });
});
