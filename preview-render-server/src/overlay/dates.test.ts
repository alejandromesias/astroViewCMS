import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';
import { reviveDates } from './dates.ts';

const issuesOf = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues;
};

describe('reviveDates (D13)', () => {
  const schema = z.object({ updated: z.date(), items: z.array(z.object({ since: z.date() })) });

  it('a plain z.date() rejects the ISO string that JSON carries (the TBD, answered)', () => {
    expect(schema.safeParse({ updated: '2025-04-04', items: [] }).success).toBe(false);
  });

  it('turns ISO strings at the reported paths into Dates, nested and in arrays', () => {
    const raw = { updated: '2025-04-04', items: [{ since: '2024-01-02T10:00:00Z' }] };
    const revived = reviveDates(raw, issuesOf(schema, raw))! as unknown as { updated: Date; items: { since: Date }[] };
    expect(revived.updated).toEqual(new Date('2025-04-04'));
    expect(revived.items[0]!.since).toEqual(new Date('2024-01-02T10:00:00Z'));
    expect(schema.safeParse(revived).success).toBe(true);
  });

  it('does not touch the original value', () => {
    const raw = { updated: '2025-04-04', items: [] };
    reviveDates(raw, issuesOf(schema, raw));
    expect(raw.updated).toBe('2025-04-04');
  });

  it('leaves strings that are not dates, and other kinds of issue, alone', () => {
    const raw = { updated: 'soon', items: [] };
    expect(reviveDates(raw, issuesOf(schema, raw))).toBeUndefined();
    const wrongType = { updated: 5, items: [] };
    expect(reviveDates(wrongType, issuesOf(schema, wrongType))).toBeUndefined();
  });
});

const dateIssue = (path: PropertyKey[], extra: Partial<{ code: string; expected: string }> = {}) => ({
  code: 'invalid_type',
  expected: 'date',
  path,
  ...extra,
});

describe('which strings count as ISO dates', () => {
  const revive = (text: string) => reviveDates({ d: text }, [dateIssue(['d'])]);

  it.each([
    '2025-04-04',
    '2025-04-04T10:00',
    '2025-04-04 10:00',
    '2025-04-04T10:00:00',
    '2025-04-04T10:00:00.123',
    '2025-04-04T10:00:00Z',
    '2025-04-04T10:00:00.5Z',
    '2025-04-04T10:00:00+02:00',
    '2025-04-04T10:00:00-05:30',
    '2025-04-04T10:00:00+0200',
    '2025-04-04T10:00:00-0530',
  ])('revives %s', (text) => {
    const revived = revive(text);
    expect(revived?.d).toBeInstanceOf(Date);
    expect((revived!.d as unknown as Date).getTime()).toBe(Date.parse(text));
  });

  it.each([
    '',
    'soon',
    '25-04-04',
    '2025-4-04',
    '2025-04-4',
    '12025-04-04',
    '2025-04-041',
    ' 2025-04-04',
    '2025-04-04 ',
    '\n2025-04-04',
    '2025-04-04\n',
    'x2025-04-04',
    '2025-04-04x',
    '2025-04-04T',
    '2025-04-04T10:00Zx',
    '2025-04-04T10:00+2:00',
    '2025-04-04T10:00+02:0',
    '2025-04-04T10:00+02:000',
    '2025-04-04T10:00 UTC',
    '2025/04/04',
    '04-04-2025',
    'abcd-ef-gh',
    '2025-04-04T1000:xx',
  ])('does not revive %j', (text) => {
    expect(revive(text)).toBeUndefined();
  });

  it('does not revive a date that looks right but is not one', () => {
    expect(revive('2025-13-45')).toBeUndefined();
    expect(revive('2025-04-04T99:99')).toBeUndefined();
  });
});

describe('which issues are acted on', () => {
  const value = { d: '2025-04-04' };

  it('only invalid_type issues that expect a date', () => {
    expect(reviveDates(value, [dateIssue(['d'], { code: 'custom' })])).toBeUndefined();
    expect(reviveDates(value, [dateIssue(['d'], { code: 'invalid_value' })])).toBeUndefined();
    expect(reviveDates(value, [dateIssue(['d'], { expected: 'string' })])).toBeUndefined();
    expect(reviveDates(value, [{ code: 'invalid_type', path: ['d'] }])).toBeUndefined();
    expect(reviveDates(value, [dateIssue(['d'])])).toEqual({ d: new Date('2025-04-04') });
  });

  it('ignores an issue with an empty path, whatever the value is', () => {
    expect(reviveDates('2025-04-04', [dateIssue([])])).toBeUndefined();
    expect(reviveDates({ d: '2025-04-04' }, [dateIssue([])])).toBeUndefined();
  });

  it('works with no issues', () => {
    expect(reviveDates(value, [])).toBeUndefined();
  });

  it('follows keys and array indexes, and gives up quietly at a missing or non-object parent', () => {
    const nested = { a: [{ b: { c: '2025-04-04' } }], s: 'text', n: null };
    const revived = reviveDates(nested, [dateIssue(['a', 0, 'b', 'c'])]) as unknown as typeof nested & { a: [{ b: { c: Date } }] };
    expect(revived.a[0].b.c).toEqual(new Date('2025-04-04'));
    for (const path of [['x', 'y', 'z'], ['a', 5, 'b'], ['s', 'length'], ['n', 'k'], ['a', 0, 'b', 'nope'], ['s', 'x', 'y']]) {
      expect(reviveDates(nested, [dateIssue(path)])).toBeUndefined();
    }
  });

  it('revives a date at the root of the path and values that are not strings are left alone', () => {
    expect(reviveDates({ d: 5, e: null, f: undefined, g: true }, [dateIssue(['d']), dateIssue(['e']), dateIssue(['f']), dateIssue(['g'])])).toBeUndefined();
    expect(reviveDates(['2025-04-04'], [dateIssue([0])])).toEqual([new Date('2025-04-04')]);
  });

  it('revives every reported field and keeps the others as they were', () => {
    const raw = { a: '2025-04-04', b: '2024-01-01', c: '2023-01-01', keep: 'x', n: 1 };
    const revived = reviveDates(raw, [dateIssue(['a']), dateIssue(['b']), dateIssue(['zzz']), dateIssue(['keep'])]);
    expect(revived).toEqual({ a: new Date('2025-04-04'), b: new Date('2024-01-01'), c: '2023-01-01', keep: 'x', n: 1 });
  });

  it('returns a copy, not the original, even when the copy changed nothing else', () => {
    const raw = { d: '2025-04-04', list: [1] };
    const revived = reviveDates(raw, [dateIssue(['d'])])!;
    expect(revived).not.toBe(raw);
    expect(revived.list).not.toBe(raw.list);
    expect(raw.d).toBe('2025-04-04');
  });

  it('keeps Dates the value already holds', () => {
    const date = new Date('2020-01-01');
    const revived = reviveDates({ d: '2025-04-04', old: date }, [dateIssue(['d'])])!;
    expect(revived.old).toEqual(date);
    expect(revived.old).toBeInstanceOf(Date);
  });
});
