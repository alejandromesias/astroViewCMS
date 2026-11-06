import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import type { Logger } from '../log.ts';
import {
  type BuildCommitOptions,
  type BuildExit,
  childEnvironment,
  createBuilder,
  defaultSpawn,
  type SpawnBuild,
  type WorktreeLock,
} from './build-commit.ts';
import type { BuildJob } from './build-runner.ts';

const SITE = 'demo';
const SITE_DIR = 'site';
const SITE_CONFIG = '/configs/sample-site.config.ts';
const JOB: BuildJob = { commit: 'c1', bundleId: 'b1' };
// What the test process gives to the build: the allowlisted names, and secrets and git settings that must not go on.
const PARENT = {
  PATH: '/bin',
  TMPDIR: '/tmp',
  NODE_OPTIONS: '--max-old-space-size=4096',
  PREVIEW_TOKEN_SECRET: 'leaked',
  PREVIEW_INTERNAL_SECRET: 'leaked',
  SSH_AUTH_SOCK: '/agent.sock',
  GIT_DIR: '/repo/.git',
  GITHUB_TOKEN: 'leaked',
};
const ALLOWED = new Set([
  'PATH',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SYSTEMROOT',
  'WINDIR',
  'NODE_OPTIONS',
]);

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

interface LogCall {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields:
    | Record<string, string | number | boolean | string[]>
    | undefined;
}

let root: string;
let cmsDir: string;
let buildScript: string;
let events: string[];
let spawned: SpawnCall[];
let kills: NodeJS.Signals[];
let logged: LogCall[];

beforeEach(async () => {
  root = await makeTestRoot();
  cmsDir = path.join(root, '.cms');
  buildScript = path.join(root, 'renderer', 'src', 'build.ts');
  events = [];
  spawned = [];
  kills = [];
  logged = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await removeTestRoot(root);
});

// The worktree repo of the tests. Every lock and worktree call is recorded in `events`. `addError` makes the
// worktree fail to be added, and `removeError` makes its removal fail.
function fakeRepo(addError?: Error, removeError?: Error): WorktreeLock {
  return {
    async locked(holder, work) {
      events.push(`lock ${holder}`);
      return work({
        async worktreeAdd(ref, name) {
          events.push(`add ${ref} ${name}`);
          if (addError !== undefined) throw addError;
          return path.join(cmsDir, SITE, 'worktrees', name);
        },
        async worktreeRemove(name) {
          events.push(`remove ${name}`);
          if (removeError !== undefined) throw removeError;
        },
      });
    },
  };
}

// A child that ends with `exit` at once, or never ends (`'never'`) until it is killed. Each spawn is recorded.
function fakeSpawn(
  exit: BuildExit | 'never' = { code: 0, signal: null, output: '' },
): SpawnBuild {
  return (command, args, options) => {
    spawned.push({ command, args, cwd: options.cwd, env: options.env });
    let end: (value: BuildExit) => void = () => undefined;
    const exited = new Promise<BuildExit>((resolve) => {
      end = resolve;
    });
    if (exit !== 'never') end(exit);
    return {
      exited,
      kill: (signal) => {
        kills.push(signal);
        end({ code: null, signal, output: 'killed\n' });
      },
    };
  };
}

function recordingLog(): Logger {
  const record =
    (level: LogCall['level']) =>
    (message: string, fields?: LogCall['fields']) => {
      logged.push({ level, message, fields });
    };
  return { info: record('info'), warn: record('warn'), error: record('error') };
}

function builderWith(overrides: Partial<BuildCommitOptions> = {}) {
  return createBuilder({
    repo: fakeRepo(),
    cmsDir,
    site: SITE,
    siteDir: SITE_DIR,
    siteConfig: SITE_CONFIG,
    buildScript,
    spawn: fakeSpawn(),
    parentEnv: PARENT,
    log: recordingLog(),
    ...overrides,
  });
}

