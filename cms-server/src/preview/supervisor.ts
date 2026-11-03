// Keeps the preview node running for cms-server (WORKPLAN 2.9b, PHASE-2-DESIGN 5.6).
// It starts start.ts as a child process on one port, counts the node as ready only
// when GET /__preview/config answers the bundleId it started, restarts a crashed node
// with backoff, and swaps to another bundle on the same port. Spawn, fetch and the
// clock are injected; the defaults are the real ones. No HTTP routes here: 2.9c wires
// /api/status to status().
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { previewConfigSchema } from 'preview-contract';
import type { Secrets } from '../config/secrets.ts';

/** A built bundle folder the node can serve: `.cms/<site>/bundles/<bundleId>/`. */
export interface BundleRef {
  readonly bundleId: string;
  readonly dir: string;
}

/** How a child process ended. `stderr` keeps the end of its error output. */
export interface ExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
}

/** The part of a child process the supervisor uses. `exited` settles once. */
export interface NodeChild {
  readonly exited: Promise<ExitInfo>;
  kill(signal: NodeJS.Signals): void;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface SupervisorOptions {
  /** The port the node listens on. A swap keeps it. */
  readonly port: number;
  /** The site name the preview token is checked against (PREVIEW_SITE). */
  readonly site: string;
  /** The CMS origin, the only one allowed to frame the preview (PREVIEW_EDITOR_ORIGINS). */
  readonly editorOrigin: string;
  readonly secrets: Secrets;
  /** The site config the build used. start.ts needs it to find the site folder. */
  readonly siteConfig: string;
  /** Path of preview-render-server's start.ts. Default: the sibling workspace folder. */
  readonly startScript?: string;
  readonly spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => NodeChild;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** True when something already listens on the port. Default: a real probe. */
  readonly portInUse?: (port: number) => Promise<boolean>;
  /** The variables the node may inherit are picked from this. Default: process.env. */
  readonly parentEnv?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  /** Waits `ms` milliseconds. Used for the poll, the backoff and the grace period. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long one node may take to answer with its bundleId. Default 20 s. */
  readonly readyTimeoutMs?: number;
  /** The pause between two readiness polls. Default 200 ms. */
  readonly pollMs?: number;
  /** The time between SIGTERM and SIGKILL. Default 5 s. */
  readonly graceMs?: number;
}

type NodeState = 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed';

type StartResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

type SwapResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: string;
      readonly rolledBack: boolean;
    };

interface SupervisorStatus {
  readonly state: NodeState;
  readonly port: number;
  /** The bundle the supervisor runs or is starting, or null when stopped. */
  readonly bundleId: string | null;
  /** Crashes and failed readiness checks in a row (reset after 60 s up). */
  readonly failures: number;
  readonly error: string | null;
}

export interface Supervisor {
  start(bundle: BundleRef): Promise<StartResult>;
  swap(bundle: BundleRef): Promise<SwapResult>;
  stop(): Promise<void>;
  status(): SupervisorStatus;
}

/** One start of the node: it answered with its bundleId, or it failed. */
type Attempt =
  | { readonly kind: 'ready'; readonly child: NodeChild }
  | {
      readonly kind: 'failed';
      readonly child: NodeChild;
      readonly error: string;
      /** A port conflict: no retry, the same port would fail again. */
      readonly fatal: boolean;
    };

const DEFAULT_START_SCRIPT = path.resolve(
  import.meta.dirname,
  '../../../preview-render-server/src/start.ts',
);
const CONFIG_PATH = '/__preview/config';
const MAX_FAILURES = 5;
const STABLE_MS = 60_000;
const MAX_DELAY_MS = 30_000;
const READ_TIMEOUT_MS = 2_000;
const STDERR_KEPT = 4_000;
// The variables a node may inherit: the search path, the temp folders and, on
// Windows, the system folders. Everything else of cms-server stays out.
const INHERITED = new Set([
  'PATH',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SYSTEMROOT',
  'WINDIR',
]);
const STOPPED_RESULT: StartResult = {
  ok: false,
  error: 'The node was stopped before it was ready',
};

/** The wait before restart number `failures`: 1 s, 2 s, 4 s, 8 s, then 16 s, and 30 s at most. */
export function restartDelayMs(failures: number): number {
  return Math.min(MAX_DELAY_MS, 1_000 * 2 ** (failures - 1));
}

/** The error for a port that is already in use. It names the port. */
function portInUseMessage(port: number): string {
  return `Port ${port} is already in use: the preview node cannot listen on it. Stop the other process or choose another port.`;
}

/** The environment of the node: the allowlisted variables of `parent`, then the
 *  preview's own. No other secret of cms-server, no GIT_* and no NODE_OPTIONS. */
