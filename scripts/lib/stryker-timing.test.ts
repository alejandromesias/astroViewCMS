import { describe, expect, it } from 'vitest';
import { formatDuration, renderTimings } from './stryker-timing.ts';

describe('formatDuration', () => {
  it.each([
    [0, '0 s'],
    [59, '59 s'],
    [60, '1 min 00 s'],
    [125, '2 min 05 s'],
    [3599.6, '60 min 00 s'],
    [-4, '0 s'],
  ])('writes %s seconds as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('renderTimings', () => {
  it('writes nothing when no group ran', () => {
    expect(renderTimings([])).toBe('');
  });

  it('lists the slowest group first and totals the runs', () => {
    const text = renderTimings([
      { group: 'protocol', files: 1, seconds: 10 },
      { group: 'cms-git', files: 4, seconds: 300 },
      { group: 'serve', files: 2, seconds: 65 },
    ]);
    expect(text).toBe(
      [
        '### Stryker time per group',
        '',
        '| Group | Files | Time |',
        '| --- | ---: | ---: |',
        '| cms-git | 4 | 5 min 00 s |',
        '| serve | 2 | 1 min 05 s |',
        '| protocol | 1 | 10 s |',
        '',
        'Total: 6 min 15 s.',
        '',
      ].join('\n'),
    );
  });

  it('does not reorder the caller list', () => {
    const input = [
      { group: 'a', files: 1, seconds: 1 },
      { group: 'b', files: 1, seconds: 2 },
    ];
    renderTimings(input);
    expect(input.map((row) => row.group)).toEqual(['a', 'b']);
  });
});
