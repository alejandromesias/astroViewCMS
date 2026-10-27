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
    expect(revived.items[0].since).toEqual(new Date('2024-01-02T10:00:00Z'));
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
