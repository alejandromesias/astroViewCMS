// @ts-nocheck
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertRef,
  assertRelativePath,
  assertRemoteUrl,
  type ExecFn,
  type ExecOptions,
  type ExecResult,
  GitError,
  realExec,
  runGit,
} from './exec.ts';

// The GitError that `run` throws. Fails the test if it returns, or throws anything else.
function gitErrorOf(run: () => unknown): GitError {
  try {
    run();
  } catch (error) {
    if (error instanceof GitError) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}

async function gitErrorOfAsync(run: () => Promise<unknown>): Promise<GitError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof GitError) return error;
    throw error;
  }
  throw new Error('expected the call to reject');
}

interface Call {
  file: string;
  args: readonly string[];
  options: ExecOptions;
}

// A fake `exec` that records its calls and answers with `reply` (a result, or an error to reject with).
function fakeExec(reply: ExecResult | Error | string): {
  exec: ExecFn;
  calls: Call[];
} {
  const calls: Call[] = [];
  const exec: ExecFn = (file, args, options) => {
    calls.push({ file, args, options });
    if (typeof reply === 'string' || reply instanceof Error)
      return Promise.reject(reply);
    return Promise.resolve(reply);
  };
  return { exec, calls };
}

function execError(message: string, props: Record<string, unknown>): Error {
  return Object.assign(new Error(message), props);
}

describe('assertRef', () => {
  it.each([
    'main',
    'cms/work',
    'feature-1',
    'v1.2.3',
    'a.locks',
    'a@b',
    'a{b',
    'lock',
    'a/b/c',
  ])('accepts the ref %s', (ref) => {
    expect(() => assertRef(ref)).not.toThrow();
  });

  it.each([
    ['a leading dash', '-x'],
    ['an option-like name', '--upload-pack=evil'],
    ['an empty name', ''],
    ['a space', 'a b'],
    ['a tab', 'a\tb'],
    ['a newline', 'a\nb'],
    ['a NUL', 'a\u0000b'],
    ['DEL', 'a\u007fb'],
    ['~', 'a~b'],
    ['^', 'a^b'],
    [':', 'a:b'],
    ['?', 'a?b'],
    ['*', 'a*b'],
    ['[', 'a[b'],
    ['a backslash', 'a\\b'],
    ['..', 'a..b'],
    ['@{', 'a@{b'],
    ['//', 'a//b'],
    ['a trailing slash', 'a/'],
    ['a .lock suffix', 'a.lock'],
  ])('refuses a ref with %s before any spawn', (_label, ref) => {
    expect(gitErrorOf(() => assertRef(ref))).toMatchObject({
      name: 'GitError',
      kind: 'invalid-argument',
      message: `invalid ref: ${JSON.stringify(ref)}`,
    });
  });

  it('gives a refused ref an empty args list (no git call was made)', () => {
    expect(gitErrorOf(() => assertRef('')).args).toEqual([]);
  });
});

describe('assertRelativePath', () => {
  it.each([
    'pages/home.md',
    '.',
    'src/config/config.json',
    'a..b',
    'a/-b',
    'a-b',
    'a\\b',
    'notes/a:b.txt',
  ])('accepts the path %s', (path) => {
    expect(() => assertRelativePath(path)).not.toThrow();
  });

  it.each([
    ['an empty path', ''],
    ['a leading dash', '-rf'],
    ['an absolute POSIX path', '/etc/passwd'],
    ['an absolute Windows path', '\\x'],
    ['a drive path', 'C:/x'],
    ['a drive-relative path', 'C:x'],
    ['a parent segment', '../x'],
    ['a parent segment in the middle', 'a/../b'],
    ['a backslash parent segment', 'a\\..\\b'],
    ['only a parent segment', '..'],
    ['a NUL', 'a\u0000b'],
  ])('refuses %s', (_label, path) => {
    expect(gitErrorOf(() => assertRelativePath(path))).toMatchObject({
      kind: 'invalid-argument',
      message: `invalid path: ${JSON.stringify(path)}`,
    });
  });
});

describe('assertRemoteUrl', () => {
  it.each([
    'git@github.com:owner/site.git',
    'https://example.com/x.git',
    '/local/path',
    'file:///x',
    'ext:x',
    'https://example.com/ext::x',
  ])('accepts the URL %s', (url) => {
    expect(() => assertRemoteUrl(url)).not.toThrow();
  });

  it.each([
    ['an empty URL', ''],
    ['a leading dash', '-oProxyCommand=x'],
    ['the ext transport', 'ext::sh -c x'],
    ['the ext transport in capitals', 'EXT::x'],
  ])('refuses %s', (_label, url) => {
    expect(gitErrorOf(() => assertRemoteUrl(url)).kind).toBe(
      'invalid-argument',
    );
  });

  it('redacts the credentials in the message of a refused URL', () => {
    expect(
      gitErrorOf(() => assertRemoteUrl('-u@https://u:secret@host/x.git'))
        .message,
    ).toBe('invalid remote URL: "-u@https://***@host/x.git"');
  });
});

