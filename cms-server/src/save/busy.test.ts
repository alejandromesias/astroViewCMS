import { describe, expect, it } from 'vitest';
import { GitError } from '../git/exec.ts';
import { LockTimeoutError } from '../git/mutex.ts';
import { busyStop } from './busy.ts';

describe('busyStop', () => {
  it('answers 503 busy for a lock timeout, naming the holder', () => {
    expect(busyStop(new LockTimeoutError('publish', 30_000))).toStrictEqual({
      status: 503,
      body: {
        error: 'busy',
        message:
          'The site is busy with another operation (publish). Try again in a moment.',
      },
    });
  });

  it.each([
    [
      'a plain error',
      new Error('Timed out after 30000 ms waiting for the repo lock'),
    ],
    ['a git error', new GitError('failed', 'git failed')],
    ['a string', 'LockTimeoutError'],
    ['undefined', undefined],
    [
      'an object that only looks like it',
      { name: 'LockTimeoutError', holder: 'save' },
    ],
  ])('passes %s on', (_name, error) => {
    expect(busyStop(error)).toBeUndefined();
  });
});
