import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BundleJson } from 'preview-contract';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundleFolder,
  FIXTURE_BUNDLE,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import { readBundle } from './read.ts';

/** The fixture's bundle.json, built per test. */
const identityOf = (): BundleJson => ({
  bundleId: 'fixture-2026-11-01',
  siteCommit: 'bec46fcadfe832d7bdec8b06eee6ba6546bd2596',
  protocolVersion: 2,
  astroVersion: '7.4.2',
  builtAt: '2026-11-01T10:00:00.000Z',
});

afterEach(() => removeBundleFolders());

describe('readBundle', () => {
  it('parses the four files of the fixture bundle', async () => {
    const bundle = await readBundle(FIXTURE_BUNDLE, identityOf());
    expect(bundle.identity).toEqual(identityOf());
    expect([...bundle.documents.keys()]).toEqual([
      'authors/noor-haddad',
      'blog/blog-1',
      'data:src/config/theme.json',
      'fixtures/define-vars',
      'stats/editors',
      'testimonials/t-ana',
    ]);
    expect([...bundle.collections.keys()]).toEqual([
      'fixtures',
      'homepage',
      'authors',
      'testimonials',
      'partners',
      'stats',
      'landing',
      'blog',
      'pages',
      'contact',
      'pricing',
      'faq',
    ]);
    expect(bundle.routes).toHaveLength(14);
    expect(bundle.images.map((image) => image.path)).toEqual([
      'src/assets/authors/ana-torres.png',
      'src/assets/blog/cover-1.jpg',
      'src/assets/partners/atlas.png',
    ]);
  });

  it('refuses a file that cannot be read, and names the file', async () => {
    const dir = await bundleFolder({ 'images.json': null });
    await mkdir(join(dir, 'images.json'));
    await expect(readBundle(dir, identityOf())).rejects.toMatchObject({
      name: 'BundleError',
      file: 'images.json',
    });
    await expect(readBundle(dir, identityOf())).rejects.toThrow(
      /^images\.json: cannot be read: /,
    );
  });

  it.each([
    [
      'documents.json is not JSON',
      { 'documents.json': '[' },
      'documents.json: is not valid JSON',
    ],
    [
      'documents.json is missing',
      { 'documents.json': null },
      'documents.json: is missing',
    ],
    [
      'documents.json is an object',
      { 'documents.json': '{}' },
      'documents.json: Invalid input: expected array, received object',
    ],
    [
      'a document has no revision',
      {
        'documents.json': '[{"key":"blog/a","format":"md","buildTime":false}]',
      },
      'documents.json at [0].revision: Invalid input: expected string, received undefined',
    ],
    [
      'two documents share a key',
      {
        'documents.json':
          '[{"key":"blog/a","format":"md","buildTime":false,"revision":"0123456789abcdef"},{"key":"blog/a","format":"md","buildTime":false,"revision":"0123456789abcdef"}]',
      },
      'documents.json at [1].key: duplicate key "blog/a"',
    ],
    [
      'routes.json is an object',
      { 'routes.json': '{}' },
      'routes.json: Invalid input: expected array, received object',
    ],
    [
      'an image has no hash',
      { 'images.json': '[{"path":"src/assets/a.png"}]' },
      'images.json at [0].hash: Invalid input: expected string, received undefined',
    ],
    [
      'a collection in schema.json is a string',
      { 'schema.json': '{"pages":"x"}' },
      'schema.json: collection "pages": Invalid input: expected object, received string',
    ],
    [
      'a collection in schema.json has an unknown key',
      { 'schema.json': '{"pages":{"rules":[]}}' },
      'schema.json: collection "pages": Unrecognized key: "rules"',
    ],
  ])('refuses the bundle where %s', async (_name, changes, message) => {
    const dir = await bundleFolder(changes);
    await expect(readBundle(dir, identityOf())).rejects.toMatchObject({
      name: 'BundleError',
      message,
    });
  });
});