describe('runGit', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns stdout and runs git with the fixed command prefix and no shell', async () => {
    const { exec, calls } = fakeExec({
      stdout: 'On branch main\n',
      stderr: '',
    });
    expect(
      await runGit(['status', '--porcelain'], { cwd: '/repo', exec }),
    ).toBe('On branch main\n');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      file: 'git',
      args: ['-c', 'protocol.ext.allow=never', 'status', '--porcelain'],
      options: { cwd: '/repo', timeout: 60_000, maxBuffer: 33_554_432 },
    });
  });

  it('passes a longer timeout when the caller asks for one', async () => {
    const { exec, calls } = fakeExec({ stdout: '', stderr: '' });
    await runGit(['clone', 'x'], { cwd: '/repo', timeoutMs: 600_000, exec });
    expect(calls[0]?.options.timeout).toBe(600_000);
  });

  it('sets the fixed environment over the caller environment and the inherited one', async () => {
    vi.stubEnv('CMS_GIT_TEST_INHERIT', 'yes');
    const { exec, calls } = fakeExec({ stdout: '', stderr: '' });
    await runGit(['status'], {
      cwd: '/repo',
      env: { GIT_TERMINAL_PROMPT: '1', CMS_EXTRA: 'x' },
      exec,
    });
    expect(calls[0]?.options.env).toMatchObject({
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      LC_ALL: 'C',
      CMS_EXTRA: 'x',
      CMS_GIT_TEST_INHERIT: 'yes',
    });
  });

  it('sets an empty askpass and a non-interactive SSH command when the environment sets no SSH command', async () => {
    vi.stubEnv('GIT_SSH_COMMAND', '');
    const { exec, calls } = fakeExec({ stdout: '', stderr: '' });
    await runGit(['fetch'], {
      cwd: '/repo',
      env: { GIT_ASKPASS: '/bin/askpass' },
      exec,
    });
    expect(calls[0]?.options.env).toMatchObject({
      GIT_ASKPASS: '',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
    });
  });

  it('keeps the SSH command that the environment already sets', async () => {
    vi.stubEnv('GIT_SSH_COMMAND', 'ssh -i /keys/cms');
    const { exec, calls } = fakeExec({ stdout: '', stderr: '' });
    await runGit(['fetch'], { cwd: '/repo', exec });
    expect(calls[0]?.options.env).toMatchObject({
      GIT_SSH_COMMAND: 'ssh -i /keys/cms',
    });
  });

  it('refuses a NUL in an argument before spawning anything', async () => {
    const { exec, calls } = fakeExec({ stdout: '', stderr: '' });
    const error = await gitErrorOfAsync(() =>
      runGit(['status', 'a\u0000b'], { cwd: '/repo', exec }),
    );
    expect({
      kind: error.kind,
      message: error.message,
      args: error.args,
      stderr: error.stderr,
      calls: calls.length,
    }).toEqual({
      kind: 'invalid-argument',
      message: 'invalid argument: "a\\u0000b"',
      args: ['status', 'a\u0000b'],
      stderr: '',
      calls: 0,
    });
  });

  it('maps a killed child to a timeout error that names the limit', async () => {
    const { exec } = fakeExec(
      execError('spawn git ETIMEDOUT', {
        code: null,
        killed: true,
        signal: 'SIGTERM',
      }),
    );
    const error = await gitErrorOfAsync(() =>
      runGit(['status'], { cwd: '/repo', timeoutMs: 1500, exec }),
    );
    expect({
      kind: error.kind,
      message: error.message,
      args: error.args,
      stderr: error.stderr,
    }).toEqual({
      kind: 'timeout',
      message: 'git status timed out after 1500 ms',
      args: ['status'],
      stderr: '',
    });
  });

  it('maps a missing git binary to a spawn error, "git not found"', async () => {
    const { exec } = fakeExec(
      execError('spawn git ENOENT', { code: 'ENOENT' }),
    );
    const error = await gitErrorOfAsync(() =>
      runGit(['status'], { cwd: '/repo', exec }),
    );
    expect({
      kind: error.kind,
      message: error.message,
      exitCode: error.exitCode,
      args: error.args,
    }).toEqual({
      kind: 'spawn',
      message: 'git not found',
      exitCode: undefined,
      args: ['status'],
    });
  });

  it('maps another failure to start to a spawn error that keeps the reason', async () => {
    const { exec } = fakeExec(
      execError('permission denied', { code: 'EACCES' }),
    );
    const error = await gitErrorOfAsync(() =>
      runGit(['status'], { cwd: '/repo', exec }),
    );
    expect({
      kind: error.kind,
      message: error.message,
      args: error.args,
    }).toEqual({
      kind: 'spawn',
      message: 'git could not start: permission denied',
      args: ['status'],
    });
  });

  it('maps a rejection that is not an Error to a spawn error', async () => {
    const { exec } = fakeExec('boom');
    const error = await gitErrorOfAsync(() =>
      runGit(['status'], { cwd: '/repo', exec }),
    );
    expect({ kind: error.kind, message: error.message }).toEqual({
      kind: 'spawn',
      message: 'git could not start: boom',
    });
  });

  it('maps a non-zero exit to a failed error with the code and stderr', async () => {
    const { exec } = fakeExec(
      execError('Command failed', {
        code: 128,
        stderr: 'fatal: not a git repository\n',
      }),
    );
    const error = await gitErrorOfAsync(() =>
      runGit(['status'], { cwd: '/repo', exec }),
    );
    expect({
      kind: error.kind,
      message: error.message,
      exitCode: error.exitCode,
      stderr: error.stderr,
    }).toEqual({
      kind: 'failed',
      message: 'git status failed (exit 128)',
      exitCode: 128,
      stderr: 'fatal: not a git repository\n',
    });
  });

  it('maps an output larger than the buffer to a failed error', async () => {
    const { exec } = fakeExec(
      execError('stdout maxBuffer length exceeded', {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      }),
    );
    const error = await gitErrorOfAsync(() =>
      runGit(['log'], { cwd: '/repo', exec }),
    );
    expect({
      kind: error.kind,
      message: error.message,
      args: error.args,
      stderr: error.stderr,
    }).toEqual({
      kind: 'failed',
      message: 'git log output exceeded the buffer limit',
      args: ['log'],
      stderr: '',
    });
  });

  it('redacts credentials in the args, the message and the stderr', async () => {
    const { exec } = fakeExec(
      execError('Command failed', {
        code: 128,
        stderr: "fatal: unable to access 'https://user:secret@host/x.git/'\n",
      }),
    );
    const error = await gitErrorOfAsync(() =>
      runGit(['clone', 'https://user:secret@host/x.git'], {
        cwd: '/repo',
        exec,
      }),
    );
    expect({
      args: error.args,
      message: error.message,
      stderr: error.stderr,
    }).toEqual({
      args: ['clone', 'https://***@host/x.git'],
      message: 'git clone https://***@host/x.git failed (exit 128)',
      stderr: "fatal: unable to access 'https://***@host/x.git/'\n",
    });
  });
});