const bundlesDir = () => path.join(cmsDir, SITE, 'bundles');
const bundleDir = (id: string) => path.join(bundlesDir(), id);
const logPath = (id: string) => path.join(cmsDir, SITE, 'logs', `${id}.log`);
const worktreeSite = () =>
  path.join(cmsDir, SITE, 'worktrees', 'build-b1', SITE_DIR);

describe('createBuilder', () => {
  it('builds the commit in a worktree, then removes the worktree', async () => {
    const build = builderWith({
      spawn: fakeSpawn({ code: 0, signal: null, output: 'built\n' }),
    });
    expect(await build(JOB)).toEqual({
      bundleId: 'b1',
      dir: bundleDir('b1'),
      ok: true,
      firstError: null,
    });
    expect(events).toEqual([
      'lock build b1',
      'add c1 build-b1',
      'lock build b1',
      'remove build-b1',
    ]);
    expect(kills).toEqual([]);
  });

  it('runs build.ts on the site folder of the worktree, into the bundle folder, with the bundle id', async () => {
    await builderWith()(JOB);
    expect(spawned).toEqual([
      {
        command: process.execPath,
        args: [
          buildScript,
          SITE_CONFIG,
          '--root',
          worktreeSite(),
          '--out',
          bundleDir('b1'),
          '--bundle-id',
          'b1',
        ],
        cwd: path.join(root, 'renderer'),
        env: {
          PATH: '/bin',
          TMPDIR: '/tmp',
          NODE_OPTIONS: '--max-old-space-size=4096',
        },
      },
    ]);
  });

  it('writes the log of the build to the logs folder', async () => {
    await builderWith({
      spawn: fakeSpawn({ code: 0, signal: null, output: 'built\n' }),
    })(JOB);
    expect(await readFile(logPath('b1'), 'utf8')).toBe(
      'commit c1\nbundle b1\nresult ok\n\nbuilt\n',
    );
    expect(logged).toEqual([
      {
        level: 'info',
        message: 'Build finished',
        fields: { bundleId: 'b1', commit: 'c1', ok: true },
      },
    ]);
  });

  it('gives the build only the allowlisted variables, so no token, SSH setting or GIT_* variable reaches it', async () => {
    await builderWith({
      parentEnv: {
        Path: '/bin',
        TMPDIR: '/tmp',
        SYSTEMROOT: 'C:\\Windows',
        NODE_OPTIONS: '--max-old-space-size=4096',
        PREVIEW_TOKEN_SECRET: 'leaked',
        PREVIEW_INTERNAL_SECRET: 'leaked',
        SSH_AUTH_SOCK: '/agent.sock',
        GIT_DIR: '/repo/.git',
        GITHUB_TOKEN: 'leaked',
        UNSET: undefined,
      },
    })(JOB);
    expect(spawned[0]?.env).toEqual({
      Path: '/bin',
      TMPDIR: '/tmp',
      SYSTEMROOT: 'C:\\Windows',
      NODE_OPTIONS: '--max-old-space-size=4096',
    });
  });

  it('reads the environment of cms-server when no parent environment is given', async () => {
    vi.stubEnv('CMS_TEST_LEAK', 'leaked');
    const build = createBuilder({
      repo: fakeRepo(),
      cmsDir,
      site: SITE,
      siteDir: SITE_DIR,
      siteConfig: SITE_CONFIG,
      buildScript,
      spawn: fakeSpawn(),
      log: recordingLog(),
    });
    await build(JOB);
    const env = spawned[0]?.env ?? {};
    expect(env).not.toHaveProperty('CMS_TEST_LEAK');
    expect(
      Object.keys(env).every((name) => ALLOWED.has(name.toUpperCase())),
    ).toBe(true);
  });

  it('removes the bundle folder of a failed build, and reports the first error of its output', async () => {
    await mkdir(path.join(bundleDir('b1'), 'manifest'), { recursive: true });
    await mkdir(`${bundleDir('b1')}-regions`);
    // The first location is outside the site folder, so it is not the failing file.
    const output = [
      `file:///C:/repo/node_modules/astro/compile.js:63:9`,
      `[plugin astro:build] ${worktreeSite().replaceAll('\\', '/')}/src/pages/broken.astro:2:14`,
      'CompilerError: Unexpected token',
      '',
    ].join('\n');
    const build = builderWith({
      spawn: fakeSpawn({ code: 1, signal: null, output }),
    });
    expect(await build(JOB)).toEqual({
      bundleId: 'b1',
      dir: bundleDir('b1'),
      ok: false,
      firstError: {
        file: 'src/pages/broken.astro',
        message: 'CompilerError: Unexpected token',
      },
    });
    expect(existsSync(bundleDir('b1'))).toBe(false);
    expect(existsSync(`${bundleDir('b1')}-regions`)).toBe(false);
    expect(events).toContain('remove build-b1');
  });

  it.each([
    {
      output: 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module x\n',
      message: 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module x',
    },
    {
      output: 'stopped\n',
      message: 'The build exited (code 3, signal none)',
    },
  ])(
    'reports the error line of a failed build with no located error: $message',
    async ({ output, message }) => {
      const build = builderWith({
        spawn: fakeSpawn({ code: 3, signal: null, output }),
      });
      expect(await build(JOB)).toMatchObject({
        ok: false,
        firstError: { file: null, message },
      });
    },
  );

  it('kills a build that runs over the timeout, and fails with the timeout message', async () => {
    const build = builderWith({ spawn: fakeSpawn('never'), timeoutMs: 20 });
    expect(await build(JOB)).toEqual({
      bundleId: 'b1',
      dir: bundleDir('b1'),
      ok: false,
      firstError: {
        file: null,
        message: 'The build did not finish within 20 ms',
      },
    });
    expect(kills).toEqual(['SIGKILL']);
    expect(events).toEqual([
      'lock build b1',
      'add c1 build-b1',
      'lock build b1',
      'remove build-b1',
    ]);
  });

  it('reports a commit that cannot be added as a worktree as a failed build, with no child started', async () => {
    const build = builderWith({
      repo: fakeRepo(new Error('fatal: invalid reference: c1')),
    });
    expect(await build(JOB)).toEqual({
      bundleId: 'b1',
      dir: bundleDir('b1'),
      ok: false,
      firstError: { file: null, message: 'fatal: invalid reference: c1' },
    });
    expect(spawned).toEqual([]);
    expect(events).toEqual(['lock build b1', 'add c1 build-b1']);
    expect(await readFile(logPath('b1'), 'utf8')).toBe(
      'commit c1\nbundle b1\nresult failed\n\nfatal: invalid reference: c1',
    );
  });

  it('deletes a worktree that git cannot remove, logs why, and the build result stands', async () => {
    const folder = worktreeSite();
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'index.html'), '<h1>built</h1>\n');
    const build = builderWith({
      spawn: fakeSpawn({ code: 0, signal: null, output: '' }),
      repo: fakeRepo(undefined, new Error('locked by another process')),
    });
    expect(await build(JOB)).toMatchObject({ ok: true, firstError: null });
    expect(existsSync(path.join(cmsDir, SITE, 'worktrees', 'build-b1'))).toBe(
      false,
    );
    expect(logged[0]).toEqual({
      level: 'warn',
      message: 'Could not remove the build worktree',
      fields: {
        worktree: 'build-b1',
        error: 'locked by another process',
        stderr: '',
      },
    });
  });

  it('collects the old bundles after a build, keeping the two newest', async () => {
    for (const [id, written] of [
      ['old', 1_000_000],
      ['mid', 2_000_000],
      ['new', 3_000_000],
    ] as const) {
      const file = path.join(bundleDir(id), 'manifest', 'bundle.json');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, '{}\n');
      const time = new Date(written);
      await utimes(file, time, time);
    }
    await builderWith()(JOB);
    expect(existsSync(bundleDir('old'))).toBe(false);
    expect(existsSync(bundleDir('mid'))).toBe(true);
    expect(existsSync(bundleDir('new'))).toBe(true);
  });

  // A bundle folder with a manifest, as a build that got that far leaves it.
  async function writeManifest(id: string): Promise<void> {
    const file = path.join(bundleDir(id), 'manifest', 'bundle.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{}\n');
  }

  it('removes the bundle folder of a failed build even when it holds a manifest, and keeps that of a good build', async () => {
    await writeManifest('b1');
    await builderWith({
      spawn: fakeSpawn({ code: 1, signal: null, output: 'failed\n' }),
    })(JOB);
    expect(existsSync(bundleDir('b1'))).toBe(false);

    await writeManifest('b1');
    await builderWith()(JOB);
    expect(existsSync(bundleDir('b1'))).toBe(true);
  });

  it('leaves no timer behind when the build ends before the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await builderWith()(JOB);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a located error through colour codes, indentation and blank lines', async () => {
    const location = `${worktreeSite().replaceAll('\\', '/')}/src/pages/a.astro:2:14`;
    const output = [
      `  \u001b[31m[plugin astro:build]\u001b[39m ${location}  `,
      '',
      '  CompilerError: Unexpected token  ',
    ].join('\n');
    expect(
      await builderWith({
        spawn: fakeSpawn({ code: 1, signal: null, output }),
      })(JOB),
    ).toMatchObject({
      firstError: {
        file: 'src/pages/a.astro',
        message: 'CompilerError: Unexpected token',
      },
    });
  });

  it('reads a location with backslashes, and the message on the same line', async () => {
    const output = `${worktreeSite()}\\src\\pages\\a.astro:5:1: boom\n`;
    expect(
      await builderWith({
        spawn: fakeSpawn({ code: 1, signal: null, output }),
      })(JOB),
    ).toMatchObject({
      firstError: { file: 'src/pages/a.astro', message: 'boom' },
    });
  });

  it('reads a located error when the site folder ends with a slash', async () => {
    const location = `${worktreeSite().replaceAll('\\', '/')}/src/x.astro:1:1`;
    const output = `${location}\nbad token\n`;
    expect(
      await builderWith({
        siteDir: `${SITE_DIR}/`,
        spawn: fakeSpawn({ code: 1, signal: null, output }),
      })(JOB),
    ).toMatchObject({
      firstError: { file: 'src/x.astro', message: 'bad token' },
    });
  });

  it('names the file when a located error has no message on its line or after it', async () => {
    const location = `${worktreeSite().replaceAll('\\', '/')}/src/x.astro`;
    const output = `${location}:1:1\n`;
    expect(
      await builderWith({
        spawn: fakeSpawn({ code: 1, signal: null, output }),
      })(JOB),
    ).toMatchObject({
      firstError: {
        file: 'src/x.astro',
        message: `The build failed in ${location}`,
      },
    });
  });

  it('reports a build that was stopped by a signal with no exit code', async () => {
    expect(
      await builderWith({
        spawn: fakeSpawn({ code: null, signal: 'SIGTERM', output: '' }),
      })(JOB),
    ).toMatchObject({
      firstError: {
        file: null,
        message: 'The build exited (code none, signal SIGTERM)',
      },
    });
  });

  it('does not log a second warning when git cannot remove a worktree whose folder is already gone', async () => {
    await builderWith({
      repo: fakeRepo(undefined, new Error('locked by another process')),
    })(JOB);
    expect(logged.map((call) => call.message)).toEqual([
      'Could not remove the build worktree',
      'Build finished',
    ]);
  });

  it('logs when the folder of a worktree cannot be deleted either, and the build result stands', async () => {
    // A path with a null byte makes fs.rm reject, on every platform.
    const repo: WorktreeLock = {
      locked: (_holder, work) =>
        work({
          worktreeAdd: async () => 'bad\0folder',
          worktreeRemove: async () => {
            throw new Error('locked by another process');
          },
        }),
    };
    expect(await builderWith({ repo })(JOB)).toMatchObject({ ok: true });
    expect(logged[1]).toMatchObject({
      level: 'warn',
      message: 'Could not delete the build worktree folder',
      fields: { worktree: 'build-b1' },
    });
    expect(String(logged[1]?.fields?.error)).toContain('null bytes');
  });

  it('logs when the old bundles cannot be collected, and the build result stands', async () => {
    // The child replaces the bundles folder with a file, so the folder cannot be listed.
    const spawn: SpawnBuild = () => ({
      exited: rm(bundlesDir(), { recursive: true, force: true })
        .then(() => writeFile(bundlesDir(), 'not a folder'))
        .then(() => ({ code: 0, signal: null, output: '' })),
      kill: () => undefined,
    });
    expect(await builderWith({ spawn })(JOB)).toMatchObject({ ok: true });
    expect(logged[0]).toMatchObject({
      level: 'warn',
      message: 'Could not collect the old bundles',
      fields: { bundleId: 'b1' },
    });
    expect(typeof logged[0]?.fields?.error).toBe('string');
  });
});

