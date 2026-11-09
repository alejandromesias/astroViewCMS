// One build of one commit (WORKPLAN 2.9a, PHASE-2-DESIGN 4.4 and 5.6). It adds a detached worktree at the commit,
// runs preview-render-server's build.ts on the site folder of that worktree as a child process, writes the log to
// `.cms/<site>/logs/`, and removes the worktree again. A failed build leaves no bundle folder, and the old bundles
// are collected. The repo lock is held only while the worktree is added and removed, never during the build, so a
// save or a sync does not wait for the minutes a build takes.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitError } from '../git/exec.ts';
import type { RepoTx } from '../git/ops.ts';
import { type Logger, logger } from '../log.ts';
import type {
  BuildError,
  BuildFn,
  BuildJob,
  BuildResult,
} from './build-runner.ts';
import { collectBundles, removeBundle } from './bundles.ts';
import { childEnvironment } from './child-env.ts';

/** The part of `Repo` that adds and removes worktrees. `Repo.locked` has this shape. */
export interface WorktreeLock {
  locked<T>(
    holder: string,
    work: (tx: Pick<RepoTx, 'worktreeAdd' | 'worktreeRemove'>) => Promise<T>,
  ): Promise<T>;
}

/** How the child process ended, and what it printed (stdout and stderr, in the order they came). */
export interface BuildExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
}

/**
 * The part of a child process the build uses. `exited` settles once, when the output is complete. `pid` is undefined
 * when the process could not be started.
 */
export interface BuildChild {
  readonly pid: number | undefined;
  readonly exited: Promise<BuildExit>;
  kill(signal: NodeJS.Signals): void;
}

/** A program and its arguments, as the spawn seam takes them. */
export interface Command {
  readonly command: string;
  readonly args: readonly string[];
}

export type SpawnBuild = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
) => BuildChild;

export interface BuildCommitOptions {
  readonly repo: WorktreeLock;
  /** The `.cms` folder. Bundles go in `<cmsDir>/<site>/bundles`, logs in `<cmsDir>/<site>/logs`. */
  readonly cmsDir: string;
  readonly site: string;
  /** The site folder inside the repo (`siteDir`). */
  readonly siteDir: string;
  /** The preview site config, as an absolute path. build.ts takes it as its first argument. */
  readonly siteConfig: string;
  /** Path of preview-render-server's build.ts. Default: the sibling workspace folder. */
  readonly buildScript?: string;
  readonly spawn?: SpawnBuild;
  /** The variables the build may inherit are picked from this. Default: process.env. */
  readonly parentEnv?: NodeJS.ProcessEnv;
  /** How long one build may run, in ms. Default 10 minutes. */
  readonly timeoutMs?: number;
  /** The platform the tree kill is for. Default: process.platform. */
  readonly platform?: NodeJS.Platform;
  /** Sends SIGKILL to a process group, by the group id (POSIX). Default: `signalProcessGroup`. */
  readonly signalGroup?: (pgid: number) => void;
  /**
   * The bundle ids that collection must keep: the one the node serves and the last good one (WORKPLAN 2.9c). Read
   * after each build. Default: none.
   */
  readonly keptBundles?: () => ReadonlySet<string>;
  readonly log?: Logger;
}

const DEFAULT_BUILD_SCRIPT = path.resolve(
  import.meta.dirname,
  '../../../preview-render-server/src/build.ts',
);
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
// Astro writes colour codes even into a pipe. They are removed before the output is read.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape character starts a colour code
const COLOUR_CODE = /\u001b\[[0-9;]*m/g;
// A location in the output: `path:line:col`, after an optional `[plugin ...]` tag. The message may follow on the same line.
const LOCATION = /^(?:\[[^\]]*\]\s*)?(.+?):\d+:\d+(?::\s*(.*))?$/;

/** The result of the child, before it becomes a `BuildResult`. */
interface Outcome {
  readonly ok: boolean;
  readonly output: string;
  readonly firstError: BuildError | null;
}

/** The function that runs one build, plus `stop`, which kills the build in flight (2.9c-B). */
export type Builder = BuildFn & { stop(): Promise<void> };