describe('runGit: binary', () => {
  it('returns stdout as the bytes the exec gave, and asks exec for bytes', async () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x41]);
    const { exec, calls } = fakeExec({ stdout: bytes, stderr: '' });
    await expect(
      runGit(['cat-file', 'blob', 'HEAD:a'], {
        cwd: '/repo',
        exec,
        binary: true,
      }),
    ).resolves.toEqual(bytes);
    expect(calls[0]?.options.binary).toBe(true);
  });

  it('asks for text, and leaves the binary option out, by default', async () => {
    const { exec, calls } = fakeExec({ stdout: 'text', stderr: '' });
    await runGit(['status'], { cwd: '/repo', exec });
    expect(calls[0]?.options).not.toHaveProperty('binary');
  });
});

describe('the real exec (no fake)', () => {
  it('runs git --version through the default exec', async () => {
    expect(await runGit(['--version'], { cwd: process.cwd() })).toMatch(
      /^git version \d/,
    );
  });

  it('runs a process with no shell and returns its stdout and stderr', async () => {
    const result = await realExec(
      process.execPath,
      ['-e', "process.stdout.write('out'); process.stderr.write('err')"],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10_000,
        maxBuffer: 1_000_000,
      },
    );
    expect(result).toEqual({ stdout: 'out', stderr: 'err' });
  });

  it('rejects a failed process with its exit code, stdout and stderr attached', async () => {
    await expect(
      realExec(
        process.execPath,
        ['-e', "process.stderr.write('bad'); process.exit(3)"],
        {
          cwd: process.cwd(),
          env: process.env,
          timeout: 10_000,
          maxBuffer: 1_000_000,
        },
      ),
    ).rejects.toMatchObject({ code: 3, stdout: '', stderr: 'bad' });
  });

  it('kills a process that runs past its timeout, and rejects with killed set', async () => {
    await expect(
      realExec(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 200,
        maxBuffer: 1_000_000,
      }),
    ).rejects.toMatchObject({ killed: true });
  });

  it('rejects with ENOENT for a program that does not exist', async () => {
    await expect(
      realExec('cms-git-test-no-such-program', [], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10_000,
        maxBuffer: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
