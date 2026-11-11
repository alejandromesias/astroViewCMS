import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { type BundleJson, bundleJsonSchema } from 'preview-contract';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { FIXTURE_BUNDLE } from '../test/helpers/bundle.ts';
import { makeTestRoot, removeTestRoot } from '../test/helpers/git.ts';
import { fetchLocal } from '../test/helpers/local-fetch.ts';
import { type BundleSource, directoryBundleSource } from './bundle/source.ts';
import { type CmsConfig, parseConfig } from './config/schema.ts';
import type { Env, Secrets } from './config/secrets.ts';
import type { EditorPage } from './editor/page.ts';
import type { Repo } from './git/ops.ts';
import type { EnsureRepoOptions, RepoState } from './git/repo.ts';
import type { AppDeps } from './http/app.ts';
import type { Logger } from './log.ts';
import type { BuildCommitOptions, Builder } from './preview/build-commit.ts';
import type { BuildJob, BuildResult } from './preview/build-runner.ts';
import { encodeState } from './preview/state.ts';
import type { Supervisor, SupervisorOptions } from './preview/supervisor.ts';
import type { SweepOptions } from './preview/sweep.ts';
import { describeError, parseArgs, portOf, type RunDeps, run } from './run.ts';
import type { DeleteGuard } from './save/context.ts';
import { startServer as listen } from './server.ts';

const USAGE = 'Usage: node src/main.ts [config-file] [--bundle <folder>]';
const CMS_ORIGIN = 'http://127.0.0.1:4400';
const PREVIEW_ORIGIN = 'http://127.0.0.1:4401';
const PAGE: EditorPage = {
  html: '<!doctype html><title>Editor</title>',
  css: 'body {}',
  script: 'export {};',
};
const SECRETS: Secrets = {
  previewTokenSecret: 'a'.repeat(64),
  previewInternalSecret: 'b'.repeat(64),
};

/** The config the schema accepts, with the origins of the test ports. */
function configOf(): CmsConfig {
  return parseConfig({
    site: 'sample-site',
    remote: 'C:/remotes/sample-site.git',
    previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
    origins: { cms: CMS_ORIGIN, preview: PREVIEW_ORIGIN },
  });
}

/** The identity of the committed fixture bundle, as bundle.json parses it. */
async function fixtureIdentity(): Promise<BundleJson> {
  const text = await readFile(join(FIXTURE_BUNDLE, 'bundle.json'), 'utf8');
  return bundleJsonSchema.parse(JSON.parse(text));
}

/** A builder whose calls are spies. Its builds answer a failure, since no test here builds for real. `stop` is a spy too. */
function fakeBuilder(): Builder {
  return Object.assign(
    vi.fn(
      async (job: BuildJob): Promise<BuildResult> => ({
        bundleId: job.bundleId,
        dir: job.bundleId,
        ok: false,
        firstError: { file: null, message: 'no build in this test' },
      }),
    ),
    { stop: vi.fn(() => Promise.resolve()) },
  );
}

/**
 * Every outside call of run() as a spy, with the real server for the listen. `servers` keeps each
 * server it started, so a test can look at it after run() has failed.
 */
function harness(
  options: {
    bundle?: BundleSource;
    startResult?: { ok: true } | { ok: false; error: string };
    repoError?: Error;
  } = {},
) {
  const servers: Server[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
  const startResult = options.startResult ?? { ok: true as const };
  const supervisor: Supervisor = {
    start: vi.fn(() => Promise.resolve(startResult)),
    swap: vi.fn(() => Promise.resolve({ ok: true as const })),
    stop: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => ({
      state: 'ready' as const,
      port: 4401,
      bundleId: null,
      failures: 0,
      error: null,
    })),
  };
  const deps: RunDeps = {
    loadConfig: vi.fn((_path: string) => Promise.resolve(configOf())),
    loadSecrets: vi.fn((_dir: string, _env: Env) => Promise.resolve(SECRETS)),
    ensureRepo: vi.fn((_options: EnsureRepoOptions) =>
      options.repoError === undefined
        ? Promise.resolve<RepoState>({
            repoDir: 'repo',
            siteFolder: 'repo',
            recovered: false,
          })
        : Promise.reject(options.repoError),
    ),
    loadEditorPage: vi.fn(() => Promise.resolve(PAGE)),
    directoryBundleSource: vi.fn(
      (_dir: string) =>
        options.bundle ?? { current: () => Promise.resolve(null) },
    ),
    // The builder's start-up and builds are fakes: no git lock, no astro check and no build child.
    sweepLeftovers: vi.fn((_options: SweepOptions) =>
      Promise.resolve({ worktrees: [], bundles: [], temp: [] }),
    ),
    checkAstroResolves: vi.fn((_siteFolder: string) => '/astro/index.js'),
    createBuilder: vi.fn((_options: BuildCommitOptions) => fakeBuilder()),
    // The real listen, on a free port: the routes answer over HTTP. The port asked for is only recorded.
    startServer: vi.fn(async (appDeps: AppDeps, _port: number) => {
      const server = await listen(appDeps, 0);
      servers.push(server);
      return server;
    }),
    createSupervisor: vi.fn((_options: SupervisorOptions) => supervisor),
    logger: log,
  };
  return { deps, log, supervisor, servers };
}

