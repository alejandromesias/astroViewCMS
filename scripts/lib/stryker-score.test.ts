import { describe, expect, it } from 'vitest';
import {
  type MutantCounts,
  countsByFile,
  judge,
  parseWaivers,
} from './stryker-score.ts';

function report(files: Record<string, string[]>): unknown {
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([file, statuses]) => [
        file,
        { mutants: statuses.map((status) => ({ status })) },
      ]),
    ),
  };
}

// Builds the counts map of a judged set: each file with `killed` detected and `survived` not.
function counts(
  entries: Record<string, [number, number]>,
): Map<string, MutantCounts> {
  return new Map(
    Object.entries(entries).map(([file, [killed, survived]]) => [
      file,
      { detected: killed, valid: killed + survived },
    ]),
  );
}

// The expected groups of a diff: each group with its planned files.
function expectedOf(groups: Record<string, string[]>): Map<string, string[]> {
  return new Map(Object.entries(groups));
}

describe('countsByFile', () => {
  it('counts killed and timeout as detected, survived and no coverage as valid, and leaves the rest out', () => {
    const counts = countsByFile(
      report({
        'cms-server/src/a.ts': [
          'Killed',
          'Timeout',
          'Survived',
          'NoCoverage',
          'CompileError',
          'RuntimeError',
          'Ignored',
          'Pending',
        ],
      }),
    );
    expect(counts.get('cms-server/src/a.ts')).toEqual({
      detected: 2,
      valid: 4,
    });
  });

  it('gives a file with no mutants zero counts', () => {
    expect(
      countsByFile(report({ 'cms-server/src/a.ts': ['CompileError'] })).get(
        'cms-server/src/a.ts',
      ),
    ).toEqual({
      detected: 0,
      valid: 0,
    });
  });

  it('turns Windows separators into forward slashes', () => {
    expect([
      ...countsByFile(report({ 'cms-server\\src\\a.ts': ['Killed'] })).keys(),
    ]).toEqual(['cms-server/src/a.ts']);
  });

  it.each([
    [null, 'not a Stryker JSON report: no `files` object'],
    [{}, 'not a Stryker JSON report: no `files` object'],
    [{ files: [] }, 'not a Stryker JSON report: no `files` object'],
    [
      { files: { 'a.ts': {} } },
      'Stryker report entry for a.ts has no `mutants` array',
    ],
    [
      { files: { 'a.ts': { mutants: [5] } } },
      'Stryker report entry for a.ts has a mutant without a status',
    ],
  ])('throws for the shape %j', (value, message) => {
    expect(() => countsByFile(value)).toThrow(message);
  });
});

describe('parseWaivers', () => {
  it('reads a waiver with its floor, reason and task', () => {
    expect(
      parseWaivers([
        {
          file: 'cms-server/src/a.ts',
          floor: 60,
          reason: 'equivalent mutants',
          task: '2.1l',
        },
      ]),
    ).toEqual([
      {
        file: 'cms-server/src/a.ts',
        floor: 60,
        reason: 'equivalent mutants',
        task: '2.1l',
      },
    ]);
  });

  it('reads an empty list', () => {
    expect(parseWaivers([])).toEqual([]);
  });

  it.each([
    [{}, '.mutation-waivers.json must be an array'],
    [
      [{ file: 'a.ts', floor: '60', reason: 'r', task: 't' }],
      'waiver 0 needs file (string), floor (number), reason and task (strings)',
    ],
    [
      [{ file: 'a.ts', floor: 80, reason: 'r', task: 't' }],
      'waiver 0 (a.ts): floor must be 0 or more and under 80',
    ],
    [
      [{ file: 'a.ts', floor: -1, reason: 'r', task: 't' }],
      'waiver 0 (a.ts): floor must be 0 or more and under 80',
    ],
    [
      [{ file: 'a.ts', floor: 60, reason: ' ', task: 't' }],
      'waiver 0 (a.ts): reason and task must not be empty',
    ],
  ])('rejects %j', (value, message) => {
    expect(() => parseWaivers(value)).toThrow(message);
  });
});

