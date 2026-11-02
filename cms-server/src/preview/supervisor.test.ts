import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import {
  type BundleRef,
  childEnvironment,
  createSupervisor,
  type ExitInfo,
  type NodeChild,
  restartDelayMs,
  type SpawnOptions,
  type SupervisorOptions,
} from './supervisor.ts';

const PORT = 4400;
const ORIGIN = 'https://cms.example';
const SITE = 'sample-site';
const TOKEN = 'aa'.repeat(32);
const INTERNAL = 'bb'.repeat(32);
const SECRETS = { previewTokenSecret: TOKEN, previewInternalSecret: INTERNAL };
const SITE_CONFIG = '/work/sites/sample-site.config.ts';
const START = '/repo/preview-render-server/src/start.ts';
const CONFIG_URL = `http://127.0.0.1:${PORT}/__preview/config`;
const A: BundleRef = { bundleId: 'a', dir: '/bundles/a' };
const B: BundleRef = { bundleId: 'b', dir: '/bundles/b' };
const PARENT = {
  PATH: '/usr/bin',
  TMPDIR: '/tmp',
  SystemRoot: 'C:\\Windows',
  AWS_SECRET_ACCESS_KEY: 'leak',
  NODE_OPTIONS: '--inspect',
  GIT_DIR: '/leak/.git',
  PREVIEW_INSECURE: '1',
  PREVIEW_TOKEN_SECRET: 'leak',
};

// The fake node world. `serves` says which bundleId a live node answers (null: it
// refuses the connection), `dies` ends a node at once, `ignoresTerm` keeps it alive
// after SIGTERM. Each is given the folder and the spawn index of the node.
interface Policy {
  serves: (dir: string, index: number) => string | null;
  dies: (dir: string, index: number) => ExitInfo | undefined;
  ignoresTerm: (dir: string) => boolean;
}

interface World {
  children: FakeChild[];
  // "spawn:<dir>" and "kill:<dir>:<signal>", in order.
  log: string[];
  clock: number;
  sleeps: number[];
}

class FakeChild implements NodeChild {
  readonly exited: Promise<ExitInfo>;
  readonly index: number;
  readonly dir: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signals: NodeJS.Signals[] = [];
  exitedNow = false;
  private readonly world: World;
  private readonly ignoresTerm: boolean;
  private settle: (info: ExitInfo) => void = () => undefined;

  constructor(
    world: World,
    index: number,
    command: string,
    args: readonly string[],
    options: SpawnOptions,
    ignoresTerm: boolean,
  ) {
    this.world = world;
    this.index = index;
    this.command = command;
    this.args = args;
    this.cwd = options.cwd;
    this.env = options.env;
    this.dir = args[3] ?? '';
    this.ignoresTerm = ignoresTerm;
    this.exited = new Promise<ExitInfo>((resolve) => {
      this.settle = resolve;
    });
  }

  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    this.world.log.push(`kill:${this.dir}:${signal}`);
    if (signal === 'SIGTERM' && this.ignoresTerm) return;
    this.exit({ code: null, signal, stderr: '' });
  }

  exit(info: ExitInfo): void {
    if (this.exitedNow) return;
    this.exitedNow = true;
    this.settle(info);
  }
}

function rig(policy: Partial<Policy> = {}) {
  const rule: Policy = {
    serves: (dir) => path.basename(dir),
    dies: () => undefined,
    ignoresTerm: () => false,
    ...policy,
  };
  const world: World = { children: [], log: [], clock: 0, sleeps: [] };
  const pieces = {
    spawn: (
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ) => {
      const dir = args[3] ?? '';
      const child = new FakeChild(
        world,
        world.children.length,
        command,
        args,
        options,
        rule.ignoresTerm(dir),
      );
      world.children.push(child);
      world.log.push(`spawn:${dir}`);
      const died = rule.dies(dir, child.index);
      if (died !== undefined) child.exit(died);
      return child;
    },
    fetch: async (url: string, init: RequestInit): Promise<Response> => {
      const live = world.children.findLast((child) => !child.exitedNow);
      const bearer = new Headers(init.headers).get('Authorization');
      const bundleId =
        live === undefined ? null : rule.serves(live.dir, live.index);
      if (
        url !== CONFIG_URL ||
        bearer !== `Bearer ${INTERNAL}` ||
        bundleId === null
      ) {
        throw new TypeError('fetch failed');
      }
      return Response.json({
        editorOrigins: [ORIGIN],
        bundleId,
        protocolVersion: 1,
      });
    },
    parentEnv: PARENT,
    now: () => world.clock,
    sleep: async (ms: number) => {
      world.sleeps.push(ms);
      world.clock += ms;
    },
    readyTimeoutMs: 100,
    pollMs: 10,
    graceMs: 50,
  };
  return { world, pieces };
}

