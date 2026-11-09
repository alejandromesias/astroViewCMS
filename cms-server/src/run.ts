// The start code of cms-server (WORKPLAN 2.1i). It reads the config and the secrets, makes the repo ready,
// listens on the CMS port, then starts the preview node on the bundle. main.ts calls run(); every outside
// call is a field of RunDeps, and the real one is the default, so a test can replace any of them.
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { ZodError } from 'zod';
import {
  type BundleSource,
  directoryBundleSource,
  stateBundleSource,
} from './bundle/source.ts';
import { loadConfig } from './config/load.ts';
import type { CmsConfig } from './config/schema.ts';
import { type Env, loadSecrets, type Secrets } from './config/secrets.ts';
import { type EditorPage, loadEditorPage } from './editor/page.ts';
import { openRepo, type Repo } from './git/ops.ts';
import {
  type EnsureRepoOptions,
  ensureRepo,
  type RepoState,
} from './git/repo.ts';
import type { AppDeps } from './http/app.ts';
import { type Logger, logger } from './log.ts';
import {
  type BuildCommitOptions,
  type Builder,
  createBuilder,
} from './preview/build-commit.ts';
import {
  type BundleLifecycle,
  createBundleLifecycle,
} from './preview/bundle-lifecycle.ts';
import { checkAstroResolves } from './preview/dependencies.ts';
import {
  createStateStore,
  readState,
  type StateStore,
} from './preview/state.ts';
import { createStatus } from './preview/status.ts';
import {
  createSupervisor,
  type Supervisor,
  type SupervisorOptions,
} from './preview/supervisor.ts';
import {
  type SweepOptions,
  type SweepResult,
  sweepLeftovers,
} from './preview/sweep.ts';
import { createDeleteGuard } from './save/delete-guard.ts';
import { previewNotReady } from './save/validate.ts';
import { startServer } from './server.ts';

/** The arguments of the start. `bundleDir` is the renderer's build folder (its `manifest/` holds the five files). */
export interface StartArgs {
  readonly configPath: string;
  readonly bundleDir: string | undefined;
}

/** What run() returned: the server, the preview supervisor and the stop that takes both down. */
export interface Running {
  readonly server: Server;
  readonly supervisor: Supervisor;
  /** Closes the server, then stops the preview node. Later calls wait for the first one's result. */
  stop(): Promise<void>;
}

/** Every outside call of the start. `realDeps` holds the real ones. */
export interface RunDeps {
  loadConfig: (path: string) => Promise<CmsConfig>;
  loadSecrets: (dir: string, env: Env) => Promise<Secrets>;
  ensureRepo: (options: EnsureRepoOptions) => Promise<RepoState>;
  loadEditorPage: () => Promise<EditorPage>;
  directoryBundleSource: (dir: string) => BundleSource;
  sweepLeftovers: (options: SweepOptions) => Promise<SweepResult>;
  checkAstroResolves: (siteFolder: string) => string;
  createBuilder: (options: BuildCommitOptions) => Builder;
  startServer: (deps: AppDeps, port: number) => Promise<Server>;
  createSupervisor: (options: SupervisorOptions) => Supervisor;
  logger: Logger;
}

export const realDeps: RunDeps = {
  loadConfig,
  loadSecrets,
  ensureRepo,
  loadEditorPage,
  directoryBundleSource,
  sweepLeftovers,
  checkAstroResolves,
  createBuilder,
  startServer,
  createSupervisor,
  logger,
};

const USAGE = 'Usage: node src/main.ts [config-file] [--bundle <folder>]';
const DEFAULT_CONFIG = 'cms.config.ts';

/** Reads the start arguments. The config file defaults to cms.config.ts in the working folder. */
export function parseArgs(argv: readonly string[]): StartArgs {
  const rest = [...argv];
  let configPath: string | undefined;
  let bundleDir: string | undefined;
  let arg = rest.shift();
  while (arg !== undefined) {
    if (arg === '--bundle') {
      const value = rest.shift();
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`--bundle needs a folder. ${USAGE}`);
      }
      bundleDir = resolve(value);
    } else if (arg.startsWith('-') || configPath !== undefined) {
      throw new Error(`Unknown argument ${arg}. ${USAGE}`);
    } else {
      configPath = resolve(arg);
    }
    arg = rest.shift();
  }
  return {
    configPath: configPath ?? resolve(DEFAULT_CONFIG),
    bundleDir,
  };
}