describe('judge in diff mode', () => {
  const expected = expectedOf({
    'cms-server': ['cms-server/src/a.ts', 'cms-server/src/b.ts'],
  });
  const reported = new Set(['cms-server']);

  it('passes when every changed file is at 80 and the set is at 75 or more', () => {
    const verdict = judge({
      mode: 'diff',
      expected,
      reported,
      counts: counts({
        'cms-server/src/a.ts': [8, 2],
        'cms-server/src/b.ts': [9, 1],
      }),
      waivers: [],
    });
    expect(verdict.failures).toEqual([]);
    expect(verdict.overall).toBe(85);
    expect(verdict.rows.map((row) => row.status)).toEqual(['pass', 'pass']);
  });

  it('fails a file under 80, even when the set as a whole passes', () => {
    const verdict = judge({
      mode: 'diff',
      expected,
      reported,
      counts: counts({
        'cms-server/src/a.ts': [7, 3],
        'cms-server/src/b.ts': [30, 0],
      }),
      waivers: [],
    });
    expect(verdict.failures).toEqual([
      'cms-server/src/a.ts scores 70.00, under its floor of 80',
    ]);
    expect(verdict.rows[0]?.status).toBe('fail');
  });

  it('fails the changed set under 75 overall, and each file under its floor', () => {
    const verdict = judge({
      mode: 'diff',
      expected,
      reported,
      counts: counts({
        'cms-server/src/a.ts': [6, 4],
        'cms-server/src/b.ts': [5, 5],
      }),
      waivers: [],
    });
    expect(verdict.overall).toBe(55);
    expect(verdict.failures).toEqual([
      'cms-server/src/a.ts scores 60.00, under its floor of 80',
      'cms-server/src/b.ts scores 50.00, under its floor of 80',
      'the changed set scores 55.00 overall, under 75',
    ]);
  });

  it('lets a waiver lower its own file floor only', () => {
    const verdict = judge({
      mode: 'diff',
      expected,
      reported,
      counts: counts({
        'cms-server/src/a.ts': [6, 4],
        'cms-server/src/b.ts': [60, 0],
      }),
      waivers: [
        {
          file: 'cms-server/src/a.ts',
          floor: 60,
          reason: 'equivalent',
          task: '2.1l',
        },
      ],
    });
    expect(verdict.rows[0]).toMatchObject({
      status: 'pass',
      floor: 60,
      waived: true,
    });
    expect(verdict.rows[1]).toMatchObject({
      status: 'pass',
      floor: 80,
      waived: false,
    });
    expect(verdict.failures).toEqual([]);
  });

  it('does not let a waiver lower the overall floor', () => {
    const verdict = judge({
      mode: 'diff',
      expected,
      reported,
      counts: counts({
        'cms-server/src/a.ts': [4, 6],
        'cms-server/src/b.ts': [9, 1],
      }),
      waivers: [
        { file: 'cms-server/src/a.ts', floor: 0, reason: 'r', task: 't' },
      ],
    });
    expect(verdict.failures).toEqual([
      'the changed set scores 65.00 overall, under 75',
    ]);
  });

  it('reports a changed file with no valid mutant as no-mutants, and does not fail it', () => {
    const verdict = judge({
      mode: 'diff',
      expected,
      reported,
      counts: counts({ 'cms-server/src/a.ts': [9, 1] }),
      waivers: [],
    });
    expect(verdict.rows[1]).toMatchObject({
      file: 'cms-server/src/b.ts',
      status: 'no-mutants',
      score: undefined,
    });
    expect(verdict.failures).toEqual([]);
  });

  it('fails a group whose report is missing, so a crashed run cannot pass', () => {
    const verdict = judge({
      mode: 'diff',
      expected,
      reported: new Set(),
      counts: new Map(),
      waivers: [],
    });
    expect(verdict.failures).toEqual([
      'no Stryker report for group cms-server: the run did not finish',
    ]);
  });

  it('fails a group whose report mutated nothing', () => {
    const verdict = judge({
      mode: 'diff',
      expected,
      reported,
      counts: counts({ 'cms-server/src/a.ts': [0, 0] }),
      waivers: [],
    });
    expect(verdict.failures).toEqual([
      'Stryker mutated nothing for group cms-server: check its run',
    ]);
  });

  it('judges nothing when no group is expected', () => {
    const verdict = judge({
      mode: 'diff',
      expected: new Map(),
      reported: new Set(),
      counts: new Map(),
      waivers: [],
    });
    expect(verdict).toEqual({ rows: [], overall: undefined, failures: [] });
  });
});

describe('judge in full mode', () => {
  it('fails a group that has no report, even when it has no file in the counts', () => {
    const verdict = judge({
      mode: 'full',
      expected: expectedOf({
        contract: [],
        protocol: ['preview-protocol/src/index.ts'],
      }),
      reported: new Set(['protocol']),
      counts: counts({ 'preview-protocol/src/index.ts': [9, 1] }),
      waivers: [],
    });
    expect(verdict.failures).toEqual([
      'no Stryker report for group contract: the run did not finish',
    ]);
  });

  it('lists a file under 80 without failing, and fails only the overall floor', () => {
    const verdict = judge({
      mode: 'full',
      expected: expectedOf({
        'cms-server': ['cms-server/src/a.ts', 'cms-server/src/b.ts'],
      }),
      reported: new Set(['cms-server']),
      counts: counts({
        'cms-server/src/a.ts': [7, 3],
        'cms-server/src/b.ts': [90, 10],
      }),
      waivers: [],
    });
    expect(verdict.rows.map((row) => row.status)).toEqual(['under-80', 'pass']);
    expect(verdict.failures).toEqual([]);
  });

  it('fails when the whole run is under 75', () => {
    const verdict = judge({
      mode: 'full',
      expected: expectedOf({ 'cms-server': ['cms-server/src/a.ts'] }),
      reported: new Set(['cms-server']),
      counts: counts({ 'cms-server/src/a.ts': [7, 3] }),
      waivers: [],
    });
    expect(verdict.failures).toEqual([
      'the whole run scores 70.00 overall, under 75',
    ]);
  });
});
