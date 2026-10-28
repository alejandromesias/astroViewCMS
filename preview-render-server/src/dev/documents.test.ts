import { describe, expect, it, vi } from 'vitest';
import type { DocumentRecord } from '../manifest/types.ts';
import {
  handleDocument,
  parseDocument,
  splitFrontmatter,
} from './documents.ts';

describe('splitFrontmatter', () => {
  it('splits the YAML fence from the body', () => {
    expect(
      splitFrontmatter(
        '---\ntitle: Hi\ndraft: false\ntags: [a, b]\n---\n\nBody *text*.\n',
      ),
    ).toEqual({
      data: { title: 'Hi', draft: false, tags: ['a', 'b'] },
      body: 'Body *text*.\n',
    });
  });

  it('keeps dates as the ISO text the file holds (the shim revives them)', () => {
    expect(
      splitFrontmatter('---\ndate: 2025-04-04T05:00:00Z\n---\nx').data,
    ).toEqual({ date: '2025-04-04T05:00:00Z' });
  });

  it('reads CRLF files', () => {
    expect(splitFrontmatter('---\r\ntitle: Hi\r\n---\r\nBody')).toEqual({
      data: { title: 'Hi' },
      body: 'Body',
    });
  });

  it('takes an empty fence as empty data and a file without fences as all body', () => {
    expect(splitFrontmatter('---\n---\nBody')).toEqual({
      data: {},
      body: 'Body',
    });
    expect(splitFrontmatter('Just text\n---\nnot a fence')).toEqual({
      data: {},
      body: 'Just text\n---\nnot a fence',
    });
  });
});

describe('parseDocument', () => {
  it('parses JSON and YAML', () => {
    expect(parseDocument('{"a": [1, 2]}', { format: 'json' })).toEqual({
      a: [1, 2],
    });
    expect(
      parseDocument('name: Noor\nbio: |\n  Two\n  lines\n', { format: 'yaml' }),
    ).toEqual({ name: 'Noor', bio: 'Two\nlines\n' });
  });

  it('expands YAML merge keys, as Astro does', () => {
    const text =
      'base: &b\n  role: writer\n  active: true\nana:\n  <<: *b\n  name: Ana\n';
    expect(parseDocument(text, { format: 'yaml' })).toEqual({
      base: { role: 'writer', active: true },
      ana: { role: 'writer', active: true, name: 'Ana' },
    });
    expect(
      parseDocument('---\n<<: {a: 1}\nb: 2\n---\nx', { format: 'md' }),
    ).toEqual({ data: { a: 1, b: 2 }, body: 'x' });
  });

  it('gives Markdown and MDX as { data, body }', () => {
    expect(parseDocument('---\na: 1\n---\nb', { format: 'md' })).toEqual({
      data: { a: 1 },
      body: 'b',
    });
    expect(
      parseDocument('---\na: 1\n---\nimport X from "x"\n', { format: 'mdx' }),
    ).toEqual({ data: { a: 1 }, body: 'import X from "x"\n' });
  });

  it('picks the entry of a file() file, in the array form and the object form', () => {
    const array = '[{"id":"t1","quote":"One"},{"id":"t2","quote":"Two"}]';
    expect(parseDocument(array, { format: 'json', entryKey: 't2' })).toEqual({
      id: 't2',
      quote: 'Two',
    });
    expect(
      parseDocument('- id: s1\n  label: A\n- id: s2\n  label: B\n', {
        format: 'yaml',
        entryKey: 's1',
      }),
    ).toEqual({ id: 's1', label: 'A' });
    expect(
      parseDocument('{"t1":{"quote":"One"}}', {
        format: 'json',
        entryKey: 't1',
      }),
    ).toEqual({ quote: 'One' });
    expect(() =>
      parseDocument(array, { format: 'json', entryKey: 'nope' }),
    ).toThrow('No entry "nope"');
  });

  it('refuses formats it does not read', () => {
    expect(() => parseDocument('a = 1', { format: 'toml' })).toThrow('toml');
  });
});