/** The port of an origin such as `http://127.0.0.1:4400`. A missing or non-numeric port fails and names the setting. */
export function portOf(setting: string, origin: string): number {
  const text = /:(\d+)$/.exec(origin)?.[1];
  const port = text === undefined ? 0 : Number(text);
  if (port < 1 || port > 65535) {
    throw new Error(
      `${setting} must name a port, for example http://127.0.0.1:4400`,
    );
  }
  return port;
}

/** The text a failed start prints: each problem of the config on its own line, otherwise the error's message. */
export function describeError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) =>
        issue.path.length === 0
          ? issue.message
          : `${issue.path.join('.')}: ${issue.message}`,
      )
      .join('\n');
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Starts cms-server: the config, the secrets, the repo, the editor page, the server on the CMS port,
 * then the preview node on the bundle. A failure before the server listens rejects with nothing left
 * running; a failure after it closes the server first.
 */
export async function run(
  argv: readonly string[],
  env: Env,
  deps: RunDeps = realDeps,
): Promise<Running> {
  const args = parseArgs(argv);
  const config = await deps.loadConfig(args.configPath);
  const cmsPort = portOf('origins.cms', config.origins.cms);
  const previewPort = portOf('origins.preview', config.origins.preview);
  // The config's folder holds `.cms/`, and the paths in the config are relative to it.
  const configDir = dirname(args.configPath);
  const cmsDir = join(configDir, '.cms');
  const siteDir = join(cmsDir, config.site);
  const secrets = await deps.loadSecrets(siteDir, env);
  const repo = await deps.ensureRepo({ config, cmsDir, log: deps.logger });
  const editorPage = await deps.loadEditorPage();
  // One set of repo operations per start, so the lock covers every save of this start.
  const openedRepo = openRepo({ config, cmsDir, state: repo });
  const supervisor = deps.createSupervisor({
    port: previewPort,
    site: config.site,
    editorOrigin: config.origins.cms,
    secrets,
    siteConfig: resolve(configDir, config.previewSiteConfig),
  });
  // The builder is on unless --bundle names a folder. With --bundle there is no lifecycle: no trigger runs (2.9c).
  const status = createStatus({
    builder: args.bundleDir === undefined ? 'on' : 'off',
    node: () => supervisor.status(),
    changedPaths: () => openedRepo.changedPaths(),
  });
  const bundlesDir = join(siteDir, 'bundles');
  let source: BundleSource;
  let lifecycle: BundleLifecycle | undefined;
  if (args.bundleDir !== undefined) {
    source = deps.directoryBundleSource(join(args.bundleDir, 'manifest'));
  } else {
    const store = await prepareBuilder(deps, {
      repo: openedRepo,
      cmsDir,
      site: config.site,
      siteFolder: repo.siteFolder,
      stateFile: join(siteDir, 'state.json'),
    });
    // The served bundle is the one the state names, so a swap or a rollback changes what the source answers.
    source = stateBundleSource(
      bundlesDir,
      () => store.get().current?.bundleId ?? null,
    );
    const builder = deps.createBuilder({
      repo: openedRepo,
      cmsDir,
      site: config.site,
      siteDir: config.siteDir,
      siteConfig: resolve(configDir, config.previewSiteConfig),
      // Read when a build's collection runs: the served and last-good bundles, and those whose swap is still pending.
      keptBundles: () =>
        new Set([...store.keptBundles(), ...(lifecycle?.pendingSwaps() ?? [])]),
      log: deps.logger,
    });
    lifecycle = createBundleLifecycle({
      repo: openedRepo,
      upstreamRef: `origin/${config.branch}`,
      build: builder,
      supervisor,
      state: store,
      status,
      bundlesDir,
      log: deps.logger,
    });
  }
  // A save that asks for a rebuild starts a build. With --bundle there is no builder, so it is only logged.
  const onRebuild = (): void => {
    if (lifecycle === undefined) {
      deps.logger.info('A save asked for a rebuild, but the builder is off');
    } else {
      void lifecycle.trigger('save-rebuild');
    }
  };
  const appDeps: AppDeps = {
    editor: { page: editorPage, previewOrigin: config.origins.preview },
    media: {
      stagingDir: join(siteDir, 'staging'),
      mediaFile: join(siteDir, 'media.json'),
      cmsOrigin: config.origins.cms,
    },
    bundle: source,
    // The repo's site folder (repoDir joined with the config's siteDir): where the bundle's document files are.
    workingCopy: repo.siteFolder,
    repo: openedRepo,
    status,
    // The preview client is 2.9d's. Until it is in place every save answers 503 preview-unavailable.
    save: {
      config,
      preview: previewNotReady,
      guard: createDeleteGuard(),
      onRebuild,
    },
  };
  const server = await deps.startServer(appDeps, cmsPort);
  const stop = stopOnce(server, supervisor, lifecycle);
  // A server that closes on its own also stops the node. The stop started by stop() is the same one, so it runs once.
  server.once('close', () => {
    void stop();
  });
  let bundleId: string | null;
  try {
    if (lifecycle === undefined) {
      bundleId = await startPreview(
        supervisor,
        source,
        args.bundleDir,
        deps.logger,
      );
    } else {
      bundleId = await currentIdOf(source, deps.logger);
      // The first build can take minutes, so the start runs behind the listening server: the node and the status follow it.
      void lifecycle.start().catch((error: unknown) => {
        deps.logger.error('The preview start-up failed', {
          error: describeError(error),
        });
      });
    }
  } catch (error) {
    await stop();
    throw error;
  }
  deps.logger.info('cms started', {
    cms: config.origins.cms,
    preview: config.origins.preview,
    cmsPort,
    previewPort,
    bundle: bundleId ?? 'none',
    previewState: supervisor.status().state,
    recovered: repo.recovered,
  });
  return { server, supervisor, stop };
}

