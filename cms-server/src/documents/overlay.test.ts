import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundleFolder,
  FIXTURE_BUNDLE,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import { silentLog } from '../../test/helpers/repo.ts';
import {
  removeWorkingCopies,
  sampleWorkingCopy,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import type { Bundle } from '../bundle/read.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import { createBundleStore } from '../bundle/store.ts';
import type { ChangedPath } from '../git/sync.ts';
import type { ChangesetRepo } from './changeset.ts';
import { overlayOf } from './overlay.ts';

afterEach(async () => {
  await removeBundleFolders();
  await removeWorkingCopies();
});

const CMS_ORIGIN = 'http://cms.localhost:4400';
const MEDIA_FOLDER = 'src/assets/uploads';
// The fixture's images.json holds the hash `3ae64adeff2adc8b` for ana-torres.png, so this id is in the bundle.
const ID_BUNDLED = `3ae64adeff2adc8b${'e'.repeat(48)}`;
const ID_NEW = 'c'.repeat(64);

/** The bundle of one folder, through the store the routes read it with. */
async function bundleIn(dir: string): Promise<Bundle> {
  const bundle = await createBundleStore(directoryBundleSource(dir)).current();
  if (bundle === null) throw new Error('the test bundle is missing');
  return bundle;
}

/** A changeset repo with the given changed paths. The merge base holds no file, so the changed files are new to it. */
function repoWith(paths: ChangedPath[] = []): ChangesetRepo {
  return {
    changedPaths: async () => paths,
    mergeBase: async () => 'base',
    showAtBytes: async () => null,
    overwrittenSince: async () => new Map(),
  };
}

/** The media files of a site: a temp folder holding `media.json` when it is given. */
async function mediaIn(mediaJson: string | null) {
  const folder = await tempWorkingCopy(
    mediaJson === null ? {} : { 'media.json': mediaJson },
  );
  return {
    stagingDir: join(folder, 'staging'),
    mediaFile: join(folder, 'media.json'),
    cmsOrigin: CMS_ORIGIN,
  };
}

describe('overlayOf', () => {
  it('is empty when the working copy holds the documents the bundle holds', async () => {
    const siteFolder = await sampleWorkingCopy();
    expect(
      await overlayOf({
        bundle: await bundleIn(FIXTURE_BUNDLE),
        repo: repoWith(),
        siteFolder,
        media: await mediaIn(null),
        mediaFolder: MEDIA_FOLDER,
        log: silentLog(),
      }),
    ).toStrictEqual({ documents: {}, media: {} });
  });

  it('gives the value of a document whose file changed, by its key', async () => {
    const siteFolder = await sampleWorkingCopy({
      'src/content/authors/ana-torres.json': '{"name":"Ana T."}\n',
    });
    expect(
      await overlayOf({
        bundle: await bundleIn(FIXTURE_BUNDLE),
        repo: repoWith(),
        siteFolder,
        media: await mediaIn(null),
        mediaFolder: MEDIA_FOLDER,
        log: silentLog(),
      }),
    ).toStrictEqual({
      documents: { 'authors/ana-torres': { name: 'Ana T.' } },
      media: {},
    });
  });

  it('gives null for a document whose file is gone', async () => {
    const siteFolder = await sampleWorkingCopy({
      'src/content/authors/kofi-mensah.json': null,
    });
    expect(
      await overlayOf({
        bundle: await bundleIn(FIXTURE_BUNDLE),
        repo: repoWith(),
        siteFolder,
        media: await mediaIn(null),
        mediaFolder: MEDIA_FOLDER,
        log: silentLog(),
      }),
    ).toStrictEqual({
      documents: { 'authors/kofi-mensah': null },
      media: {},
    });
  });

  it('gives null for each entry of a shared file that is gone', async () => {
    const siteFolder = await sampleWorkingCopy({
      'src/content/stats.yaml': null,
    });
    expect(
      await overlayOf({
        bundle: await bundleIn(FIXTURE_BUNDLE),
        repo: repoWith(),
        siteFolder,
        media: await mediaIn(null),
        mediaFolder: MEDIA_FOLDER,
        log: silentLog(),
      }),
    ).toStrictEqual({
      documents: {
        'stats/editors': null,
        'stats/sites': null,
        'stats/uptime': null,
      },
      media: {},
    });
  });

  it('leaves out a document whose file does not parse', async () => {
    const siteFolder = await sampleWorkingCopy({
      'src/content/authors/ana-torres.json': '{"name": ',
    });
    expect(
      await overlayOf({
        bundle: await bundleIn(FIXTURE_BUNDLE),
        repo: repoWith(),
        siteFolder,
        media: await mediaIn(null),
        mediaFolder: MEDIA_FOLDER,
        log: silentLog(),
      }),
    ).toStrictEqual({ documents: {}, media: {} });
  });

  it('leaves out a read-only document that changed, since it has no value', async () => {
    const siteFolder = await sampleWorkingCopy({
      'src/content/fixtures/define-vars.json': '{"changed":true}\n',
    });
    expect(
      await overlayOf({
        bundle: await bundleIn(FIXTURE_BUNDLE),
        repo: repoWith(),
        siteFolder,
        media: await mediaIn(null),
        mediaFolder: MEDIA_FOLDER,
        log: silentLog(),
      }),
    ).toStrictEqual({ documents: {}, media: {} });
  });

  it('adds a document the CMS created, under the key its collection gives it', async () => {
    const siteFolder = await sampleWorkingCopy({
      'src/content/authors/new-author.json': '{"name":"New"}\n',
    });
    expect(
      await overlayOf({
        bundle: await bundleIn(FIXTURE_BUNDLE),
        repo: repoWith([
          { path: 'src/content/authors/new-author.json', status: 'created' },
        ]),
        siteFolder,
        media: await mediaIn(null),
        mediaFolder: MEDIA_FOLDER,
        log: silentLog(),
      }),
    ).toStrictEqual({
      documents: { 'authors/new-author': { name: 'New' } },
      media: {},
    });
  });

  it('leaves out a bundle document with no file, rather than taking it for a deleted one', async () => {
    const dir = await bundleFolder({
      'documents.json': JSON.stringify([
        {
          key: 'virtual/doc',
          format: 'json',
          buildTime: false,
          revision: '0123456789abcdef',
        },
      ]),
    });
    const siteFolder = await sampleWorkingCopy();
    expect(
      await overlayOf({
        bundle: await bundleIn(dir),
        repo: repoWith(),
        siteFolder,
        media: await mediaIn(null),
        mediaFolder: MEDIA_FOLDER,
        log: silentLog(),
      }),
    ).toStrictEqual({ documents: {}, media: {} });
  });

  it('keeps a document key named __proto__ as an own key of the documents', async () => {
    const dir = await bundleFolder({
      'documents.json': JSON.stringify([
        {
          key: '__proto__',
          file: 'src/content/proto.json',
          format: 'json',
          buildTime: false,
          revision: '0123456789abcdef',
        },
      ]),
    });
    const siteFolder = await sampleWorkingCopy({
      'src/content/proto.json': '{"a":1}\n',
    });
    const { documents } = await overlayOf({
      bundle: await bundleIn(dir),
      repo: repoWith(),
      siteFolder,
      media: await mediaIn(null),
      mediaFolder: MEDIA_FOLDER,
      log: silentLog(),
    });
    expect(Object.keys(documents)).toStrictEqual(['__proto__']);
    expect(
      Object.getOwnPropertyDescriptor(documents, '__proto__')?.value,
    ).toStrictEqual({ a: 1 });
    expect(Object.getPrototypeOf(documents)).toBe(Object.prototype);
  });

  it('maps the staged images that the bundle lacks, and leaves out the ones its images.json holds', async () => {
    const siteFolder = await sampleWorkingCopy();
    const media = await mediaIn(
      `{"${ID_BUNDLED}":{"width":2,"height":3,"format":"png"},"${ID_NEW}":{"width":4,"height":5,"format":"webp"}}\n`,
    );
    const info = {
      url: `${CMS_ORIGIN}/media/staging/${ID_NEW}.webp`,
      width: 4,
      height: 5,
      format: 'webp',
    };
    expect(
      await overlayOf({
        bundle: await bundleIn(FIXTURE_BUNDLE),
        repo: repoWith(),
        siteFolder,
        media,
        mediaFolder: MEDIA_FOLDER,
        log: silentLog(),
      }),
    ).toStrictEqual({
      documents: {},
      media: {
        [info.url]: info,
        [`${MEDIA_FOLDER}/${'c'.repeat(16)}.webp`]: info,
      },
    });
  });
});