describe('handleDocument', () => {
  const records: DocumentRecord[] = [
    {
      key: 'authors/ana',
      file: 'src/content/authors/ana.json',
      format: 'json',
      buildTime: false,
    },
    {
      key: 'data:src/config/config.json',
      file: 'src/config/config.json',
      format: 'json',
      buildTime: true,
      buildTimeFields: ['site.base_url'],
    },
    {
      key: 'site/rules',
      file: 'src/content/rules.toml',
      format: 'toml',
      editable: false,
      buildTime: false,
    },
    { key: 'loader/x', format: 'other', buildTime: false },
  ];
  const files: Record<string, string> = {
    'src/content/authors/ana.json': '{"name":"Ana"}',
    'src/config/config.json': '{broken',
  };
  const deps = {
    documents: () => records,
    readFile: (file: string) => files[file],
  };
  const get = (search: string, init?: RequestInit) =>
    handleDocument(
      new Request(`http://x/__dev/documents${search}`, init),
      deps,
    );

  it('answers the document with its flags', async () => {
    const response = get('?key=authors/ana');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: 'authors/ana',
      file: 'src/content/authors/ana.json',
      format: 'json',
      buildTime: false,
      value: { name: 'Ana' },
    });
  });

  it('lists a read-only document without a value', async () => {
    expect(await get('?key=site/rules').json()).toEqual({
      key: 'site/rules',
      file: 'src/content/rules.toml',
      format: 'toml',
      editable: false,
      buildTime: false,
    });
  });

  it('answers 400 without a key and 404 for unknown keys, entries without a file and missing files', async () => {
    expect(get('').status).toBe(400);
    expect(get('?key=nope').status).toBe(404);
    expect(get('?key=loader/x').status).toBe(404);
    const missing = handleDocument(new Request('http://x/?key=authors/ana'), {
      ...deps,
      readFile: () => undefined,
    });
    expect(missing.status).toBe(404);
  });

  it('answers 500 with the file name when it does not parse', async () => {
    const response = get('?key=data:src/config/config.json');
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('src/config/config.json');
  });

  it('answers 404 when the build wrote no documents.json', () => {
    expect(
      handleDocument(new Request('http://x/?key=a/b'), {
        ...deps,
        documents: () => undefined,
      }).status,
    ).toBe(404);
  });

  it('refuses other methods and cross-site requests', () => {
    expect(get('?key=authors/ana', { method: 'POST' }).status).toBe(405);
    expect(
      get('?key=authors/ana', { headers: { 'sec-fetch-site': 'cross-site' } })
        .status,
    ).toBe(403);
  });
});

// -- Mutation-testing additions ---------------------------------------------

describe('splitFrontmatter: fences', () => {
  it('allows spaces and tabs after the fences', () => {
    expect(splitFrontmatter('---  \na: 1\n--- \t\nbody')).toEqual({
      data: { a: 1 },
      body: 'body',
    });
    expect(splitFrontmatter('---\t\na: 1\n---\nbody')).toEqual({
      data: { a: 1 },
      body: 'body',
    });
  });

  it.each([
    ['a leading newline', '\n---\na: 1\n---\nx'],
    ['a leading space', ' ---\na: 1\n---\nx'],
    ['two dashes', '--\na: 1\n--\nx'],
    ['four dashes', '----\na: 1\n----\nx'],
    ['text after the opening fence', '--- x\na: 1\n---\nx'],
    ['no closing fence', '---\na: 1\nx'],
    ['a closing fence with text after it', '---\na: 1\n---x\nbody'],
    ['a closing fence that is indented', '---\na: 1\n ---\nbody'],
    ['an empty text', ''],
  ])('treats %s as all body', (_name, text) => {
    expect(splitFrontmatter(text)).toEqual({ data: {}, body: text });
  });

  it('takes a closing fence at the very end of the text', () => {
    expect(splitFrontmatter('---\na: 1\n---')).toEqual({
      data: { a: 1 },
      body: '',
    });
    expect(splitFrontmatter('---\n---')).toEqual({ data: {}, body: '' });
  });

  it('ends the data at the first closing fence', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody\n---\nmore')).toEqual({
      data: { a: 1 },
      body: 'body\n---\nmore',
    });
  });

  it('removes the blank lines before the body, and only those', () => {
    expect(splitFrontmatter('---\na: 1\n---\r\n\r\n\n\nx\n\ny')).toEqual({
      data: { a: 1 },
      body: 'x\n\ny',
    });
    expect(splitFrontmatter('---\na: 1\n---\n\n  indented\n')).toEqual({
      data: { a: 1 },
      body: '  indented\n',
    });
  });

  it('reads an empty fence with CRLF line ends', () => {
    expect(splitFrontmatter('---\r\n---\r\nBody')).toEqual({
      data: {},
      body: 'Body',
    });
  });

  it('takes data that is only a comment as empty', () => {
    expect(splitFrontmatter('---\n# nothing\n---\nx')).toEqual({
      data: {},
      body: 'x',
    });
  });

  it('does not hide YAML errors', () => {
    expect(() => splitFrontmatter('---\na: [1\n---\nx')).toThrow();
  });

  it('keeps a scalar front matter as it is', () => {
    expect(splitFrontmatter('---\njust text\n---\nx').data).toBe('just text');
  });
});