export function childEnvironment(
  parent: NodeJS.ProcessEnv,
  settings: {
    readonly port: number;
    readonly site: string;
    readonly editorOrigin: string;
    readonly secrets: Secrets;
  },
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(parent).filter(
      ([name, value]) =>
        value !== undefined && INHERITED.has(name.toUpperCase()),
    ),
  );
  return {
    ...inherited,
    PREVIEW_EDITOR_ORIGINS: settings.editorOrigin,
    PREVIEW_TOKEN_SECRET: settings.secrets.previewTokenSecret,
    PREVIEW_INTERNAL_SECRET: settings.secrets.previewInternalSecret,
    PREVIEW_SITE: settings.site,
    PORT: String(settings.port),
    HOST: '127.0.0.1',
  };
}

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const { port, site, editorOrigin, secrets, siteConfig } = options;
  // One leaked value would open both the cookie and the internal bearer (2.8e).
  if (secrets.previewTokenSecret === secrets.previewInternalSecret) {
    throw new Error(
      'The preview token secret and the internal secret must differ',
    );
  }
  const startScript = options.startScript ?? DEFAULT_START_SCRIPT;
  const cwd = path.resolve(path.dirname(startScript), '..');
  const spawnNode = options.spawn ?? defaultSpawn;
  const fetchConfig =
    options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const portInUse = options.portInUse ?? probePort;
  const parentEnv = options.parentEnv ?? process.env;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const readyTimeoutMs = options.readyTimeoutMs ?? 20_000;
  const pollMs = options.pollMs ?? 200;
  const graceMs = options.graceMs ?? 5_000;

  let state: NodeState = 'stopped';
  let target: BundleRef | undefined;
  // The child of the latest launch: stop() and a swap kill it.
  let child: NodeChild | undefined;
  // Bumped by every start, swap and stop. A loop of an older generation ends.
  let generation = 0;
  let failures = 0;
  let readyAt = 0;
  let lastError: string | null = null;

  /** Spawns the node for `bundle`, then polls it until it answers the bundleId,
   *  exits, or the readiness timeout passes. */
  async function launch(bundle: BundleRef): Promise<Attempt> {
    const spawned = spawnNode(
      process.execPath,
      [startScript, siteConfig, '--out', bundle.dir],
      {
        cwd,
        env: childEnvironment(parentEnv, { port, site, editorOrigin, secrets }),
      },
    );
    child = spawned;
    // Set by a callback, so the loop reads it after each await.
    let exit = undefined as ExitInfo | undefined;
    void spawned.exited.then((info) => {
      exit = info;
    });
    const deadline = now() + readyTimeoutMs;
    for (;;) {
      if (exit !== undefined) return exitedAttempt(spawned, exit);
      if (await answersWith(bundle.bundleId)) {
        return { kind: 'ready', child: spawned };
      }
      if (now() >= deadline) {
        return {
          kind: 'failed',
          child: spawned,
          error: `Bundle ${bundle.bundleId} did not answer GET ${CONFIG_PATH} with its bundleId within ${readyTimeoutMs} ms`,
          fatal: false,
        };
      }
      await sleep(pollMs);
    }
  }

  function exitedAttempt(spawned: NodeChild, exit: ExitInfo): Attempt {
    if (exit.stderr.includes('EADDRINUSE')) {
      return {
        kind: 'failed',
        child: spawned,
        error: portInUseMessage(port),
        fatal: true,
      };
    }
    return {
      kind: 'failed',
      child: spawned,
      error: exitMessage(exit),
      fatal: false,
    };
  }

  /** GET /__preview/config with the internal bearer. True only when the node
   *  answers 200 with the bundleId it was started for. Any failure is "not yet". */
  async function answersWith(bundleId: string): Promise<boolean> {
    try {
      const response = await fetchConfig(
        `http://127.0.0.1:${port}${CONFIG_PATH}`,
        {
          headers: { Authorization: `Bearer ${secrets.previewInternalSecret}` },
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        },
      );
      if (response.status !== 200) return false;
      const parsed = previewConfigSchema.safeParse(await response.json());
      return parsed.success && parsed.data.bundleId === bundleId;
    } catch {
      return false;
    }
  }

  /** Terminates the node, kills it after the grace period, and returns once it has exited. */
  async function stopChild(running: NodeChild): Promise<void> {
    running.kill('SIGTERM');
    const exitedInTime = await Promise.race([
      running.exited.then(() => true),
      sleep(graceMs).then(() => false),
    ]);
    if (!exitedInTime) running.kill('SIGKILL');
    await running.exited;
  }

  /** Stops the node and cancels any start or restart in progress. */
  async function halt(): Promise<void> {
    generation += 1;
    const running = child;
    child = undefined;
    target = undefined;
    state = 'stopped';
    if (running !== undefined) await stopChild(running);
  }

  /** The restart loop of one generation. It settles `report` once: when the first
   *  attempt answers, or when the node is given up or stopped. After that it watches
   *  the node and restarts it with backoff until the generation is superseded. */
  async function supervise(
    gen: number,
    bundle: BundleRef,
    first: Attempt | undefined,
    report: ((result: StartResult) => void) | undefined,
  ): Promise<void> {
    let attempt = first;
    let notify = report;
    for (;;) {
      if (attempt === undefined) {
        state = 'starting';
        attempt = await launch(bundle);
      }
      if (gen !== generation) {
        notify?.(STOPPED_RESULT);
        return;
      }
      let fatal = false;
      if (attempt.kind === 'ready') {
        state = 'ready';
        lastError = null;
        readyAt = now();
        notify?.({ ok: true });
        notify = undefined;
        const exit = await attempt.child.exited;
        if (gen !== generation) return;
        // A node that stayed up for a minute has earned a fresh count.
        if (now() - readyAt >= STABLE_MS) failures = 0;
        lastError = exitMessage(exit);
      } else {
        await stopChild(attempt.child);
        if (gen !== generation) {
          notify?.(STOPPED_RESULT);
          return;
        }
        lastError = attempt.error;
        fatal = attempt.fatal;
      }
      failures += 1;
      if (fatal || failures >= MAX_FAILURES) {
        state = 'failed';
        notify?.({ ok: false, error: lastError ?? '' });
        return;
      }
      state = 'restarting';
      await sleep(restartDelayMs(failures));
      if (gen !== generation) {
        notify?.(STOPPED_RESULT);
        return;
      }
      attempt = undefined;
    }
  }

  async function start(bundle: BundleRef): Promise<StartResult> {
    await halt();
    // The generation is taken before the port check, so a stop() during the check ends this start.
    const gen = ++generation;
    const taken = await portInUse(port);
    if (gen !== generation) return STOPPED_RESULT;
    if (taken) {
      state = 'failed';
      lastError = portInUseMessage(port);
      return { ok: false, error: lastError };
    }
    failures = 0;
    target = bundle;
    return new Promise<StartResult>((resolve) => {
      void supervise(gen, bundle, undefined, resolve);
    });
  }

  async function swap(next: BundleRef): Promise<SwapResult> {
    const previous = target;
    if (previous === undefined) {
      const started = await start(next);
      return started.ok
        ? { ok: true }
        : { ok: false, error: started.error, rolledBack: false };
    }
    // The old node's loop ends here. The old node has exited before the new one starts.
    generation += 1;
    const gen = generation;
    const running = child;
    child = undefined;
    target = next;
    state = 'starting';
    failures = 0;
    if (running !== undefined) await stopChild(running);
    // The new node gets one attempt: the start and the readiness timeout.
    const attempt = await launch(next);
    if (gen !== generation) {
      await stopChild(attempt.child);
      return {
        ok: false,
        error: 'The node was stopped during the swap',
        rolledBack: false,
      };
    }
    if (attempt.kind === 'ready') {
      void supervise(gen, next, attempt, undefined);
      return { ok: true };
    }
    await stopChild(attempt.child);
    child = undefined;
    const rolledBack = await start(previous);
    return { ok: false, error: attempt.error, rolledBack: rolledBack.ok };
  }

  return {
    start,
    swap,
    stop: halt,
    status: () => ({
      state,
      port,
      bundleId: target?.bundleId ?? null,
      failures,
      error: lastError,
    }),
  };
}