describe('defaultSpawn', () => {
  const run = (script: string, env: NodeJS.ProcessEnv = {}) =>
    defaultSpawn(process.execPath, ['-e', script], { cwd: root, env });

  it('keeps stdout and stderr together in the order they arrive, with the exit code', async () => {
    const child = run(
      "process.stdout.write('out '); setTimeout(() => process.stderr.write('err\\n'), 200)",
    );
    expect(await child.exited).toEqual({
      code: 0,
      signal: null,
      output: 'out err\n',
    });
  });

  it('reports the exit code of a failed child', async () => {
    expect(await run('process.exit(3)').exited).toEqual({
      code: 3,
      signal: null,
      output: '',
    });
  });

  it('runs in the given folder, with only the given environment', async () => {
    vi.stubEnv('PARENT_ONLY', 'leaked');
    const child = run(
      'console.log(JSON.stringify([process.cwd(), process.env.CHILD_VAR, process.env.PARENT_ONLY ?? null]))',
      { CHILD_VAR: 'x' },
    );
    const [cwd, childVar, parentOnly] = JSON.parse((await child.exited).output);
    expect(realpathSync(cwd)).toBe(realpathSync(root));
    expect(childVar).toBe('x');
    expect(parentOnly).toBeNull();
  });

  it('closes the input of the child', async () => {
    const child = run(
      "process.stdin.on('end', () => console.log('eof')).resume()",
    );
    expect((await child.exited).output).toBe('eof\n');
  });

  it('decodes output as UTF-8 even when a character arrives in two chunks', async () => {
    const child = run(
      'process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9])), 200)',
    );
    expect((await child.exited).output).toBe('é');
  });

  it('settles with the error message when the command cannot be started', async () => {
    const command = path.join(root, 'no-such-command');
    const child = defaultSpawn(command, [], { cwd: root, env: {} });
    expect(await child.exited).toEqual({
      code: null,
      signal: null,
      output: `spawn ${command} ENOENT\n`,
    });
  });

  it('kills the child with the signal given', async () => {
    const child = run('setInterval(() => undefined, 1000)');
    child.kill('SIGKILL');
    expect(await child.exited).toEqual({
      code: null,
      signal: 'SIGKILL',
      output: '',
    });
  });
});

describe('childEnvironment', () => {
  it('drops an allowlisted name that has no value', () => {
    expect(
      Object.keys(childEnvironment({ PATH: undefined, TMP: '/t' })),
    ).toEqual(['TMP']);
  });

  it('keeps only the allowlisted names, matched without case', () => {
    expect(
      childEnvironment({
        Path: '/bin',
        SystemRoot: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
        LOGNAME: 'me',
        HOME: '/home/me',
      }),
    ).toEqual({
      Path: '/bin',
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
    });
  });
});
