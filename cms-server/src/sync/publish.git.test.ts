// [build] design R3 and R4 (WORKPLAN 2.10d): publish against a real bare remote and a second clone, the repo harness of
// the other git tests. The preview node is a fake that accepts every value; everything else is real: the repo, the lock, the
// sync, the changeset, the squash and the push.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { revisionOf } from 'preview-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, fakeAppDeps } from '../../test/helpers/app-deps.ts';
import {
  bundleFolder,
  removeBundleFolders,
} from '../../test/helpers/bundle.ts';
import {
  cloneRemote,
  git,
  makeTestRoot,
  removeTestRoot,
} from '../../test/helpers/git.ts';
import { saveRepoIn, silentLog } from '../../test/helpers/repo.ts';
import { previewSays } from '../../test/helpers/save-context.ts';
import { directoryBundleSource } from '../bundle/source.ts';
import { createBundleStore } from '../bundle/store.ts';
import { type ExecFn, realExec } from '../git/exec.ts';
import { openRepo, type Repo } from '../git/ops.ts';
import { createStatus } from '../preview/status.ts';
import { createDeleteGuard } from '../save/delete-guard.ts';
import { createPublish, type PublishAnswer } from './publish.ts';
import { createSync } from './sync.ts';

// Each test makes a remote, a clone and a second clone, and runs a few saves and pushes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ANA = 'src/content/authors/ana-torres.json';
const LEE = 'src/content/authors/lee.json';

const roots: string[] = [];
afterEach(async () => {
  await removeBundleFolders();
  await Promise.all(roots.splice(0).map((root) => removeTestRoot(root)));
});

interface Rig {
  readonly root: string;
  readonly remote: string;
  readonly repo: Repo;
  readonly siteFolder: string;
  readonly repoDir: string;
  readonly seed: string;
  readonly publish: () => Promise<PublishAnswer>;
  readonly put: (body: unknown) => Promise<Response>;
  readonly pushes: () => number;
  readonly trigger: ReturnType<typeof vi.fn>;
  readonly status: ReturnType<typeof createStatus>;
  readonly guard: ReturnType<typeof createDeleteGuard>;
  /** Pushes `files` (site-relative) from the second clone, as a developer would, on top of the remote's tip. */
  readonly dev: (
    files: Record<string, string>,
    message: string,
  ) => Promise<string>;
  readonly devClone: string;
  readonly remoteHead: () => Promise<string>;
  readonly remoteText: (path: string) => Promise<string>;
  readonly remoteLog: () => Promise<string[]>;
}

interface RigOptions {
  /** Runs before each push of the CMS reaches git (a developer who pushes just then). */
  readonly beforePush?: (attempt: number, rig: () => Rig) => Promise<void>;
  /** A hook the remote runs on each push. */
  readonly remoteHook?: string;
  /** What the wait for the preview's builds does, with the repo lock released. */
  readonly onWait?: (repo: Repo) => Promise<void>;
}

