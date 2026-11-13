import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseConfig } from './schema.ts';

// A config with only the required keys. Each test changes one thing.
function minimal(): Record<string, unknown> {
  return {
    site: 'sample-site',
    remote: 'git@github.com:owner/site.git',
    previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
    origins: {
      cms: 'http://cms.localhost:4400',
      preview: 'http://preview.localhost:4401',
    },
  };
}

// Parses a config that must be refused, and returns each issue as path and message.
function rejection(raw: unknown): Array<{ path: string; message: string }> {
  try {
    parseConfig(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      return error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
    }
    throw error;
  }
  throw new Error('parseConfig accepted the config');
}

const ORIGIN = 'must be an http or https origin: scheme, host and port only';
const SITE_DIR = 'siteDir must be a relative path inside the repo';
const PREVIEW_DIR =
  'previewSiteConfig must be a relative path inside the workspace';
const MEDIA_DIR = 'media.folder must be a relative path inside the site';

describe('parseConfig defaults', () => {
  it('fills every optional key with its default', () => {
    expect(parseConfig(minimal())).toEqual({
      site: 'sample-site',
      remote: 'git@github.com:owner/site.git',
      branch: 'main',
      siteDir: '.',
      previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
      origins: {
        cms: 'http://cms.localhost:4400',
        preview: 'http://preview.localhost:4401',
      },
      publish: { buildCheck: 'auto' },
      media: { folder: 'src/assets/uploads' },
      syncIntervalSeconds: 60,
      collections: {},
      git: { author: 'astroViewCMS <cms@localhost>' },
    });
  });

  it('keeps every value that is given', () => {
    const full = {
      ...minimal(),
      branch: 'trunk',
      siteDir: 'apps/site',
      publish: { buildCheck: 'always' },
      media: { folder: 'public/uploads' },
      syncIntervalSeconds: 5,
      collections: { posts: { newEntryFormat: 'mdx' }, authors: {} },
      git: { author: 'Ada <ada@example.test>' },
    };
    expect(parseConfig(full)).toEqual(full);
  });

  it('keeps an empty collection entry without a format', () => {
    const parsed = parseConfig({ ...minimal(), collections: { notes: {} } });
    expect(parsed.collections).toEqual({ notes: {} });
  });

  it('normalises an origin to scheme, host and port, dropping the trailing slash', () => {
    const parsed = parseConfig({
      ...minimal(),
      origins: {
        cms: 'HTTPS://Cms.Example.test:443/',
        preview: 'http://preview.localhost:4401/',
      },
    });
    expect(parsed.origins).toEqual({
      cms: 'https://cms.example.test',
      preview: 'http://preview.localhost:4401',
    });
  });

  it('keeps a collection named like a prototype key as an own key', () => {
    const raw = JSON.parse(
      '{"__proto__":{"newEntryFormat":"json"},"constructor":{},"toString":{}}',
    ) as unknown;
    const parsed = parseConfig({ ...minimal(), collections: raw });
    expect(Object.keys(parsed.collections)).toEqual([
      '__proto__',
      'constructor',
      'toString',
    ]);
    expect(Object.getPrototypeOf(parsed.collections)).toBe(Object.prototype);
    expect(
      Object.getOwnPropertyDescriptor(parsed.collections, '__proto__')?.value,
    ).toEqual({
      newEntryFormat: 'json',
    });
  });

  it('throws a ZodError for a config that is not an object', () => {
    expect(() => parseConfig(undefined)).toThrow(ZodError);
  });
});