describe('parseDocument: details', () => {
  it('reads JSON as JSON and YAML as YAML', () => {
    expect(() => parseDocument('{a: 1}', { format: 'json' })).toThrow();
    expect(parseDocument('{a: 1}', { format: 'yaml' })).toEqual({ a: 1 });
    expect(parseDocument('{"a": 1}', { format: 'yaml' })).toEqual({ a: 1 });
  });

  it('returns the whole file for a format without an entry key', () => {
    expect(parseDocument('[1, 2]', { format: 'json' })).toEqual([1, 2]);
    expect(parseDocument('[1, 2]', { format: 'json' })).toEqual([1, 2]);
  });

  it('finds an array entry by id, also a number id, and skips items that are not objects or have no id', () => {
    const text = JSON.stringify([
      null,
      5,
      'str',
      { name: 'no id' },
      { id: 7, v: 'seven' },
      { id: 'a', v: 'A' },
    ]);
    expect(parseDocument(text, { format: 'json', entryKey: '7' })).toEqual({
      id: 7,
      v: 'seven',
    });
    expect(parseDocument(text, { format: 'json', entryKey: 'a' })).toEqual({
      id: 'a',
      v: 'A',
    });
    expect(() =>
      parseDocument(text, { format: 'json', entryKey: 'undefined' }),
    ).toThrow('No entry "undefined" in the file');
    expect(() =>
      parseDocument(text, { format: 'json', entryKey: 'null' }),
    ).toThrow('No entry "null" in the file');
  });

  it('takes the first entry when several share an id', () => {
    expect(
      parseDocument('[{"id":"a","v":1},{"id":"a","v":2}]', {
        format: 'json',
        entryKey: 'a',
      }),
    ).toEqual({ id: 'a', v: 1 });
  });

  it('finds an entry of the object form, also an empty or false value', () => {
    const text = '{"a": null, "b": 0, "c": "", "d": false}';
    for (const [key, value] of [
      ['a', null],
      ['b', 0],
      ['c', ''],
      ['d', false],
    ] as const) {
      expect(parseDocument(text, { format: 'json', entryKey: key })).toBe(
        value,
      );
    }
  });

  it('does not find inherited object members as entries', () => {
    expect(() =>
      parseDocument('{}', { format: 'json', entryKey: 'toString' }),
    ).toThrow('No entry "toString" in the file');
    expect(() =>
      parseDocument('{}', { format: 'json', entryKey: '__proto__' }),
    ).toThrow('No entry "__proto__" in the file');
  });

  it.each([
    ['null', 'null'],
    ['a number', '5'],
    ['a string', '"text"'],
    ['an empty array', '[]'],
    ['an empty object', '{}'],
  ])('says there is no entry in %s', (_name, text) => {
    expect(() =>
      parseDocument(text, { format: 'json', entryKey: 'x' }),
    ).toThrow('No entry "x" in the file');
  });

  it('looks for an entry also when the key is empty', () => {
    expect(() =>
      parseDocument('[{"id":"a"}]', { format: 'json', entryKey: '' }),
    ).toThrow('No entry "" in the file');
    expect(parseDocument('{"": 1}', { format: 'json', entryKey: '' })).toBe(1);
  });

  it('names the format it cannot read', () => {
    expect(() => parseDocument('a = 1', { format: 'toml' })).toThrow(
      'Cannot read a toml document',
    );
    expect(() => parseDocument('', { format: 'other' as never })).toThrow(
      'Cannot read a other document',
    );
  });
});

