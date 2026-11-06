// The git command line (PHASE-2-DESIGN 4.2). `runGit` runs `git` with `execFile` and fixed argument
// arrays, never a shell. The `exec` function is injected so that tests can fake it; the real one is
// the default. Refs, branch names, paths and remote URLs from outside are checked by the `assert*`
// validators before anything is spawned.
import { execFile } from 'node:child_process';
import { posix, win32 } from 'node:path';

/** What a finished `git` process produced. Its stdout is a Buffer only for a call made with `binary`. */
export interface ExecResult {
  stdout: string | Buffer;
  stderr: string;
}

/** The settings `runGit` gives to `exec`. `timeout` is in milliseconds. `binary` keeps stdout as bytes. */
export interface ExecOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
  binary?: true;
}

/** Runs `file` with `args` and no shell. Rejects with Node's error shape (`code`, `killed`, `signal`, `stdout`, `stderr`). */
export type ExecFn = (
  file: string,
  args: readonly string[],
  options: ExecOptions,
) => Promise<ExecResult>;

export type GitErrorKind = 'invalid-argument' | 'timeout' | 'failed' | 'spawn';

const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * A failed git call. `message`, `args` and `stderr` have every `://user:secret@` replaced by `://***@`,
 * so a remote URL with credentials never reaches a log or a response.
 */
export class GitError extends Error {
  readonly kind: GitErrorKind;
  readonly args: readonly string[];
  readonly exitCode: number | undefined;
  readonly stderr: string;

  constructor(
    kind: GitErrorKind,
    message: string,
    details: {
      args?: readonly string[];
      exitCode?: number;
      stderr?: string;
    } = {},
  ) {
    super(redact(message));
    this.name = 'GitError';
    this.kind = kind;
    this.args = (details.args ?? []).map(redact);
    this.exitCode = details.exitCode;
    this.stderr = redact(details.stderr ?? '');
  }
}

/** The real `execFile`, promisified. Its rejections carry Node's error shape. */
export const realExec: ExecFn = (file, args, options) =>
  new Promise<ExecResult>((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        encoding: options.binary === true ? 'buffer' : 'utf8',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        // stderr is text for every call, so it is decoded even when stdout is kept as bytes. A rejection carries
        // the same text, so GitError can redact it (a Buffer has no replace).
        if (error === null) resolve({ stdout, stderr: String(stderr) });
        else reject(Object.assign(error, { stdout, stderr: String(stderr) }));
      },
    );
  });

/** The options of one `runGit` call. `binary` returns stdout as a Buffer, undecoded (a blob's exact bytes). */
export interface RunGitOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  exec?: ExecFn;
  binary?: true;
}

/**
 * Runs `git` with `args` in `cwd` and returns its stdout. The fixed options are `GIT_TERMINAL_PROMPT=0`,
 * `GCM_INTERACTIVE=never`, `LC_ALL=C` and `GIT_ASKPASS=` (empty), over the inherited environment.
 * `GIT_SSH_COMMAND` is `ssh -o BatchMode=yes` unless the environment already sets it. `-c protocol.ext.allow=never`
 * comes before every command, because the remote URL comes from the config file.
 */
