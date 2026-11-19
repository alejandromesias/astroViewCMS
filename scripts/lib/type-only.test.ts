import { describe, expect, it } from 'vitest';
import { isTypeOnlyChange } from './type-only.ts';

const BEFORE = `import { z } from 'zod';

export const answerSchema = z.object({ status: z.literal(200) });

// The answer of the route.
export type Answer = { readonly status: 200 } | { readonly status: 500 };
`;

describe('isTypeOnlyChange', () => {
  it('is true when only a type alias changed', () => {
    const after = BEFORE.replace(
      'export type Answer = { readonly status: 200 } | { readonly status: 500 };',
      'export type Answer = { readonly status: 200 } | { readonly status: 503 };',
    );
    expect(isTypeOnlyChange(BEFORE, after)).toBe(true);
  });

  it('is true when only a comment or a blank line changed', () => {
    const after = BEFORE.replace(
      '// The answer of the route.',
      '// The answer of a route.\n',
    );
    expect(isTypeOnlyChange(BEFORE, after)).toBe(true);
  });

  it('is true when an interface and a type-only import are added', () => {
    const after = `import type { Shape } from './shape.ts';\n${BEFORE}\nexport interface Extra { readonly id: string }\n`;
    expect(isTypeOnlyChange(BEFORE, after)).toBe(true);
  });

  it('is false when a runtime statement changed', () => {
    const after = BEFORE.replace('z.literal(200)', 'z.literal(201)');
    expect(isTypeOnlyChange(BEFORE, after)).toBe(false);
  });

  it('is false when a runtime statement was added', () => {
    const after = `${BEFORE}\nexport const extra = 1;\n`;
    expect(isTypeOnlyChange(BEFORE, after)).toBe(false);
  });

  it('is false for a new file, which has no before to compare', () => {
    expect(isTypeOnlyChange(undefined, 'export type A = 1;\n')).toBe(false);
  });
});
