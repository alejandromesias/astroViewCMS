import { describe, expect, it } from 'vitest';
import { rowOf, table } from './trend.ts';

describe('rowOf', () => {
  it('reads the overall score and counts the files under 80', () => {
    const row = rowOf('2026-11-07T16-43-08Z-3a76a29', {
      overall: 94.23,
      rows: [
        { file: 'cms-server/src/a.ts', status: 'pass' },
        { file: 'cms-server/src/b.ts', status: 'under-80' },
        { file: 'cms-server/src/c.ts', status: 'under-80' },
      ],
    });
    expect(row).toEqual({
      run: '2026-11-07T16-43-08Z-3a76a29',
      overall: 94.23,
      files: 3,
      under80: 2,
    });
  });

  it('leaves the overall score undefined when the run had no valid mutant', () => {
    expect(rowOf('r', { rows: [] })).toEqual({
      run: 'r',
      overall: undefined,
      files: 0,
      under80: 0,
    });
  });

  it('throws for a summary without rows', () => {
    expect(() => rowOf('r', { overall: 90 })).toThrow(
      'r: not a mutation summary (no rows)',
    );
  });
});

describe('table', () => {
  it('prints one row per run, in the order given, with a dash for no score', () => {
    expect(
      table([
        { run: 'old', overall: 90, files: 2, under80: 0 },
        { run: 'new', overall: undefined, files: 0, under80: 0 },
      ]),
    ).toBe(
      [
        '### Mutation trend (whole repo, newest last)',
        '',
        '| Run | Overall | Files | Under 80 |',
        '| --- | ---: | ---: | ---: |',
        '| old | 90.00 | 2 | 0 |',
        '| new | - | 0 | 0 |',
        '',
      ].join('\n'),
    );
  });
});