/** The port a listening test server answers on. */
function portOfServer(server: Server): number {
  return (server.address() as AddressInfo).port;
}

describe('parseArgs', () => {
  it('reads cms.config.ts from the working folder when no path is given', () => {
    expect(parseArgs([])).toEqual({
      configPath: resolve('cms.config.ts'),
      bundleDir: undefined,
    });
  });

  it('resolves a config path and a --bundle folder, in either order', () => {
    expect(parseArgs(['../cms.config.ts', '--bundle', 'out'])).toEqual({
      configPath: resolve('../cms.config.ts'),
      bundleDir: resolve('out'),
    });
    expect(parseArgs(['--bundle', 'out', 'site.ts'])).toEqual({
      configPath: resolve('site.ts'),
      bundleDir: resolve('out'),
    });
  });

  it.each([
    [['--bundle'], '--bundle needs a folder. '],
    [['--bundle', '--other'], '--bundle needs a folder. '],
  ])('refuses %j without a folder', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(new Error(`${message}${USAGE}`));
  });

  it('refuses an unknown flag and a second config path', () => {
    expect(() => parseArgs(['--port', '1'])).toThrow(
      new Error(`Unknown argument --port. ${USAGE}`),
    );
    expect(() => parseArgs(['a.ts', 'b.ts'])).toThrow(
      new Error(`Unknown argument b.ts. ${USAGE}`),
    );
  });
});

describe('portOf', () => {
  it('returns the port of an origin', () => {
    expect(portOf('origins.cms', 'http://127.0.0.1:4400')).toBe(4400);
    expect(portOf('origins.cms', 'http://127.0.0.1:65535')).toBe(65535);
  });

  it.each([
    'https://cms.example',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:abc',
  ])(
    'refuses %s, which has no numeric port, and names the setting',
    (origin) => {
      expect(() => portOf('origins.preview', origin)).toThrow(
        new Error(
          'origins.preview must name a port, for example http://127.0.0.1:4400',
        ),
      );
    },
  );
});

describe('describeError', () => {
  it('prints each config problem on its own line, with its path', () => {
    const error = new ZodError([
      {
        code: 'custom',
        path: ['origins', 'cms'],
        message: 'bad origin',
        input: '',
      },
      { code: 'custom', path: [], message: 'root problem', input: undefined },
    ]);
    expect(describeError(error)).toBe('origins.cms: bad origin\nroot problem');
  });

  it('prints the message of an error, and the text of anything else', () => {
    expect(describeError(new Error('clone failed'))).toBe('clone failed');
    expect(describeError('plain text')).toBe('plain text');
  });
});