const BASE = {
  port: PORT,
  site: SITE,
  editorOrigin: ORIGIN,
  secrets: SECRETS,
  siteConfig: SITE_CONFIG,
  startScript: START,
};

/** A supervisor on a rig. The port probe is a fake that finds the port free. */
function make(
  fake: ReturnType<typeof rig>,
  extra: Partial<SupervisorOptions> = {},
) {
  return createSupervisor({
    ...BASE,
    ...fake.pieces,
    portInUse: async () => false,
    ...extra,
  });
}

function childAt(world: World, index: number): FakeChild {
  const child = world.children[index];
  if (child === undefined) throw new Error(`no node number ${index}`);
  return child;
}

/** The waits that are restart delays (the poll and the grace period are shorter). */
function backoffs(world: World): number[] {
  return world.sleeps.filter((ms) => ms >= 1_000);
}

function pick(env: NodeJS.ProcessEnv, names: readonly string[]) {
  return Object.fromEntries(names.map((name) => [name, env[name]]));
}

async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500 && !condition(); turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(condition()).toBe(true);
}

/** Waits in real time until `condition` holds, for the tests that run a real node. */
async function eventually(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition() && waited < 10_000; waited += 10) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
}

/** A port nobody listens on, found by binding port 0 and closing it again. */
async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Writes a stand-in for start.ts into `root/app` and returns its path. It is a real
 *  node that answers GET /__preview/config with its bundleId. The bundle `crash`
 *  exits once with an error on stderr, before it serves. */
function writeFakeStart(root: string): string {
  const file = path.join(root, 'app', 'start.mjs');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      "import fs from 'node:fs';",
      "import http from 'node:http';",
      "import path from 'node:path';",
      'const bundleId = path.basename(process.argv.at(-1));',
      "const marker = path.join(process.cwd(), bundleId + '.crashed');",
      "if (bundleId === 'crash' && !fs.existsSync(marker)) {",
      "  fs.writeFileSync(marker, '');",
      "  fs.writeSync(2, 'boom');",
      '  process.exit(3);',
      '}',
      'http',
      '  .createServer((req, res) => {',
      "    if (req.url === '/__preview/config' && req.headers.authorization === 'Bearer ' + process.env.PREVIEW_INTERNAL_SECRET) {",
      "      res.setHeader('content-type', 'application/json');",
      '      res.end(JSON.stringify({ editorOrigins: [process.env.PREVIEW_EDITOR_ORIGINS], bundleId, protocolVersion: 1 }));',
      '    } else {',
      '      res.statusCode = 404;',
      '      res.end();',
      '    }',
      '  })',
      '  .listen(Number(process.env.PORT), process.env.HOST);',
      '',
    ].join('\n'),
  );
  return file;
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('restartDelayMs', () => {
  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [4, 8_000],
    [5, 16_000],
    [6, 30_000],
    [9, 30_000],
  ])('waits %i failure(s) in a row: %i ms', (failures, ms) => {
    expect(restartDelayMs(failures)).toBe(ms);
  });
});

describe('childEnvironment', () => {
  it('passes only the allowlisted parent variables, then the preview settings', () => {
    expect(
      childEnvironment(PARENT, {
        port: PORT,
        site: SITE,
        editorOrigin: ORIGIN,
        secrets: SECRETS,
      }),
    ).toEqual({
      PATH: '/usr/bin',
      TMPDIR: '/tmp',
      SystemRoot: 'C:\\Windows',
      PREVIEW_EDITOR_ORIGINS: ORIGIN,
      PREVIEW_TOKEN_SECRET: TOKEN,
      PREVIEW_INTERNAL_SECRET: INTERNAL,
      PREVIEW_SITE: SITE,
      PORT: '4400',
      HOST: '127.0.0.1',
    });
  });
});

