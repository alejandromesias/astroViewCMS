import { describe, expect, it } from 'vitest';
import { objectOf } from './json.ts';

describe('objectOf', () => {
  it('accepts a plain object, including an empty one', () => {
    const schema = objectOf('must be an object');
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ a: 1 }).success).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['a number', 1],
    ['undefined', undefined],
  ])('refuses %s with the given message', (_name, value) => {
    const refused = objectOf('must be an object').safeParse(value);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe('must be an object');
  });
});