function exitMessage(exit: ExitInfo): string {
  const how = `code ${exit.code ?? 'none'}, signal ${exit.signal ?? 'none'}`;
  const lastLine = exit.stderr.trim().split('\n').at(-1) ?? '';
  return lastLine === ''
    ? `The preview node exited (${how})`
    : `The preview node exited (${how}): ${lastLine}`;
}

/** The real child process. Its stdout is drained, its stderr kept at the end. Its stdin is a pipe that
 *  stays open while this process lives: the child exits when it closes (stdin-exit.ts, WORKPLAN 2.1i). */
function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): NodeChild {
  const proc = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stdout.resume();
  proc.stderr.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-STDERR_KEPT);
  });
  const exited = new Promise<ExitInfo>((resolve) => {
    proc.once('error', (error) =>
      resolve({ code: null, signal: null, stderr: error.message }),
    );
    proc.once('close', (code, signal) => resolve({ code, signal, stderr }));
  });
  return {
    exited,
    kill: (signal) => {
      proc.kill(signal);
    },
  };
}

/** True when something already listens on the port (a probe that binds it and closes). */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error) =>
      resolve((error as NodeJS.ErrnoException).code === 'EADDRINUSE'),
    );
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(false));
    });
  });
}

// unref: a pending wait never keeps the process alive on its own.
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}
