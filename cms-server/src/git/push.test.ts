import { describe, expect, it } from 'vitest';
import { isPushRace } from './push.ts';

describe('isPushRace', () => {
  it.each([
    ['fetch first', ' ! [rejected]        abc1234 -> main (fetch first)'],
    [
      'non-fast-forward',
      ' ! [rejected]        abc1234 -> main (non-fast-forward)',
    ],
    [
      'the hint of a stale branch',
      'hint: Updates were rejected because the remote contains work\nhint: non-fast-forward',
    ],
    ['a bare [rejected]', ' ! [rejected] abc1234 -> main'],
  ])('is a race for %s', (_name, stderr) => {
    expect(isPushRace(stderr)).toBe(true);
  });

  it.each([
    [
      'a hook that declines',
      ' ! [remote rejected] abc1234 -> main (pre-receive hook declined)',
    ],
    [
      'a protected branch',
      ' ! [remote rejected] abc1234 -> main (protected branch hook declined)',
    ],
    [
      'a failed sign-in',
      "fatal: Authentication failed for 'https://example.test/repo.git/'",
    ],
    [
      'a network error',
      'fatal: unable to access the remote: Could not resolve host',
    ],
    ['rejected without brackets', 'the push was rejected by the server'],
    ['a different bracketed word', ' ! [reject] abc1234 -> main'],
    ['fast-forward alone', 'fast-forward'],
    ['an empty message', ''],
  ])('is not a race for %s', (_name, stderr) => {
    expect(isPushRace(stderr)).toBe(false);
  });
});
