import { describe, expect, it, vi } from 'vitest';
import { realExec } from './exec.ts';

// Mocking node:child_process here, in its own file, keeps the real-process tests in exec.test.ts real.
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));

describe('realExec spawn options', () => {
  it('spawns with the given options, utf8 output, and no console window on Windows', async () => {
    execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => callback(null, 'out', 'err'),
    );
    await expect(
      realExec('git', ['--version'], {
        cwd: '/repo',
        env: {},
        timeout: 5000,
        maxBuffer: 1024,
      }),
    ).resolves.toEqual({ stdout: 'out', stderr: 'err' });
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['--version'],
      {
        cwd: '/repo',
        env: {},
        timeout: 5000,
        maxBuffer: 1024,
        encoding: 'utf8',
        windowsHide: true,
      },
      expect.any(Function),
    );
  });
});