/** Makes the function that runs one build. The builds it runs are not concurrent: the build runner queues them. */
export function createBuilder(options: BuildCommitOptions): Builder {
  const { repo, cmsDir, site, siteDir, siteConfig } = options;
  const siteRoot = path.join(cmsDir, site);
  const bundlesDir = path.join(siteRoot, 'bundles');
  const logsDir = path.join(siteRoot, 'logs');
  const buildScript = options.buildScript ?? DEFAULT_BUILD_SCRIPT;
  // The folder above `src`: build.ts resolves its packages from there.
  const cwd = path.resolve(path.dirname(buildScript), '..');
  const spawnBuild = options.spawn ?? defaultSpawn;
  const parentEnv = options.parentEnv ?? process.env;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const platform = options.platform ?? process.platform;
  const signalGroup = options.signalGroup ?? signalProcessGroup;
  const keptBundles = options.keptBundles ?? (() => new Set<string>());
  const log = options.log ?? logger;

  // The build child that is running now, or undefined. Set once it is spawned, cleared once it has exited.
  let running: BuildChild | undefined;
  // Set by stop(). A build that has not spawned its child yet (its worktree is still being added) starts no child.
  let stopping = false;

  // Kills the whole process tree of a build that ran over: `taskkill /T` on Windows, the process group elsewhere
  // (defaultSpawn starts each build as a group leader). On Windows the build is killed only after taskkill has
  // finished: `taskkill /T` lists the children, and a build killed first could leave them unlisted. The build itself
  // is killed last, so a tree kill that fails still ends the build.
  async function killBuild(child: BuildChild): Promise<void> {
    if (child.pid !== undefined) {
      const kill = treeKillCommand(child.pid, platform);
      if (kill === undefined) signalGroup(child.pid);
      else
        await spawnBuild(kill.command, kill.args, {
          cwd,
          env: childEnvironment(parentEnv, 'build'),
        }).exited;
    }
    child.kill('SIGKILL');
  }

  // Kills the build in flight, if there is one, through killBuild, as a timeout does. Resolves once the kill is sent.
  async function stop(): Promise<void> {
    stopping = true;
    if (running !== undefined) await killBuild(running);
  }

  // Runs build.ts on the site folder of `worktree`, and reads its first error from the output.
  async function runChild(worktree: string, job: BuildJob): Promise<Outcome> {
    if (stopping) {
      return failure('', {
        file: null,
        message: 'The build was stopped before it started',
      });
    }
    const siteFolder = path.join(worktree, siteDir);
    const args = [
      buildScript,
      siteConfig,
      '--root',
      siteFolder,
      '--out',
      path.join(bundlesDir, job.bundleId),
      '--bundle-id',
      job.bundleId,
    ];
    const child = spawnBuild(process.execPath, args, {
      cwd,
      env: childEnvironment(parentEnv, 'build'),
    });
    running = child;
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(resolve, timeoutMs, 'timeout');
    });
    const first = await Promise.race([child.exited, expired]);
    clearTimeout(timer);
    if (first === 'timeout') await killBuild(child);
    const exit = await child.exited;
    running = undefined;
    if (first === 'timeout') {
      return failure(exit.output, {
        file: null,
        message: `The build did not finish within ${timeoutMs} ms`,
      });
    }
    if (exit.code === 0)
      return { ok: true, output: exit.output, firstError: null };
    return failure(
      exit.output,
      firstErrorOf(exit.output, siteFolder) ?? {
        file: null,
        message: errorLineOf(exit.output) ?? exitMessage(exit),
      },
    );
  }

  // Adds the worktree of `commit` under the lock, runs `work` in it, and removes it under the lock even when `work` throws.
  async function inWorktree<T>(
    commit: string,
    bundleId: string,
    work: (worktree: string) => Promise<T>,
  ): Promise<T> {
    const holder = `build ${bundleId}`;
    const name = `build-${bundleId}`;
    const worktree = await repo.locked(holder, (tx) =>
      tx.worktreeAdd(commit, name),
    );
    try {
      return await work(worktree);
    } finally {
      await removeWorktree(holder, name, worktree);
    }
  }

  // Git removes the worktree under the lock. When it cannot, the folder is deleted here, because Node handles the long
  // paths that Windows git refuses (astro's cache sits inside the worktree). Git's record of the folder is pruned at the
  // next start, in ensureRepo.
  async function removeWorktree(
    holder: string,
    name: string,
    folder: string,
  ): Promise<void> {
    await repo
      .locked(holder, (tx) => tx.worktreeRemove(name))
      .catch(async (error: unknown) => {
        log.warn('Could not remove the build worktree', {
          worktree: name,
          error: messageOf(error),
          stderr: error instanceof GitError ? error.stderr : '',
        });
        await rm(folder, { recursive: true, force: true }).catch(
          (rmError: unknown) => {
            log.warn('Could not delete the build worktree folder', {
              worktree: name,
              error: messageOf(rmError),
            });
          },
        );
      });
  }

  async function build(job: BuildJob): Promise<BuildResult> {
    const { commit, bundleId } = job;
    const dir = path.join(bundlesDir, bundleId);
    await mkdir(bundlesDir, { recursive: true });
    // A failure before or around the child (the worktree, the spawn) is a failed build with its message.
    const outcome = await inWorktree(commit, bundleId, (worktree) =>
      runChild(worktree, job),
    ).catch(
      (error: unknown): Outcome =>
        failure(messageOf(error), { file: null, message: messageOf(error) }),
    );
    if (!outcome.ok) await removeBundle(bundlesDir, bundleId);
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, `${bundleId}.log`), logOf(job, outcome));
    try {
      await collectBundles(bundlesDir, keptBundles(), { log });
    } catch (error: unknown) {
      log.warn('Could not collect the old bundles', {
        bundleId,
        error: messageOf(error),
      });
    }
    log.info('Build finished', { bundleId, commit, ok: outcome.ok });
    return {
      bundleId,
      dir,
      ok: outcome.ok,
      firstError: outcome.firstError,
    };
  }

  return Object.assign(build, { stop });
}

