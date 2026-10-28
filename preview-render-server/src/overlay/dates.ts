// YAML turns an unquoted `2025-04-04` into a Date; JSON (the overlay's wire
// format) can only carry the ISO string. `z.coerce.date()` accepts the string,
// but a plain `z.date()` rejects it (SYSTEM-DESIGN.md D13, checked in task
// 1.4). So when the site's schema reports "expected date" for a field that
// holds an ISO date string, the string is revived into a Date and the parse
// is retried.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export interface DateIssue {
  code: string;
  expected?: string;
  path: PropertyKey[];
}

/** A copy of `value` with the ISO strings that `issues` ask dates for turned
 *  into Dates, or undefined if there was nothing to revive. */
export function reviveDates<T>(
  value: T,
  issues: readonly DateIssue[],
): T | undefined {
  const copy = structuredClone(value);
  let changed = false;
  for (const issue of issues) {
    if (
      issue.code !== 'invalid_type' ||
      issue.expected !== 'date' ||
      issue.path.length === 0
    )
      continue;
    let parent: Record<string | number, unknown> | undefined = copy as Record<
      string | number,
      unknown
    >;
    for (const part of issue.path.slice(0, -1))
      parent = parent?.[part as string | number] as typeof parent;
    const last = issue.path[issue.path.length - 1] as string | number;
    const current = parent?.[last];
    if (
      typeof current === 'string' &&
      ISO_DATE.test(current) &&
      !Number.isNaN(Date.parse(current))
    ) {
      parent[last] = new Date(current);
      changed = true;
    }
  }
  return changed ? copy : undefined;
}
