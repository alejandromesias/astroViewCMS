import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '../manifest/types.ts';
import { handleDocument, parseDocument, splitFrontmatter } from './documents.ts';

describe('splitFrontmatter', () => {
  it('splits the YAML fence from the body', () => {
    expect(splitFrontmatter('---\ntitle: Hi\ndraft: false\ntags: [a, b]\n---\n\nBody *text*.\n')).toEqual({
      data: { title: 'Hi', draft: false, tags: ['a', 'b'] },
      body: 'Body *text*.\n',
    });
  });

  it('keeps dates as the ISO text the file holds (the shim revives them)', () => {
    expect(splitFrontmatter('---\ndate: 2025-04-04T05:00:00Z\n---\nx').data).toEqual({ date: '2025-04-04T05:00:00Z' });
  });

  it('reads CRLF files', () => {
    expect(splitFrontmatter('---\r\ntitle: Hi\r\n---\r\nBody')).toEqual({ data: { title: 'Hi' }, body: 'Body' });
  });

  it('takes an empty fence as empty data and a file without fences as all body', () => {
    expect(splitFrontmatter('---\n---\nBody')).toEqual({ data: {}, body: 'Body' });
    expect(splitFrontmatter('Just text\n---\nnot a fence')).toEqual({ data: {}, body: 'Just text\n---\nnot a fence' });
  });
});

describe('parseDocument', () => {
  it('parses JSON and YAML', () => {
    expect(parseDocument('{"a": [1, 2]}', { format: 'json' })).toEqual({ a: [1, 2] });
    expect(parseDocument('name: Noor\nbio: |\n  Two\n  lines\n', { format: 'yaml' })).toEqual({ name: 'Noor', bio: 'Two\nlines\n' });
  });

  it('expands YAML merge keys, as Astro does', () => {
    const text = 'base: &b\n  role: writer\n  active: true\nana:\n  <<: *b\n  name: Ana\n';
    expect(parseDocument(text, { format: 'yaml' })).toEqual({
      base: { role: 'writer', active: true },
      ana: { role: 'writer', active: true, name: 'Ana' },
    });
    expect(parseDocument('---\n<<: {a: 1}\nb: 2\n---\nx', { format: 'md' })).toEqual({ data: { a: 1, b: 2 }, body: 'x' });
  });

  it('gives Markdown and MDX as { data, body }', () => {
    expect(parseDocument('---\na: 1\n---\nb', { format: 'md' })).toEqual({ data: { a: 1 }, body: 'b' });
    expect(parseDocument('---\na: 1\n---\nimport X from "x"\n', { format: 'mdx' })).toEqual({ data: { a: 1 }, body: 'import X from "x"\n' });
  });

  it('picks the entry of a file() file, in the array form and the object form', () => {
    const array = '[{"id":"t1","quote":"One"},{"id":"t2","quote":"Two"}]';
    expect(parseDocument(array, { format: 'json', entryKey: 't2' })).toEqual({ id: 't2', quote: 'Two' });
    expect(parseDocument('- id: s1\n  label: A\n- id: s2\n  label: B\n', { format: 'yaml', entryKey: 's1' })).toEqual({ id: 's1', label: 'A' });
    expect(parseDocument('{"t1":{"quote":"One"}}', { format: 'json', entryKey: 't1' })).toEqual({ quote: 'One' });
    expect(() => parseDocument(array, { format: 'json', entryKey: 'nope' })).toThrow('No entry "nope"');
  });

  it('refuses formats it does not read', () => {
    expect(() => parseDocument('a = 1', { format: 'toml' })).toThrow('toml');
  });
});

describe('handleDocument', () => {
  const records: DocumentRecord[] = [
    { key: 'authors/ana', file: 'src/content/authors/ana.json', format: 'json', buildTime: false },
    { key: 'data:src/config/config.json', file: 'src/config/config.json', format: 'json', buildTime: true, buildTimeFields: ['site.base_url'] },
    { key: 'site/rules', file: 'src/content/rules.toml', format: 'toml', editable: false, buildTime: false },
    { key: 'loader/x', format: 'other', buildTime: false },
  ];
  const files: Record<string, string> = {
    'src/content/authors/ana.json': '{"name":"Ana"}',
    'src/config/config.json': '{broken',
  };
  const deps = { documents: () => records, readFile: (file: string) => files[file] };
  const get = (search: string, init?: RequestInit) => handleDocument(new Request(`http://x/__dev/documents${search}`, init), deps);

  it('answers the document with its flags', async () => {
    const response = get('?key=authors/ana');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ key: 'authors/ana', file: 'src/content/authors/ana.json', format: 'json', buildTime: false, value: { name: 'Ana' } });
  });

  it('lists a read-only document without a value', async () => {
    expect(await get('?key=site/rules').json()).toEqual({ key: 'site/rules', file: 'src/content/rules.toml', format: 'toml', editable: false, buildTime: false });
  });

  it('answers 400 without a key and 404 for unknown keys, entries without a file and missing files', async () => {
    expect(get('').status).toBe(400);
    expect(get('?key=nope').status).toBe(404);
    expect(get('?key=loader/x').status).toBe(404);
    const missing = handleDocument(new Request('http://x/?key=authors/ana'), { ...deps, readFile: () => undefined });
    expect(missing.status).toBe(404);
  });

  it('answers 500 with the file name when it does not parse', async () => {
    const response = get('?key=data:src/config/config.json');
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('src/config/config.json');
  });

  it('answers 404 when the build wrote no documents.json', () => {
    expect(handleDocument(new Request('http://x/?key=a/b'), { ...deps, documents: () => undefined }).status).toBe(404);
  });

  it('refuses other methods and cross-site requests', () => {
    expect(get('?key=authors/ana', { method: 'POST' }).status).toBe(405);
    expect(get('?key=authors/ana', { headers: { 'sec-fetch-site': 'cross-site' } }).status).toBe(403);
  });
});