/**
 * The command that kills the whole tree of `pid` on Windows: `taskkill /PID <pid> /T /F`. Undefined on the other
 * platforms, where the process group is signalled instead.
 */
export function treeKillCommand(
  pid: number,
  platform: NodeJS.Platform,
): Command | undefined {
  return platform === 'win32'
    ? { command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] }
    : undefined;
}

/**
 * Sends SIGKILL to the process group `pgid`. The build's pid is its group id, because defaultSpawn starts it as a
 * group leader, so everything the build started dies with it. A group that has already ended is not an error.
 */
export function signalProcessGroup(pgid: number): void {
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // The group ended on its own between the timeout and this call.
  }
}

function failure(output: string, firstError: BuildError): Outcome {
  return { ok: false, output, firstError };
}

// The output without colour codes, as its non-empty trimmed lines.
function cleanLines(output: string): string[] {
  return output
    .replace(COLOUR_CODE, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

// The first error that names a file inside the site folder: the file, relative to the site folder with `/`,
// and the message from the same line or the next line. Undefined when no such location is printed.
function firstErrorOf(
  output: string,
  siteFolder: string,
): BuildError | undefined {
  const root = siteFolder.replaceAll('\\', '/').replace(/\/+$/, '');
  const lines = cleanLines(output);
  for (const [index, line] of lines.entries()) {
    const found = LOCATION.exec(line);
    if (found === null) continue;
    const [, location = '', sameLine = ''] = found;
    const file = location.replaceAll('\\', '/');
    if (!file.startsWith(`${root}/`)) continue;
    return {
      file: file.slice(root.length + 1),
      message:
        sameLine.trim() || (lines[index + 1] ?? `The build failed in ${file}`),
    };
  }
  return undefined;
}

// The first line that names an error, for a build that failed without a located error.
function errorLineOf(output: string): string | undefined {
  return cleanLines(output).find((line) => /\berror\b/i.test(line));
}

function exitMessage({ code, signal }: BuildExit): string {
  return `The build exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})`;
}

// The log file: what was built, the result, and the output as the child printed it.
function logOf({ commit, bundleId }: BuildJob, outcome: Outcome): string {
  return `commit ${commit}\nbundle ${bundleId}\nresult ${outcome.ok ? 'ok' : 'failed'}\n\n${outcome.output}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The real child: stdin is closed, and stdout and stderr are kept together in the order they arrive. On POSIX the
 * child leads its own process group, which is what `signalProcessGroup` signals.
 */
export function defaultSpawn(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): BuildChild {
  const proc = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let output = '';
  const collect = (chunk: string): void => {
    output += chunk;
  };
  proc.stdout.setEncoding('utf8').on('data', collect);
  proc.stderr.setEncoding('utf8').on('data', collect);
  const exited = new Promise<BuildExit>((resolve) => {
    proc.once('error', (error) =>
      resolve({
        code: null,
        signal: null,
        output: `${output}${error.message}\n`,
      }),
    );
    proc.once('close', (code, signal) => resolve({ code, signal, output }));
  });
  return {
    pid: proc.pid,
    exited,
    kill: (signal) => {
      proc.kill(signal);
    },
  };
}