describe('handleDocument: details', () => {
  const records: DocumentRecord[] = [
    { key: 'a/one', file: 'one.json', format: 'json', buildTime: false },
    {
      key: 'a/two',
      file: 'two.json',
      format: 'json',
      buildTime: true,
      buildTimeFields: ['x.y', 'z'],
    },
    {
      key: 'a/three',
      file: 'three.json',
      format: 'json',
      editable: true as never,
      buildTime: false,
    },
    {
      key: 'a/ro',
      file: 'ro.toml',
      format: 'toml',
      editable: false,
      buildTime: true,
      buildTimeFields: ['*'],
    },
    { key: 'a/post', file: 'post.md', format: 'md', buildTime: false },
    {
      key: 'a/yaml',
      file: 'list.yaml',
      format: 'yaml',
      entryKey: 'b',
      buildTime: false,
    },
    { key: 'a/nofile', file: '', format: 'json', buildTime: false },
    { key: 'a/dup', file: 'first.json', format: 'json', buildTime: false },
    { key: 'a/dup', file: 'second.json', format: 'json', buildTime: false },
  ];
  const files: Record<string, string> = {
    'one.json': '{"n":1}',
    'two.json': '{"n":2}',
    'three.json': '{"n":3}',
    'post.md': '---\nt: T\n---\nBody',
    'list.yaml': '- id: a\n  v: 1\n- id: b\n  v: 2\n',
    'first.json': '{"first":true}',
    'second.json': '{"second":true}',
    'bad.json': '{',
  };
  const read = (file: string) => files[file];
  const call = (
    search: string,
    init?: RequestInit,
    readFile: (file: string) => string | undefined = read,
  ) =>
    handleDocument(new Request(`http://x/__dev/documents${search}`, init), {
      documents: () => records,
      readFile,
    });

  it('answers JSON with the flags only when they apply', async () => {
    const response = call('?key=a/one');
    expect(response.headers.get('content-type')).toContain('application/json');
    const plain = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(plain).sort()).toEqual([
      'buildTime',
      'file',
      'format',
      'key',
      'value',
    ]);

    const timed = (await call('?key=a/two').json()) as Record<string, unknown>;
    expect(timed).toEqual({
      key: 'a/two',
      file: 'two.json',
      format: 'json',
      buildTime: true,
      buildTimeFields: ['x.y', 'z'],
      value: { n: 2 },
    });

    const editable = (await call('?key=a/three').json()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(editable)).not.toContain('editable');
  });

  it('lists a read-only document with its flags and without reading the file', async () => {
    const read = vi.fn(() => 'x');
    const response = call('?key=a/ro', undefined, read);
    expect(await response.json()).toEqual({
      key: 'a/ro',
      file: 'ro.toml',
      format: 'toml',
      editable: false,
      buildTime: true,
      buildTimeFields: ['*'],
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('reads the file of the record and answers its parsed value', async () => {
    const read = vi.fn((file: string) => files[file]);
    await call('?key=a/one', undefined, read).json();
    expect(read).toHaveBeenCalledExactlyOnceWith('one.json');
    expect(
      ((await call('?key=a/post').json()) as { value: unknown }).value,
    ).toEqual({ data: { t: 'T' }, body: 'Body' });
    expect(
      ((await call('?key=a/yaml').json()) as { value: unknown }).value,
    ).toEqual({ id: 'b', v: 2 });
  });

  it('uses the first record of a key', async () => {
    expect(((await call('?key=a/dup').json()) as { file: string }).file).toBe(
      'first.json',
    );
  });

  it('uses the first key parameter', async () => {
    expect(
      ((await call('?key=a/one&key=a/two').json()) as { key: string }).key,
    ).toBe('a/one');
  });

  it('says what is wrong, in plain text', async () => {
    const text = async (response: Response) => [
      response.status,
      await response.text(),
    ];
    expect(await text(call(''))).toEqual([400, 'Missing ?key=']);
    expect(await text(call('?key='))).toEqual([400, 'Missing ?key=']);
    expect(await text(call('?key=nope'))).toEqual([
      404,
      'Unknown document "nope"',
    ]);
    expect(await text(call('?key=a/nofile'))).toEqual([
      404,
      'Unknown document "a/nofile"',
    ]);
    expect(await text(call('?key=a/one', undefined, () => undefined))).toEqual([
      404,
      'File not found: one.json',
    ]);
    expect(await text(call('?key=a/one', { method: 'DELETE' }))).toEqual([
      405,
      'Method Not Allowed',
    ]);
    expect(
      await text(
        call('?key=a/one', { headers: { 'sec-fetch-site': 'cross-site' } }),
      ),
    ).toEqual([403, 'Forbidden']);
  });

  it('allows GET only', () => {
    expect(call('?key=a/one', { method: 'POST' }).headers.get('allow')).toBe(
      'GET',
    );
    expect(call('?key=a/one', { method: 'HEAD' }).status).toBe(405);
  });

  it('answers 500 with the file and the reason when the file does not parse', async () => {
    const response = call('?key=a/one', undefined, () => '{');
    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/^Cannot parse one\.json: \S/);
  });

  it('checks the method and the origin before the key', () => {
    expect(call('', { method: 'POST' }).status).toBe(405);
    expect(
      call('', { headers: { 'sec-fetch-site': 'cross-site' } }).status,
    ).toBe(403);
  });
});
