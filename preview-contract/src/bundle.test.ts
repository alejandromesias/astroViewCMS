import { describe, expect, it } from 'vitest';
import { bundleJsonSchema } from './bundle.ts';

/** A complete, valid bundle.json, built per test. */
const bundleOf = () => ({
  bundleId: 'b1-2026',
  siteCommit: 'a'.repeat(40),
  protocolVersion: 2,
  astroVersion: '7.4.2',
  builtAt: '2026-11-01T10:00:00.000Z',
});

describe('bundleJsonSchema', () => {
  it('accepts a complete record, and a null siteCommit outside git', () => {
    expect(bundleJsonSchema.parse(bundleOf())).toEqual(bundleOf());
    const noGit = { ...bundleOf(), siteCommit: null };
    expect(bundleJsonSchema.parse(noGit)).toEqual(noGit);
  });

  it.each([
    ['bundleId is empty', { bundleId: '' }],
    ['bundleId is "..", a folder escape', { bundleId: '..' }],
    ['bundleId holds a slash', { bundleId: 'a/b' }],
    ['siteCommit is not a hash', { siteCommit: 'main' }],
    ['siteCommit is uppercase hex', { siteCommit: 'A'.repeat(40) }],
    ['protocolVersion is a string', { protocolVersion: '2' }],
    ['protocolVersion is zero', { protocolVersion: 0 }],
    ['astroVersion is missing', { astroVersion: undefined }],
    ['builtAt is a date without a time', { builtAt: '2026-11-01' }],
    ['a key is unknown (writer drift)', { extra: true }],
  ])('refuses a record where %s', (_name, change) => {
    expect(
      bundleJsonSchema.safeParse({ ...bundleOf(), ...change }).success,
    ).toBe(false);
  });
});
