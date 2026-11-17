import { describe, expect, it } from 'vitest';
import type { FieldIssue } from './errors.ts';
import { DraftError } from './errors.ts';

describe('DraftError', () => {
  // A new list per test. A constructor call at describe level runs outside
  // any test, so Stryker cannot link the mutants it covers to a test.
  const sampleIssues = (): FieldIssue[] => [
    { path: ['blocks', 2, 'title'], message: 'Required', kind: 'invalid' },
    { path: ['date'], message: 'Invalid date', kind: 'invalid' },
  ];

  it('is an Error with its own name', () => {
    const error = new DraftError('posts/hello', sampleIssues());
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DraftError);
    expect(error.name).toBe('DraftError');
  });

  it('keeps the key and the same issues', () => {
    const issues = sampleIssues();
    const error = new DraftError('posts/hello', issues);
    expect(error.key).toBe('posts/hello');
    expect(error.issues).toBe(issues);
  });

  it('says which draft failed and lists each field as dotted path and message', () => {
    const error = new DraftError('posts/hello', sampleIssues());
    expect(error.message).toBe(
      'Draft posts/hello does not match its schema: blocks.2.title: Required; date: Invalid date',
    );
  });

  it('lists a single issue without a separator, and an empty list as nothing', () => {
    expect(
      new DraftError('a', [{ path: ['x'], message: 'bad', kind: 'invalid' }])
        .message,
    ).toBe('Draft a does not match its schema: x: bad');
    expect(new DraftError('a', []).message).toBe(
      'Draft a does not match its schema: ',
    );
  });

  it('shows an issue on the whole document with an empty path', () => {
    expect(
      new DraftError('a', [{ path: [], message: 'bad', kind: 'invalid' }])
        .message,
    ).toBe('Draft a does not match its schema: : bad');
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'keeps a draft key named %s, which comes from content',
    (key) => {
      const error = new DraftError(key, [
        { path: ['title'], message: 'Required', kind: 'invalid' },
      ]);
      expect(error.key).toBe(key);
      expect(error.message).toBe(
        `Draft ${key} does not match its schema: title: Required`,
      );
    },
  );

  it('joins three issues with one separator each, and writes a numeric path segment as a number', () => {
    expect(
      new DraftError('a', [
        { path: ['items', 0, 'id'], message: 'Required', kind: 'invalid' },
        { path: [], message: 'Refinement threw', kind: 'refinement-threw' },
        { path: ['z'], message: 'Too long', kind: 'invalid' },
      ]).message,
    ).toBe(
      'Draft a does not match its schema: items.0.id: Required; : Refinement threw; z: Too long',
    );
  });
});