describe('parseConfig rejections', () => {
  it('refuses an unknown key, at the top level and inside a group', () => {
    expect(rejection({ ...minimal(), brnach: 'main' })).toEqual([
      { path: '', message: 'Unrecognized key: "brnach"' },
    ]);
    expect(
      rejection({ ...minimal(), publish: { buildCheck: 'auto', extra: 1 } }),
    ).toEqual([{ path: 'publish', message: 'Unrecognized key: "extra"' }]);
  });

  it('refuses a missing required key', () => {
    const { remote: _remote, ...withoutRemote } = minimal();
    expect(rejection(withoutRemote)).toEqual([
      {
        path: 'remote',
        message: 'Invalid input: expected string, received undefined',
      },
    ]);
  });

  it.each([
    '',
    '../x',
    'My Site',
    'Sample',
    'sample_site',
    '-sample',
    'sample/site',
  ])('refuses the site name %j', (site) => {
    expect(rejection({ ...minimal(), site })).toEqual([
      {
        path: 'site',
        message:
          'site must be lower-case letters, digits and hyphens, starting with a letter or digit',
      },
    ]);
  });

  it('accepts a site name with digits and hyphens', () => {
    expect(parseConfig({ ...minimal(), site: 'site-2' }).site).toBe('site-2');
  });

  it('refuses an empty remote', () => {
    expect(rejection({ ...minimal(), remote: '' })).toEqual([
      {
        path: 'remote',
        message: 'Too small: expected string to have >=1 characters',
      },
    ]);
  });

  it('refuses an empty branch', () => {
    expect(rejection({ ...minimal(), branch: '' })).toEqual([
      {
        path: 'branch',
        message: 'Too small: expected string to have >=1 characters',
      },
    ]);
  });

  it.each([
    '/etc/site',
    '\\\\server\\share',
    'C:\\repo',
    'C:/repo',
    'C:site',
    '..',
    '../outside',
    'apps/../../outside',
    'apps\\..\\..\\outside',
    '',
  ])('refuses the siteDir %j', (siteDir) => {
    expect(rejection({ ...minimal(), siteDir })).toEqual([
      { path: 'siteDir', message: SITE_DIR },
    ]);
  });

  it.each(['.', 'apps/site', 'my..site', '..site', 'apps\\site'])(
    'accepts the siteDir %j',
    (siteDir) => {
      expect(parseConfig({ ...minimal(), siteDir }).siteDir).toBe(siteDir);
    },
  );

  it('refuses a missing previewSiteConfig', () => {
    const { previewSiteConfig: _path, ...withoutPath } = minimal();
    expect(rejection(withoutPath)).toEqual([
      {
        path: 'previewSiteConfig',
        message: 'Invalid input: expected string, received undefined',
      },
    ]);
  });

  it.each(['/abs/sample-site.config.ts', '../../outside.ts', 'C:\\x.ts', ''])(
    'refuses the previewSiteConfig %j',
    (previewSiteConfig) => {
      expect(rejection({ ...minimal(), previewSiteConfig })).toEqual([
        { path: 'previewSiteConfig', message: PREVIEW_DIR },
      ]);
    },
  );

  it.each([
    'ftp://cms.localhost:4400',
    'file:///tmp/cms',
    'cms.localhost:4400',
    'not a url',
    'http://cms.localhost:4400/app',
    'http://cms.localhost:4400?x=1',
    'http://cms.localhost:4400#top',
    'http://user@cms.localhost:4400',
    '',
  ])('refuses the origin %j', (cms) => {
    expect(
      rejection({
        ...minimal(),
        origins: { cms, preview: 'http://localhost:4401' },
      }),
    ).toEqual([{ path: 'origins.cms', message: ORIGIN }]);
  });

  it('refuses an origin that carries a password', () => {
    expect(
      rejection({
        ...minimal(),
        origins: {
          cms: 'https://:secret@example.com',
          preview: 'https://preview.example',
        },
      }),
    ).toEqual([
      {
        path: 'origins.cms',
        message: 'must be an http or https origin: scheme, host and port only',
      },
    ]);
  });

  it('accepts a previewSiteConfig with a colon that is not after a drive letter', () => {
    expect(() =>
      parseConfig({ ...minimal(), previewSiteConfig: 'sites/a:b.ts' }),
    ).not.toThrow();
  });

  it('reports each refusal of an origin, a folder or a nested group as a custom issue', () => {
    const codesOf = (raw: unknown): string[] => {
      try {
        parseConfig(raw);
      } catch (error) {
        if (error instanceof ZodError)
          return error.issues.map((issue) => issue.code);
        throw error;
      }
      throw new Error('expected a rejection');
    };
    expect(
      codesOf({
        ...minimal(),
        origins: { cms: 'https://a.example/x', preview: 'https://b.example' },
      }),
    ).toEqual(['custom']);
    expect(
      codesOf({
        ...minimal(),
        origins: { cms: 'https://a.example', preview: 'https://a.example' },
      }),
    ).toEqual(['custom']);
    expect(codesOf({ ...minimal(), previewSiteConfig: '../x.ts' })).toEqual([
      'custom',
    ]);
    expect(
      codesOf({
        ...minimal(),
        collections: { posts: { newEntryFormat: 'toml' } },
      }),
    ).toEqual(['custom']);
  });

  it('refuses a missing origin', () => {
    expect(
      rejection({ ...minimal(), origins: { cms: 'http://localhost:4400' } }),
    ).toEqual([
      {
        path: 'origins.preview',
        message: 'Invalid input: expected string, received undefined',
      },
    ]);
  });

  it.each([
    ['http://localhost:4400', 'http://localhost:4400'],
    ['http://localhost:4400', 'http://localhost:4400/'],
    ['http://localhost:80', 'http://localhost'],
  ])(
    'refuses the same origin for cms and preview: %s and %s',
    (cms, preview) => {
      expect(rejection({ ...minimal(), origins: { cms, preview } })).toEqual([
        {
          path: 'origins.preview',
          message: 'origins.cms and origins.preview must differ',
        },
      ]);
    },
  );

  it.each([
    ['https://localhost:4400', 'http://localhost:4400'],
    ['http://localhost:4400', 'http://localhost:4401'],
    ['http://a.localhost:4400', 'http://b.localhost:4400'],
  ])(
    'accepts origins that differ in scheme, host or port: %s and %s',
    (cms, preview) => {
      expect(
        parseConfig({ ...minimal(), origins: { cms, preview } }).origins,
      ).toEqual({
        cms,
        preview,
      });
    },
  );

  it.each(['Always', 'sometimes', ''])(
    'refuses the buildCheck %j',
    (buildCheck) => {
      expect(rejection({ ...minimal(), publish: { buildCheck } })).toEqual([
        {
          path: 'publish.buildCheck',
          message: 'Invalid option: expected one of "always"|"auto"|"never"',
        },
      ]);
    },
  );

  it('accepts each of the three buildCheck values', () => {
    for (const buildCheck of ['always', 'auto', 'never'] as const) {
      expect(
        parseConfig({ ...minimal(), publish: { buildCheck } }).publish,
      ).toEqual({
        buildCheck,
      });
    }
  });

  it.each(['../uploads', '/var/uploads', 'C:\\uploads', ''])(
    'refuses the media folder %j',
    (folder) => {
      expect(rejection({ ...minimal(), media: { folder } })).toEqual([
        { path: 'media.folder', message: MEDIA_DIR },
      ]);
    },
  );

  it.each([
    [0, 'Too small: expected number to be >0'],
    [-5, 'Too small: expected number to be >0'],
    [1.5, 'Invalid input: expected int, received number'],
    ['60', 'Invalid input: expected number, received string'],
    [null, 'Invalid input: expected number, received null'],
    [
      300,
      'syncIntervalSeconds must be 299 or less: the sync runs only while a session is open, and a session lasts five minutes',
    ],
  ])('refuses syncIntervalSeconds %j', (syncIntervalSeconds, message) => {
    expect(rejection({ ...minimal(), syncIntervalSeconds })).toEqual([
      { path: 'syncIntervalSeconds', message },
    ]);
  });

  it('accepts 299 seconds, the longest interval that syncs inside a session', () => {
    expect(
      parseConfig({ ...minimal(), syncIntervalSeconds: 299 })
        .syncIntervalSeconds,
    ).toBe(299);
  });

  it.each([[[]], [null], ['posts']])(
    'refuses collections that are not an object: %j',
    (collections) => {
      expect(rejection({ ...minimal(), collections })).toEqual([
        { path: 'collections', message: 'collections must be an object' },
      ]);
    },
  );

  it('refuses a collection with an unknown format', () => {
    expect(
      rejection({
        ...minimal(),
        collections: { posts: { newEntryFormat: 'toml' } },
      }),
    ).toEqual([
      {
        path: 'collections.posts.newEntryFormat',
        message: 'Invalid option: expected one of "json"|"md"|"mdx"|"yaml"',
      },
    ]);
  });

  it('refuses an unknown key inside a collection', () => {
    expect(
      rejection({ ...minimal(), collections: { posts: { format: 'json' } } }),
    ).toEqual([
      { path: 'collections.posts', message: 'Unrecognized key: "format"' },
    ]);
  });

  it('refuses an empty git author', () => {
    expect(rejection({ ...minimal(), git: { author: '' } })).toEqual([
      {
        path: 'git.author',
        message: 'Too small: expected string to have >=1 characters',
      },
    ]);
  });
});