describe('run', () => {
  it('reads the config, the secrets and the repo, then listens on the CMS port and starts the node on its port', async () => {
    const h = harness();
    const configPath = resolve('site', 'cms.config.ts');
    const configDir = dirname(configPath);
    const siteDir = join(configDir, '.cms', 'sample-site');
    const running = await run(
      [configPath],
      { PREVIEW_TOKEN_SECRET: 'x' },
      h.deps,
    );
    try {
      expect(h.deps.loadConfig).toHaveBeenCalledWith(configPath);
      expect(h.deps.loadSecrets).toHaveBeenCalledWith(siteDir, {
        PREVIEW_TOKEN_SECRET: 'x',
      });
      expect(h.deps.ensureRepo).toHaveBeenCalledWith({
        config: configOf(),
        cmsDir: join(configDir, '.cms'),
        log: h.log,
      });
      expect(h.deps.createSupervisor).toHaveBeenCalledWith({
        port: 4401,
        site: 'sample-site',
        editorOrigin: CMS_ORIGIN,
        secrets: SECRETS,
        siteConfig: resolve(
          configDir,
          'preview-render-server/sites/sample-site.config.ts',
        ),
      });
      expect(h.deps.startServer).toHaveBeenCalledWith(
        {
          editor: { page: PAGE, previewOrigin: PREVIEW_ORIGIN },
          media: {
            stagingDir: join(siteDir, 'staging'),
            mediaFile: join(siteDir, 'media.json'),
            cmsOrigin: CMS_ORIGIN,
          },
          cmsOrigin: CMS_ORIGIN,
          bundle: expect.any(Object) as BundleSource,
          workingCopy: 'repo',
          repo: expect.any(Object) as Repo,
          status: expect.any(Object) as AppDeps['status'],
          save: {
            config: expect.any(Object),
            preview: expect.objectContaining({
              validate: expect.any(Function),
              warm: expect.any(Function),
            }),
            guard: expect.any(Object) as DeleteGuard,
            onRebuild: expect.any(Function) as () => void,
          },
          overlay: { mediaFolder: 'src/assets/uploads', log: h.log },
          previewUrl: {
            origin: PREVIEW_ORIGIN,
            site: 'sample-site',
            tokenSecret: SECRETS.previewTokenSecret,
            warm: expect.any(Function) as () => Promise<void>,
            log: h.log,
          },
        },
        4400,
      );
      expect(running.server).toBe(h.servers[0]);
      expect(running.supervisor).toBe(h.supervisor);
      expect(h.supervisor.start).not.toHaveBeenCalled();
      expect(h.log.info).toHaveBeenCalledWith('cms started', {
        cms: CMS_ORIGIN,
        preview: PREVIEW_ORIGIN,
        cmsPort: 4400,
        previewPort: 4401,
        bundle: 'none',
        previewState: 'ready',
        recovered: false,
      });
    } finally {
      await running.stop();
    }
  });

  it('a malformed bundle.json of the current bundle does not reject the start: it is logged, and the protocol check sees it', async () => {
    const root = await makeTestRoot();
    try {
      const configPath = join(root, 'cms.config.ts');
      const siteDir = join(root, '.cms', 'sample-site');
      const manifest = join(siteDir, 'bundles', 'broken', 'manifest');
      await mkdir(manifest, { recursive: true });
      await writeFile(join(manifest, 'bundle.json'), '{');
      await writeFile(
        join(siteDir, 'state.json'),
        encodeState({
          current: { bundleId: 'broken', baseCommit: 'a'.repeat(40) },
          lastGood: null,
          protocolAttempts: new Map(),
        }),
      );
      const h = harness();
      const running = await run([configPath], {}, h.deps);
      try {
        expect(h.log.warn).toHaveBeenCalledWith(
          'The current bundle cannot be read, so the start goes on',
          { error: expect.stringContaining('bundle.json') as string },
        );
        // The lifecycle's own read of the same bundle.json is a mismatch, so the protocol check rebuilds it once.
        await vi.waitFor(() =>
          expect(h.log.warn).toHaveBeenCalledWith(
            'The bundle does not match the protocol, so it is rebuilt once',
            {
              bundle: 'broken',
              problem: expect.stringContaining('cannot be read') as string,
            },
          ),
        );
      } finally {
        await running.stop();
      }
    } finally {
      await removeTestRoot(root);
    }
  });

  it('with --bundle the builder is off: no sweep, no astro check and no builder, and a save rebuild is only logged', async () => {
    const root = await makeTestRoot();
    try {
      const bundleDir = join(root, 'build');
      await cp(FIXTURE_BUNDLE, join(bundleDir, 'manifest'), {
        recursive: true,
      });
      const h = harness();
      const running = await run(
        ['--bundle', bundleDir, join(root, 'cms.config.ts')],
        {},
        { ...h.deps, directoryBundleSource },
      );
      try {
        expect(h.deps.sweepLeftovers).not.toHaveBeenCalled();
        expect(h.deps.checkAstroResolves).not.toHaveBeenCalled();
        expect(h.deps.createBuilder).not.toHaveBeenCalled();
        const appDeps = vi.mocked(h.deps.startServer).mock.calls[0]?.[0];
        appDeps?.save?.onRebuild?.();
        expect(h.log.info).toHaveBeenCalledWith(
          'A save asked for a rebuild, but the builder is off',
        );
        expect(await appDeps?.status?.snapshot()).toMatchObject({
          builder: 'off',
          build: { state: 'off', error: null },
        });
      } finally {
        await running.stop();
      }
    } finally {
      await removeTestRoot(root);
    }
  });

  it('with no --bundle the builder starts up: the sweep and the astro check run on the clone, and the first build is asked for', async () => {
    const h = harness();
    const configPath = resolve('site', 'cms.config.ts');
    const configDir = dirname(configPath);
    const running = await run([configPath], {}, h.deps);
    try {
      expect(h.deps.sweepLeftovers).toHaveBeenCalledWith({
        repo: expect.any(Object) as Repo,
        cmsDir: join(configDir, '.cms'),
        site: 'sample-site',
        log: h.log,
      });
      expect(h.deps.checkAstroResolves).toHaveBeenCalledWith('repo');
      expect(h.deps.createBuilder).toHaveBeenCalledWith({
        repo: expect.any(Object) as Repo,
        cmsDir: join(configDir, '.cms'),
        site: 'sample-site',
        siteDir: '.',
        siteConfig: resolve(
          configDir,
          'preview-render-server/sites/sample-site.config.ts',
        ),
        keptBundles: expect.any(Function) as () => ReadonlySet<string>,
        log: h.log,
      });
      // With no state yet, nothing is kept.
      const options = vi.mocked(h.deps.createBuilder).mock.calls[0]?.[0];
      expect(options?.keptBundles?.()).toStrictEqual(new Set<string>());
      await vi.waitFor(() =>
        expect(h.log.info).toHaveBeenCalledWith('A build was asked for', {
          reason: 'first-start',
        }),
      );
    } finally {
      await running.stop();
    }
  });

  it('a clone the astro check refuses fails the start before anything listens', async () => {
    const h = harness();
    h.deps.checkAstroResolves = vi.fn((_siteFolder: string) => {
      throw new Error('dependencies-missing: astro cannot be resolved');
    });
    await expect(run(['site/cms.config.ts'], {}, h.deps)).rejects.toThrow(
      'dependencies-missing: astro cannot be resolved',
    );
    expect(h.deps.startServer).not.toHaveBeenCalled();
  });

  it('stop() stops the builder, so a build in flight is killed', async () => {
    const h = harness();
    const builder = fakeBuilder();
    const running = await run(
      ['site/cms.config.ts'],
      {},
      { ...h.deps, createBuilder: () => builder },
    );
    await running.stop();
    expect(builder.stop).toHaveBeenCalledTimes(1);
  });

  it('a save that asks for a rebuild starts a build when the builder is on', async () => {
    const h = harness();
    const running = await run(['site/cms.config.ts'], {}, h.deps);
    try {
      const appDeps = vi.mocked(h.deps.startServer).mock.calls[0]?.[0];
      appDeps?.save?.onRebuild?.();
      await vi.waitFor(() =>
        expect(h.log.info).toHaveBeenCalledWith('A build was asked for', {
          reason: 'save-rebuild',
        }),
      );
    } finally {
      await running.stop();
    }
  });

  it('answers the editor, the media and the data routes', async () => {
    const h = harness();
    const running = await run(['site/cms.config.ts'], {}, h.deps);
    const base = `http://127.0.0.1:${portOfServer(running.server)}`;
    try {
      const page = await fetchLocal(`${base}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toBe(PAGE.html);
      expect((await fetchLocal(`${base}/editor.css`)).status).toBe(200);
      const status = await fetchLocal(`${base}/api/status`);
      expect(status.status).toBe(200);
      // The bundle key is null, and the preview status is beside it (2.9c): the builder is on.
      expect(await status.json()).toMatchObject({
        bundle: null,
        builder: 'on',
      });
      const schema = await fetchLocal(`${base}/api/schema`);
      expect(schema.status).toBe(503);
      expect(await schema.json()).toEqual({ error: 'no-bundle' });
      const staged = await fetchLocal(
        `${base}/media/staging/${'a'.repeat(64)}.png`,
      );
      expect(staged.status).toBe(404);
      expect(await staged.text()).toBe('Not Found');
    } finally {
      await running.stop();
    }
  });

  it('starts the node on the --bundle folder and answers the bundle routes from its manifest', async () => {
    const root = await makeTestRoot();
    try {
      const bundleDir = join(root, 'build');
      await cp(FIXTURE_BUNDLE, join(bundleDir, 'manifest'), {
        recursive: true,
      });
      const identity = await fixtureIdentity();
      // The real bundle source reads the folder: only the supervisor and the server are faked.
      const h = harness();
      const deps: RunDeps = { ...h.deps, directoryBundleSource };
      const running = await run(
        ['--bundle', bundleDir, join(root, 'cms.config.ts')],
        {},
        deps,
      );
      const base = `http://127.0.0.1:${portOfServer(running.server)}`;
      try {
        expect(h.supervisor.start).toHaveBeenCalledWith({
          bundleId: identity.bundleId,
          dir: resolve(bundleDir),
        });
        const status = await fetchLocal(`${base}/api/status`);
        // The bundle key as before; the preview status beside it says the builder is off (2.9c).
        expect(await status.json()).toMatchObject({
          bundle: {
            bundleId: identity.bundleId,
            siteCommit: identity.siteCommit,
          },
          builder: 'off',
          build: { state: 'off', error: null },
        });
        expect((await fetchLocal(`${base}/api/schema`)).status).toBe(200);
      } finally {
        await running.stop();
      }
    } finally {
      await removeTestRoot(root);
    }
  });

  it('logs a preview node that does not start, and keeps the CMS listening', async () => {
    const identity = await fixtureIdentity();
    const h = harness({
      bundle: {
        current: () => Promise.resolve({ dir: 'manifest', identity }),
      },
      startResult: { ok: false, error: 'Port 4401 is already in use' },
    });
    const running = await run(
      ['--bundle', 'build', 'cms.config.ts'],
      {},
      h.deps,
    );
    try {
      expect(h.log.error).toHaveBeenCalledWith(
        'the preview node did not start',
        { bundle: identity.bundleId, error: 'Port 4401 is already in use' },
      );
      expect(h.log.info).toHaveBeenCalledWith(
        'cms started',
        expect.objectContaining({ bundle: identity.bundleId }),
      );
      const page = await fetchLocal(
        `http://127.0.0.1:${portOfServer(running.server)}/`,
      );
      expect(page.status).toBe(200);
    } finally {
      await running.stop();
    }
  });

  it('rejects before anything listens when the repo cannot be made ready', async () => {
    const h = harness({ repoError: new Error('clone failed') });
    await expect(run(['cms.config.ts'], {}, h.deps)).rejects.toThrow(
      new Error('clone failed'),
    );
    expect(h.deps.startServer).not.toHaveBeenCalled();
    expect(h.deps.createSupervisor).not.toHaveBeenCalled();
  });

  it('closes the server and rejects when the bundle is invalid', async () => {
    const h = harness({
      bundle: {
        current: () => Promise.reject(new Error('bundle.json is not valid')),
      },
    });
    await expect(
      run(['--bundle', 'build', 'cms.config.ts'], {}, h.deps),
    ).rejects.toThrow(new Error('bundle.json is not valid'));
    expect(h.servers[0]?.listening).toBe(false);
    expect(h.supervisor.start).not.toHaveBeenCalled();
  });

  it('stop() closes the server and stops the node once, however often it is called', async () => {
    const h = harness();
    const running = await run(['cms.config.ts'], {}, h.deps);
    await running.stop();
    await running.stop();
    expect(running.server.listening).toBe(false);
    expect(h.supervisor.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the node when the server closes on its own', async () => {
    const h = harness();
    const running = await run(['cms.config.ts'], {}, h.deps);
    await new Promise<void>((resolve) => {
      running.server.close(() => resolve());
    });
    await vi.waitFor(() => {
      expect(h.supervisor.stop).toHaveBeenCalledTimes(1);
    });
  });

  it('uses the real config loader by default, which rejects a missing file', async () => {
    const missing = resolve('no-such-folder', 'cms.config.ts');
    await expect(run([missing], {})).rejects.toMatchObject({
      code: 'ERR_MODULE_NOT_FOUND',
    });
  });
});