async function rigOf(options: RigOptions = {}): Promise<Rig> {
  const root = await makeTestRoot();
  roots.push(root);
  const base = await saveRepoIn(root);
  const { state, config } = base;
  const remote = config.remote;
  if (options.remoteHook !== undefined)
    await writeFile(join(remote, 'hooks', 'pre-receive'), options.remoteHook, {
      mode: 0o755,
    });
  let pushCount = 0;
  let current: Rig | undefined;
  const exec: ExecFn = async (file, args, execOptions) => {
    if (args.includes('push')) {
      pushCount += 1;
      await options.beforePush?.(pushCount, () => current as Rig);
    }
    return realExec(file, args, execOptions);
  };
  const repo = openRepo({
    config,
    cmsDir: join(root, '.cms'),
    state,
    exec,
  });
  const source = directoryBundleSource(await bundleFolder());
  const bundles = createBundleStore(source);
  const guard = createDeleteGuard();
  const status = createStatus({
    builder: 'on',
    node: () => ({
      state: 'ready',
      port: 4401,
      bundleId: null,
      failures: 0,
      error: null,
    }),
    changedPaths: () => repo.changedPaths(),
  });
  const trigger = vi.fn();
  const sync = createSync({ repo, bundles, guard, status, trigger });
  const media = {
    stagingDir: join(root, 'staging'),
    mediaFile: join(root, 'media.json'),
    cmsOrigin: 'http://cms.localhost:4400',
  };
  const preview = previewSays();
  const publish = createPublish({
    repo,
    bundles,
    siteFolder: state.siteFolder,
    config,
    preview,
    media,
    guard,
    syncLocked: sync.syncLocked,
    status,
    builds: {
      busy: () => false,
      waitForIdle: async () => {
        await options.onWait?.(repo);
        return true;
      },
    },
    trigger,
    log: silentLog(),
  });
  const app = createTestApp({
    ...fakeAppDeps(),
    media,
    bundle: source,
    workingCopy: state.siteFolder,
    repo,
    save: { config, preview, guard },
  });
  const devClone = await cloneRemote(remote, join(root, 'dev'));
  const seed = (await git(remote, ['rev-parse', 'main'])).trim();
  const built: Rig = {
    root,
    remote,
    repo,
    siteFolder: state.siteFolder,
    repoDir: state.repoDir,
    seed,
    publish,
    put: async (body) =>
      app.request('/api/changes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    pushes: () => pushCount,
    trigger,
    status,
    guard,
    devClone,
    async dev(files, message) {
      await git(devClone, ['fetch', 'origin']);
      await git(devClone, ['reset', '--hard', 'origin/main']);
      for (const [path, text] of Object.entries(files))
        await writeFile(join(devClone, 'site', path), text);
      await git(devClone, ['add', '--all']);
      await git(devClone, ['commit', '--message', message]);
      await git(devClone, ['push', 'origin', 'HEAD:main']);
      return (await git(devClone, ['rev-parse', 'HEAD'])).trim();
    },
    remoteHead: async () => (await git(remote, ['rev-parse', 'main'])).trim(),
    remoteText: (path) => git(remote, ['show', `main:site/${path}`]),
    remoteLog: async () =>
      (await git(remote, ['log', '--format=%s', 'main']))
        .split('\n')
        .filter((line) => line !== ''),
  };
  current = built;
  return built;
}

// A save of one update of the author Ana, with a new name, over the file as the clone has it.
async function saveAna(rig: Rig, name: string): Promise<void> {
  const before = await readFile(join(rig.siteFolder, ANA), 'utf8');
  const res = await rig.put({
    changes: [
      {
        document: 'authors/ana-torres',
        baseRevision: revisionOf(before),
        data: { ...JSON.parse(before), name },
      },
    ],
  });
  expect(res.status).toBe(200);
}

// The text of Ana's file as the developer's clone has it, with a new name (a developer's edit of the same document).
async function anaWithName(rig: Rig, name: string): Promise<string> {
  const text = await readFile(join(rig.devClone, 'site', ANA), 'utf8');
  return `${JSON.stringify({ ...JSON.parse(text), name }, null, 2)}\n`;
}

const nameOf = (text: string): unknown => JSON.parse(text).name;

describe('publish against a bare remote (R3)', () => {
  it('makes one commit on the remote for two saves of two documents, and cms/work moves to it', async () => {
    const rig = await rigOf();
    await saveAna(rig, 'Ana T.');
    const lee = await rig.put({
      changes: [
        { document: 'authors/lee', baseRevision: null, data: { name: 'Lee' } },
      ],
    });
    expect(lee.status).toBe(200);
    const answer = await rig.publish();
    const head = await rig.remoteHead();
    expect(answer).toStrictEqual({
      status: 200,
      body: { commit: head, overwritten: [], renamed: [] },
    });
    expect(await rig.remoteLog()).toStrictEqual([
      'cms: publish 2 documents',
      'seed: site',
    ]);
    expect(
      (
        await git(rig.remote, ['rev-list', '--parents', '-n', '1', 'main'])
      ).trim(),
    ).toBe(`${head} ${rig.seed}`);
    expect(nameOf(await rig.remoteText(ANA))).toBe('Ana T.');
    expect(nameOf(await rig.remoteText(LEE))).toBe('Lee');
    // cms/work is the pushed commit, so the changeset is empty, and the CMS asked for the publish build.
    expect((await git(rig.repoDir, ['rev-parse', 'cms/work'])).trim()).toBe(
      head,
    );
    await expect(rig.repo.changedPaths()).resolves.toStrictEqual([]);
    expect(rig.trigger).toHaveBeenCalledWith('publish');
    expect((await rig.status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
    expect((await git(rig.repoDir, ['status', '--porcelain'])).trim()).toBe('');
  });

  it('the commit is by the configured author', async () => {
    const rig = await rigOf();
    await saveAna(rig, 'Ana T.');
    await rig.publish();
    expect(
      (
        await git(rig.remote, ['log', '-1', '--format=%an <%ae>', 'main'])
      ).trim(),
    ).toBe('astroViewCMS <cms@localhost>');
  });

  it('keeps a developer’s change to another document: the publish sits on top of it', async () => {
    const rig = await rigOf();
    await saveAna(rig, 'Ana T.');
    const pushed = await rig.dev(
      { 'src/content/authors/extra.json': '{"name":"Extra"}\n' },
      'dev: add an author',
    );
    const answer = await rig.publish();
    expect(answer).toMatchObject({ status: 200, body: { overwritten: [] } });
    expect(await rig.remoteLog()).toStrictEqual([
      'cms: publish 1 documents',
      'dev: add an author',
      'seed: site',
    ]);
    expect((await git(rig.remote, ['rev-parse', 'main^'])).trim()).toBe(pushed);
    expect(nameOf(await rig.remoteText(ANA))).toBe('Ana T.');
    expect(nameOf(await rig.remoteText('src/content/authors/extra.json'))).toBe(
      'Extra',
    );
  });

  it('answers 200 with commit null, pushes nothing and builds nothing when nothing is saved', async () => {
    const rig = await rigOf();
    const answer = await rig.publish();
    expect(answer).toStrictEqual({
      status: 200,
      body: { commit: null, overwritten: [], renamed: [] },
    });
    expect(await rig.remoteHead()).toBe(rig.seed);
    expect(rig.pushes()).toBe(0);
    expect(rig.trigger).not.toHaveBeenCalledWith('publish');
  });

  it('syncs first when nothing is saved: cms/work follows the developer and nothing is pushed', async () => {
    const rig = await rigOf();
    const pushed = await rig.dev(
      { 'src/content/authors/extra.json': '{"name":"Extra"}\n' },
      'dev: add an author',
    );
    await rig.publish();
    expect(rig.pushes()).toBe(0);
    expect(await rig.remoteHead()).toBe(pushed);
    expect((await git(rig.repoDir, ['rev-parse', 'cms/work'])).trim()).toBe(
      pushed,
    );
  });

  it('counts saves that were put back to the upstream values as empty', async () => {
    const rig = await rigOf();
    const original = JSON.parse(
      await readFile(join(rig.siteFolder, ANA), 'utf8'),
    ).name;
    await saveAna(rig, 'Ana T.');
    await saveAna(rig, original);
    const answer = await rig.publish();
    expect(answer).toStrictEqual({
      status: 200,
      body: { commit: null, overwritten: [], renamed: [] },
    });
    expect(rig.pushes()).toBe(0);
    await expect(rig.repo.changedPaths()).resolves.toStrictEqual([]);
  });

  it('releases the repo lock for the wait: the lock can be taken inside it', async () => {
    let probed = false;
    const rig = await rigOf({
      onWait: async (repo) => {
        // Granted at once only when the publish does not hold the lock.
        await repo.locked('probe', async () => {
          probed = true;
        });
      },
    });
    await saveAna(rig, 'Ana T.');
    expect((await rig.publish()).status).toBe(200);
    expect(probed).toBe(true);
  });
});

describe('publish after the developer changed a saved document (R4)', () => {
  it('the CMS version reaches the remote, and the message names the overwritten document and the commit', async () => {
    const rig = await rigOf();
    await saveAna(rig, 'Ana by the CMS');
    const devCommit = await rig.dev(
      { [ANA]: await anaWithName(rig, 'Ana by a developer') },
      'dev: rename Ana',
    );
    const answer = await rig.publish();
    expect(answer).toMatchObject({
      status: 200,
      body: {
        overwritten: [{ key: 'authors/ana-torres', commit: devCommit }],
      },
    });
    expect(nameOf(await rig.remoteText(ANA))).toBe('Ana by the CMS');
    expect(await rig.remoteLog()).toStrictEqual([
      `cms: publish 1 documents (overwrote authors/ana-torres from ${devCommit})`,
      'dev: rename Ana',
      'seed: site',
    ]);
  });

  it('the overwrite is recorded when an earlier sync did the re-apply, not only the publish’s own', async () => {
    const rig = await rigOf();
    await saveAna(rig, 'Ana by the CMS');
    const devCommit = await rig.dev(
      { [ANA]: await anaWithName(rig, 'Ana by a developer') },
      'dev: rename Ana',
    );
    // A poll of the sync (2.10g) re-applies first; the publish then finds nothing new to re-apply.
    const sync = createSync({
      repo: rig.repo,
      bundles: createBundleStore(directoryBundleSource(await bundleFolder())),
      guard: rig.guard,
      status: rig.status,
      trigger: () => {},
    });
    await expect(sync.syncNow()).resolves.toMatchObject({ kind: 'synced' });
    const answer = await rig.publish();
    expect(answer).toMatchObject({
      status: 200,
      body: { overwritten: [{ key: 'authors/ana-torres', commit: devCommit }] },
    });
    expect((await rig.remoteLog())[0]).toBe(
      `cms: publish 1 documents (overwrote authors/ana-torres from ${devCommit})`,
    );
  });

  it('answers the renamed documents when the developer renamed a saved document’s file (2.10j)', async () => {
    const rig = await rigOf();
    await saveAna(rig, 'Ana by the CMS');
    await git(rig.devClone, ['fetch', 'origin']);
    await git(rig.devClone, ['reset', '--hard', 'origin/main']);
    await git(rig.devClone, [
      'mv',
      join('site', ANA),
      join('site', 'src/content/authors/ana-t.json'),
    ]);
    await git(rig.devClone, ['commit', '--message', 'dev: move Ana']);
    await git(rig.devClone, ['push', 'origin', 'HEAD:main']);
    const answer = await rig.publish();
    expect(answer).toMatchObject({
      status: 200,
      body: {
        renamed: [
          {
            key: 'authors/ana-torres',
            from: ANA,
            to: 'src/content/authors/ana-t.json',
          },
        ],
      },
    });
    // The status is cleared once the publish has gone out.
    expect((await rig.status.snapshot()).renamed).toStrictEqual([]);
  });
});

describe('publish when the remote moves during the push (R3, R4)', () => {
  it('a push race ends in a retry that succeeds, with the developer’s commit under the publish and nothing lost', async () => {
    let devCommit = '';
    const rig = await rigOf({
      beforePush: async (attempt, get) => {
        if (attempt === 1)
          devCommit = await get().dev(
            { 'src/content/authors/extra.json': '{"name":"Extra"}\n' },
            'dev: add an author',
          );
      },
    });
    await saveAna(rig, 'Ana T.');
    const answer = await rig.publish();
    expect(answer).toMatchObject({ status: 200 });
    expect(rig.pushes()).toBe(2);
    expect(await rig.remoteLog()).toStrictEqual([
      'cms: publish 1 documents',
      'dev: add an author',
      'seed: site',
    ]);
    expect((await git(rig.remote, ['rev-parse', 'main^'])).trim()).toBe(
      devCommit,
    );
    expect(nameOf(await rig.remoteText(ANA))).toBe('Ana T.');
    await expect(rig.repo.changedPaths()).resolves.toStrictEqual([]);
  });

  it('a race on the very document that was saved names the overwrite in the retried commit', async () => {
    let devCommit = '';
    const rig = await rigOf({
      beforePush: async (attempt, get) => {
        if (attempt === 1)
          devCommit = await get().dev(
            { [ANA]: await anaWithName(get(), 'Ana by a developer') },
            'dev: rename Ana',
          );
      },
    });
    await saveAna(rig, 'Ana by the CMS');
    const answer = await rig.publish();
    expect(answer).toMatchObject({
      status: 200,
      body: { overwritten: [{ key: 'authors/ana-torres', commit: devCommit }] },
    });
    expect(nameOf(await rig.remoteText(ANA))).toBe('Ana by the CMS');
    expect((await rig.remoteLog())[0]).toBe(
      `cms: publish 1 documents (overwrote authors/ana-torres from ${devCommit})`,
    );
  });

  it('a permanent race ends in 502 after 4 pushes, the developer’s commit stays on the remote, and every save is still saved', async () => {
    let last = '';
    const rig = await rigOf({
      beforePush: async (attempt, get) => {
        last = await get().dev(
          { 'src/content/authors/extra.json': `{"name":"Extra ${attempt}"}\n` },
          `dev: push ${attempt}`,
        );
      },
    });
    await saveAna(rig, 'Ana T.');
    const answer = await rig.publish();
    expect(answer).toMatchObject({
      status: 502,
      body: { error: 'push-rejected' },
    });
    expect(rig.pushes()).toBe(4);
    expect(await rig.remoteHead()).toBe(last);
    expect(nameOf(await rig.remoteText(ANA))).not.toBe('Ana T.');
    // Nothing is lost: the save is still on cms/work, re-applied on the latest tip, and in the working copy.
    await expect(rig.repo.changedPaths()).resolves.toStrictEqual([
      { path: ANA, status: 'modified' },
    ]);
    expect(nameOf(await readFile(join(rig.siteFolder, ANA), 'utf8'))).toBe(
      'Ana T.',
    );
    expect(rig.trigger).not.toHaveBeenCalledWith('publish');
    const snapshot = await rig.status.snapshot();
    expect(snapshot.publish.state).toBe('failed');
    expect(snapshot.publish.error).toContain('4 pushes');
  });

  it('can be published again once the race is over', async () => {
    const rig = await rigOf({
      beforePush: async (attempt, get) => {
        if (attempt <= 4)
          await get().dev(
            {
              'src/content/authors/extra.json': `{"name":"Extra ${attempt}"}\n`,
            },
            `dev: push ${attempt}`,
          );
      },
    });
    await saveAna(rig, 'Ana T.');
    expect((await rig.publish()).status).toBe(502);
    const second = await rig.publish();
    expect(second).toMatchObject({ status: 200 });
    expect(nameOf(await rig.remoteText(ANA))).toBe('Ana T.');
    expect((await rig.status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });
});

describe('publish when the remote refuses for another reason', () => {
  it('a hook that declines is an immediate 502 with one push, and the saves stay saved', async () => {
    const rig = await rigOf({
      remoteHook: '#!/bin/sh\necho "no thanks" >&2\nexit 1\n',
    });
    await saveAna(rig, 'Ana T.');
    const answer = await rig.publish();
    expect(answer).toMatchObject({
      status: 502,
      body: { error: 'push-failed' },
    });
    expect(JSON.stringify(answer)).toContain('no thanks');
    expect(rig.pushes()).toBe(1);
    expect(await rig.remoteHead()).toBe(rig.seed);
    await expect(rig.repo.changedPaths()).resolves.toStrictEqual([
      { path: ANA, status: 'modified' },
    ]);
    expect((await rig.status.snapshot()).publish.state).toBe('failed');
  });
});
