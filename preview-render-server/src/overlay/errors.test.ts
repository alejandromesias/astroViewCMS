import { describe, expect, it } from 'vitest';
import { DraftError } from './errors.ts';

describe('DraftError', () => {
  const issues = [
    { path: ['blocks', 2, 'title'], message: 'Required' },
    { path: ['date'], message: 'Invalid date' },
  ];
  const error = new DraftError('posts/hello', issues);

  it('is an Error with its own name', () => {
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DraftError);
    expect(error.name).toBe('DraftError');
  });

  it('keeps the key and the same issues', () => {
    expect(error.key).toBe('posts/hello');
    expect(error.issues).toBe(issues);
  });

  it('says which draft failed and lists each field as dotted path and message', () => {
    expect(error.message).toBe('Draft posts/hello does not match its schema: blocks.2.title: Required; date: Invalid date');
  });

  it('lists a single issue without a separator, and an empty list as nothing', () => {
    expect(new DraftError('a', [{ path: ['x'], message: 'bad' }]).message).toBe('Draft a does not match its schema: x: bad');
    expect(new DraftError('a', []).message).toBe('Draft a does not match its schema: ');
  });

  it('shows an issue on the whole document with an empty path', () => {
    expect(new DraftError('a', [{ path: [], message: 'bad' }]).message).toBe('Draft a does not match its schema: : bad');
  });

});