export function runGit(
  args: readonly string[],
  options: RunGitOptions & { binary: true },
): Promise<Buffer>;
export function runGit(
  args: readonly string[],
  options: RunGitOptions,
): Promise<string>;
export async function runGit(
  args: readonly string[],
  options: RunGitOptions,
): Promise<string | Buffer> {
  const {
    cwd,
    timeoutMs = 60_000,
    env = {},
    exec = realExec,
    binary,
  } = options;
  for (const arg of args) {
    if (arg.includes('\0'))
      throw new GitError(
        'invalid-argument',
        `invalid argument: ${JSON.stringify(arg)}`,
        { args },
      );
  }
  const inherited = { ...process.env, ...env };
  const fullEnv = {
    ...inherited,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    LC_ALL: 'C',
    GIT_ASKPASS: '',
    // Paths are literal: without this, Git reads `*`, `?` and `[]` in a path as patterns, so one save
    // could stage or commit other files that match. Every path argument is literal.
    GIT_LITERAL_PATHSPECS: '1',
    // An SSH passphrase prompt would hang the server (GIT_TERMINAL_PROMPT does not stop it).
    // A user's own SSH command is kept.
    GIT_SSH_COMMAND: inherited.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
  };
  try {
    const { stdout } = await exec(
      'git',
      ['-c', 'protocol.ext.allow=never', ...args],
      {
        cwd,
        env: fullEnv,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        ...(binary === true ? { binary: true as const } : {}),
      },
    );
    return stdout;
  } catch (error: unknown) {
    throw gitErrorOf(asExecError(error), args, timeoutMs);
  }
}

/** A ref name: no leading `-`, no whitespace or control characters, no git-forbidden characters or sequences. */
export function assertRef(ref: string): void {
  if (
    ref === '' ||
    ref.startsWith('-') ||
    hasWhitespaceOrControl(ref) ||
    FORBIDDEN_REF_CHARS.some((char) => ref.includes(char)) ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.includes('//') ||
    ref.endsWith('/') ||
    ref.endsWith('.lock')
  ) {
    throw invalid('ref', ref);
  }
}

/** A path relative to the repository: not absolute, no `..` segment, no leading `-`. Always passed after `--`. */
export function assertRelativePath(path: string): void {
  if (
    path === '' ||
    path.includes('\0') ||
    path.startsWith('-') ||
    posix.isAbsolute(path) ||
    win32.isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.split(/[\\/]/).includes('..')
  ) {
    throw invalid('path', path);
  }
}

/** A remote URL: no leading `-` (it would be read as an option) and no `ext::` (it runs a command). */
export function assertRemoteUrl(url: string): void {
  if (url === '' || url.startsWith('-') || /^ext::/i.test(url)) {
    throw invalid('remote URL', url);
  }
}

const FORBIDDEN_REF_CHARS = ['~', '^', ':', '?', '*', '[', '\\'];

// The fields of a rejected `execFile` call that the mapping reads.
interface ExecError extends Error {
  code?: string | number | null;
  killed?: boolean;
  stderr?: string;
}

function asExecError(error: unknown): ExecError {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function gitErrorOf(
  error: ExecError,
  args: readonly string[],
  timeoutMs: number,
): GitError {
  const command = args.join(' ');
  const stderr = error.stderr ?? '';
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new GitError(
      'failed',
      `git ${command} output exceeded the buffer limit`,
      { args, stderr },
    );
  }
  if (error.killed === true) {
    return new GitError(
      'timeout',
      `git ${command} timed out after ${timeoutMs} ms`,
      { args, stderr },
    );
  }
  if (error.code === 'ENOENT')
    return new GitError('spawn', 'git not found', { args });
  if (typeof error.code === 'number') {
    return new GitError(
      'failed',
      `git ${command} failed (exit ${error.code})`,
      { args, exitCode: error.code, stderr },
    );
  }
  return new GitError('spawn', `git could not start: ${error.message}`, {
    args,
  });
}

function invalid(what: string, value: string): GitError {
  return new GitError(
    'invalid-argument',
    `invalid ${what}: ${JSON.stringify(value)}`,
  );
}

function hasWhitespaceOrControl(text: string): boolean {
  return [...text].some(
    (char) =>
      /\s/.test(char) ||
      char.charCodeAt(0) < 0x20 ||
      char.charCodeAt(0) === 0x7f,
  );
}

/** Replaces the credentials of a URL (`://user:secret@`) with `://***@`. Also used by the logger (`src/log.ts`). */
export function redact(text: string): string {
  return text.replace(/:\/\/[^/@\s]+@/g, '://***@');
}