/**
 * Starts the preview node on the current bundle and returns its bundleId, or null when there is no bundle.
 * A node that does not start is logged, and the CMS keeps listening (2.9c reports it in /api/status).
 * A bundle.json that is invalid rejects.
 */
async function startPreview(
  supervisor: Supervisor,
  source: BundleSource,
  bundleDir: string | undefined,
  log: Logger,
): Promise<string | null> {
  const current = await source.current();
  if (current === null || bundleDir === undefined) return null;
  const { bundleId } = current.identity;
  const result = await supervisor.start({ bundleId, dir: bundleDir });
  if (!result.ok) {
    log.error('the preview node did not start', {
      bundle: bundleId,
      error: result.error,
    });
  }
  return bundleId;
}

/**
 * The id of the bundle the source names, for the start log. A bundle.json that cannot be read is logged and read as none,
 * so the start goes on: the lifecycle's protocol check then sees the same bundle and rebuilds it.
 */
async function currentIdOf(
  source: BundleSource,
  log: Logger,
): Promise<string | null> {
  try {
    return (await source.current())?.identity.bundleId ?? null;
  } catch (error: unknown) {
    log.warn('The current bundle cannot be read, so the start goes on', {
      error: describeError(error),
    });
    return null;
  }
}

/** Closes the server and drops its open connections, so the port is free when this resolves. Resolves at once for a server that is not listening. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/** The builder's start-up (2.9c): the leftover sweep and the astro check, then the state file. The sweep runs first, so a bundle folder with no bundle.json is gone before the state names it. Returns the state store, read from the file. */
async function prepareBuilder(
  deps: RunDeps,
  start: {
    readonly repo: Repo;
    readonly cmsDir: string;
    readonly site: string;
    readonly siteFolder: string;
    readonly stateFile: string;
  },
): Promise<StateStore> {
  await deps.sweepLeftovers({
    repo: start.repo,
    cmsDir: start.cmsDir,
    site: start.site,
    log: deps.logger,
  });
  deps.checkAstroResolves(start.siteFolder);
  const initial = await readState(start.stateFile, deps.logger);
  return createStateStore(start.stateFile, initial, deps.logger);
}

/** The stop of a running CMS: the server first, then the builds, then the node. The first call does the work; later calls return the same promise. */
function stopOnce(
  server: Server,
  supervisor: Supervisor,
  lifecycle: BundleLifecycle | undefined,
): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () => {
    stopping ??= closeServer(server)
      .then(() => lifecycle?.stop())
      .then(() => supervisor.stop());
    return stopping;
  };
}
