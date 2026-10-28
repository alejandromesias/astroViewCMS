import { describe, expect, it } from 'vitest';
import { DATA_PREFIX, dataKey, entryKey, splitKey } from './keys.ts';

describe('keys', () => {
  it('builds entry and data keys', () => {
    expect(DATA_PREFIX).toBe('data:');
    expect(entryKey('blog', 'a/b')).toBe('blog/a/b');
    expect(dataKey('src/config/menu.json')).toBe('data:src/config/menu.json');
  });
});

describe('splitKey', () => {
  it('splits at the first slash, so the id may contain slashes', () => {
    expect(splitKey('blog/post')).toEqual({ collection: 'blog', id: 'post' });
    expect(splitKey('blog/2025/post')).toEqual({
      collection: 'blog',
      id: '2025/post',
    });
    expect(splitKey('a/b')).toEqual({ collection: 'a', id: 'b' });
  });

  it('takes an empty id', () => {
    expect(splitKey('blog/')).toEqual({ collection: 'blog', id: '' });
  });

  it('is undefined for data keys', () => {
    expect(splitKey('data:src/config/menu.json')).toBeUndefined();
    expect(splitKey('data:')).toBeUndefined();
    expect(splitKey(dataKey('a/b.json'))).toBeUndefined();
  });

  it('only treats the prefix at the start as a data key', () => {
    expect(splitKey('blog/data:x')).toEqual({
      collection: 'blog',
      id: 'data:x',
    });
    expect(splitKey('xdata:a/b')).toEqual({ collection: 'xdata:a', id: 'b' });
    expect(splitKey('Data:a/b')).toEqual({ collection: 'Data:a', id: 'b' });
  });

  it('is undefined without a collection or without a slash', () => {
    expect(splitKey('/post')).toBeUndefined();
    expect(splitKey('/')).toBeUndefined();
    expect(splitKey('post')).toBeUndefined();
    expect(splitKey('')).toBeUndefined();
  });

  it('round-trips with entryKey', () => {
    expect(splitKey(entryKey('docs', 'guide/intro'))).toEqual({
      collection: 'docs',
      id: 'guide/intro',
    });
  });
});