describe('createSupervisor start', () => {
  it('refuses two equal secrets when it is created', () => {
    const fake = rig();
    expect(() =>
      createSupervisor({
        ...BASE,
        ...fake.pieces,
        secrets: { previewTokenSecret: TOKEN, previewInternalSecret: TOKEN },
      }),
    ).toThrow(
      new Error('The preview token secret and the internal secret must differ'),
    );
  });

  it('starts start.ts with the site config and the bundle folder, and counts it ready when it answers the bundleId', async () => {
    const fake = rig();
    const supervisor = make(fake);
    expect(await supervisor.start(A)).toEqual({ ok: true });
    const child = childAt(fake.world, 0);
    expect(child.command).toBe(process.execPath);
    expect(child.args).toEqual([START, SITE_CONFIG, '--out', '/bundles/a']);
    expect(child.cwd).toBe(path.resolve(path.dirname(START), '..'));
    expect(
      pick(child.env, [
        'PREVIEW_EDITOR_ORIGINS',
        'PREVIEW_TOKEN_SECRET',
        'PREVIEW_INTERNAL_SECRET',
        'PREVIEW_SITE',
        'PORT',
        'HOST',
      ]),
    ).toEqual({
      PREVIEW_EDITOR_ORIGINS: ORIGIN,
      PREVIEW_TOKEN_SECRET: TOKEN,
      PREVIEW_INTERNAL_SECRET: INTERNAL,
      PREVIEW_SITE: SITE,
      PORT: '4400',
      HOST: '127.0.0.1',
    });
    expect(supervisor.status()).toEqual({
      state: 'ready',
      port: PORT,
      bundleId: 'a',
      failures: 0,
      error: null,
    });
  });

  it('gives the node no variable of the parent that is not on the allowlist', async () => {
    const fake = rig();
    await make(fake).start(A);
    expect(childAt(fake.world, 0).env).toEqual({
      PATH: '/usr/bin',
      TMPDIR: '/tmp',
      SystemRoot: 'C:\\Windows',
      PREVIEW_EDITOR_ORIGINS: ORIGIN,
      PREVIEW_TOKEN_SECRET: TOKEN,
      PREVIEW_INTERNAL_SECRET: INTERNAL,
      PREVIEW_SITE: SITE,
      PORT: '4400',
      HOST: '127.0.0.1',
    });
  });

  it('never counts a node that answers another bundleId as ready, and gives up after five', async () => {
    const fake = rig({ serves: () => 'stale' });
    const supervisor = make(fake);
    expect(await supervisor.start(A)).toEqual({
      ok: false,
      error:
        'Bundle a did not answer GET /__preview/config with its bundleId within 100 ms',
    });
    expect(fake.world.children).toHaveLength(5);
    expect(backoffs(fake.world)).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(supervisor.status()).toEqual({
      state: 'failed',
      port: PORT,
      bundleId: 'a',
      failures: 5,
      error:
        'Bundle a did not answer GET /__preview/config with its bundleId within 100 ms',
    });
  });

  it('restarts a crashed node after 1, 2, 4 and 8 s, and gives up after the fifth crash', async () => {
    const died: ExitInfo = { code: 1, signal: null, stderr: 'boom' };
    const fake = rig({ dies: () => died });
    const supervisor = make(fake);
    expect(await supervisor.start(A)).toEqual({
      ok: false,
      error: 'The preview node exited (code 1, signal none): boom',
    });
    expect(fake.world.children).toHaveLength(5);
    expect(backoffs(fake.world)).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(supervisor.status()).toMatchObject({ state: 'failed', failures: 5 });
  });

  it('refuses to start while another process holds the port, and names the port', async () => {
    const fake = rig();
    const supervisor = make(fake, { portInUse: async () => true });
    expect(await supervisor.start(A)).toEqual({
      ok: false,
      error:
        'Port 4400 is already in use: the preview node cannot listen on it. Stop the other process or choose another port.',
    });
    expect(fake.world.children).toHaveLength(0);
    expect(supervisor.status()).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('Port 4400'),
    });
  });

  it('probes the real port when none is injected, and refuses a port another process holds', async () => {
    const holder = net.createServer();
    await new Promise<void>((resolve) => {
      holder.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = holder.address() as net.AddressInfo;
    const fake = rig();
    const supervisor = createSupervisor({ ...BASE, ...fake.pieces, port });
    try {
      expect(await supervisor.start(A)).toEqual({
        ok: false,
        error: `Port ${port} is already in use: the preview node cannot listen on it. Stop the other process or choose another port.`,
      });
      expect(fake.world.children).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });

  it('gives the port error at once when the node exits with EADDRINUSE, with no retry', async () => {
    const fake = rig({
      dies: () => ({
        code: 1,
        signal: null,
        stderr:
          'Error: listen EADDRINUSE: address already in use 127.0.0.1:4400',
      }),
    });
    const supervisor = make(fake);
    expect(await supervisor.start(A)).toEqual({
      ok: false,
      error:
        'Port 4400 is already in use: the preview node cannot listen on it. Stop the other process or choose another port.',
    });
    expect(fake.world.children).toHaveLength(1);
    expect(backoffs(fake.world)).toEqual([]);
  });

  it('stop() terminates the node and does not restart it', async () => {
    const fake = rig();
    const supervisor = make(fake);
    await supervisor.start(A);
    await supervisor.stop();
    expect(childAt(fake.world, 0).signals).toEqual(['SIGTERM']);
    expect(supervisor.status()).toEqual({
      state: 'stopped',
      port: PORT,
      bundleId: null,
      failures: 0,
      error: null,
    });
    await flush();
    expect(fake.world.children).toHaveLength(1);
  });

  it('stop() during a restart wait cancels the restart, and the pending start resolves', async () => {
    const fake = rig({ dies: () => ({ code: 1, signal: null, stderr: '' }) });
    let reachedWait: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      reachedWait = resolve;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const supervisor = make(fake, {
      sleep: async (ms: number) => {
        if (ms < 1_000) return;
        reachedWait();
        await gate;
      },
    });
    const starting = supervisor.start(A);
    await waiting;
    const stopped = supervisor.stop();
    release();
    await stopped;
    expect(await starting).toEqual({
      ok: false,
      error: 'The node was stopped before it was ready',
    });
    expect(fake.world.children).toHaveLength(1);
  });
});

describe('createSupervisor failure count', () => {
  it('counts crashes before the node has stayed up for a minute', async () => {
    // The first two nodes die at once; the third stays up.
    const fake = rig({
      dies: (_dir, index) =>
        index < 2 ? { code: 1, signal: null, stderr: '' } : undefined,
    });
    const supervisor = make(fake);
    expect(await supervisor.start(A)).toEqual({ ok: true });
    expect(backoffs(fake.world)).toEqual([1_000, 2_000]);
    expect(supervisor.status().failures).toBe(2);
  });

  it.each([
    [59_999, [1_000, 2_000, 4_000]],
    [60_000, [1_000, 2_000, 1_000]],
  ])(
    'a node that is up for %i ms before it crashes: backoffs %j',
    async (upMs, expected) => {
      const fake = rig({
        dies: (_dir, index) =>
          index < 2 ? { code: 1, signal: null, stderr: '' } : undefined,
      });
      const supervisor = make(fake);
      expect(await supervisor.start(A)).toEqual({ ok: true });
      fake.world.clock += upMs;
      childAt(fake.world, 2).exit({ code: 1, signal: null, stderr: '' });
      await until(
        () =>
          fake.world.children.length === 4 &&
          supervisor.status().state === 'ready',
      );
      expect(backoffs(fake.world)).toEqual(expected);
    },
  );
});

describe('createSupervisor swap', () => {
  it('starts the bundle when nothing runs yet', async () => {
    const fake = rig();
    const supervisor = make(fake);
    expect(await supervisor.swap(B)).toEqual({ ok: true });
    expect(fake.world.log).toEqual(['spawn:/bundles/b']);
  });

  it('stops the old node, which exits before the new one starts, and serves the new bundle on the same port', async () => {
    const fake = rig();
    const supervisor = make(fake);
    await supervisor.start(A);
    expect(await supervisor.swap(B)).toEqual({ ok: true });
    expect(fake.world.log).toEqual([
      'spawn:/bundles/a',
      'kill:/bundles/a:SIGTERM',
      'spawn:/bundles/b',
    ]);
    const next = childAt(fake.world, 1);
    expect(next.args).toEqual([START, SITE_CONFIG, '--out', '/bundles/b']);
    expect(next.env.PORT).toBe('4400');
    expect(supervisor.status()).toEqual({
      state: 'ready',
      port: PORT,
      bundleId: 'b',
      failures: 0,
      error: null,
    });
  });

  it('kills the old node after the grace period when it ignores SIGTERM', async () => {
    const fake = rig({ ignoresTerm: (dir) => dir === A.dir });
    const supervisor = make(fake);
    await supervisor.start(A);
    expect(await supervisor.swap(B)).toEqual({ ok: true });
    expect(childAt(fake.world, 0).signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(fake.world.log).toEqual([
      'spawn:/bundles/a',
      'kill:/bundles/a:SIGTERM',
      'kill:/bundles/a:SIGKILL',
      'spawn:/bundles/b',
    ]);
  });

  it('rolls back to the previous bundle when the new one never answers', async () => {
    const fake = rig({
      serves: (dir) => (dir === B.dir ? null : path.basename(dir)),
    });
    const supervisor = make(fake);
    await supervisor.start(A);
    expect(await supervisor.swap(B)).toEqual({
      ok: false,
      error:
        'Bundle b did not answer GET /__preview/config with its bundleId within 100 ms',
      rolledBack: true,
    });
    expect(fake.world.log).toEqual([
      'spawn:/bundles/a',
      'kill:/bundles/a:SIGTERM',
      'spawn:/bundles/b',
      'kill:/bundles/b:SIGTERM',
      'spawn:/bundles/a',
    ]);
    expect(supervisor.status()).toEqual({
      state: 'ready',
      port: PORT,
      bundleId: 'a',
      failures: 0,
      error: null,
    });
  });

  it('reports rolledBack false when the previous bundle does not come back either', async () => {
    const fake = rig({ serves: (_dir, index) => (index === 0 ? 'a' : null) });
    const supervisor = make(fake);
    await supervisor.start(A);
    expect(await supervisor.swap(B)).toEqual({
      ok: false,
      error:
        'Bundle b did not answer GET /__preview/config with its bundleId within 100 ms',
      rolledBack: false,
    });
    expect(supervisor.status().state).toBe('failed');
  });
});

// The real defaults (spawn, fetch, port probe, timers): each test runs a real node
// on a free port, from a fake start.ts in its own temp folder.
describe('createSupervisor with the real defaults', () => {
  it('spawns a real node, counts it ready on the real probe and fetch, and stop() kills it', async () => {
    const root = await makeTestRoot();
    const port = await freePort();
    const supervisor = createSupervisor({
      ...BASE,
      port,
      startScript: writeFakeStart(root),
    });
    try {
      expect(await supervisor.start(A)).toEqual({ ok: true });
      expect(supervisor.status()).toEqual({
        state: 'ready',
        port,
        bundleId: 'a',
        failures: 0,
        error: null,
      });
      await supervisor.stop();
      expect(supervisor.status()).toEqual({
        state: 'stopped',
        port,
        bundleId: null,
        failures: 0,
        error: null,
      });
    } finally {
      await supervisor.stop();
      await removeTestRoot(root);
    }
  }, 15_000);

  it('keeps the stderr of a node that crashes, restarts it, and counts the crash', async () => {
    const root = await makeTestRoot();
    const port = await freePort();
    const supervisor = createSupervisor({
      ...BASE,
      port,
      startScript: writeFakeStart(root),
    });
    try {
      const starting = supervisor.start({
        bundleId: 'crash',
        dir: path.join(root, 'bundles', 'crash'),
      });
      await eventually(() => supervisor.status().state === 'restarting');
      expect(supervisor.status().error).toBe(
        'The preview node exited (code 3, signal none): boom',
      );
      expect(await starting).toEqual({ ok: true });
      expect(supervisor.status()).toEqual({
        state: 'ready',
        port,
        bundleId: 'crash',
        failures: 1,
        error: null,
      });
    } finally {
      await supervisor.stop();
      await removeTestRoot(root);
    }
  }, 15_000);

  it('reports a node that cannot start in a missing folder as a failed attempt, and stop() ends the wait', async () => {
    const root = await makeTestRoot();
    const port = await freePort();
    const supervisor = createSupervisor({
      ...BASE,
      port,
      // The node runs in the parent of the script's folder: `root/missing`, which is absent.
      startScript: path.join(root, 'missing', 'app', 'start.mjs'),
    });
    try {
      const starting = supervisor.start(A);
      await eventually(() => supervisor.status().state === 'restarting');
      expect(supervisor.status()).toEqual({
        state: 'restarting',
        port,
        bundleId: 'a',
        failures: 1,
        error: `The preview node exited (code none, signal none): spawn ${process.execPath} ENOENT`,
      });
      await supervisor.stop();
      expect(await starting).toEqual({
        ok: false,
        error: 'The node was stopped before it was ready',
      });
    } finally {
      await supervisor.stop();
      await removeTestRoot(root);
    }
  }, 15_000);
});
