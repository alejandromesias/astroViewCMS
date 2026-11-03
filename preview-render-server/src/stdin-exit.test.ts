import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { exitWhenStdinCloses } from './stdin-exit.ts';

// Lets the pending events of the stream run before the test looks at `exit`.
function turn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('exitWhenStdinCloses', () => {
  it('does not exit while stdin is open, and exits once when it ends', async () => {
    const stdin = new PassThrough();
    const exit = vi.fn();
    exitWhenStdinCloses(stdin, exit);
    stdin.write('still open');
    await turn();
    expect(exit).not.toHaveBeenCalled();
    const ended = once(stdin, 'end');
    stdin.end();
    await ended;
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exits once when stdin fails', async () => {
    const stdin = new PassThrough();
    const exit = vi.fn();
    exitWhenStdinCloses(stdin, exit);
    stdin.destroy(new Error('pipe broken'));
    await turn();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('resumes stdin, so that a stream nobody reads still ends', async () => {
    const stdin = new PassThrough();
    exitWhenStdinCloses(stdin, vi.fn());
    expect(stdin.readableFlowing).toBe(true);
  });
});
