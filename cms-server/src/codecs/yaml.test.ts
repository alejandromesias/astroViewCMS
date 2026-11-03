// @ts-nocheck
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodecError } from './types.ts';
import { yamlCodec } from './yaml.ts';

// Copies of the sample site's YAML files: the partner documents, stats.yaml, and the YAML author.
const FIXTURES = fileURLToPath(
  new URL('../../test/fixtures/yaml/', import.meta.url),
);
const FIXTURE_NAMES = [
  'partners/atlas.yaml',
  'partners/bright.yaml',
  'partners/loop.yaml',
  'partners/northwind.yaml',
  'stats.yaml',
  'authors/noor-haddad.yaml',
];

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), 'utf8');
}

// The CodecError that `run` throws. Fails the test if it returns, or throws anything else.
function codecErrorOf(run: () => unknown): CodecError {
  try {
    run();
  } catch (error) {
    if (error instanceof CodecError) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}

describe('yamlCodec.parse', () => {
  it('reads a partner document, with the unquoted date as a Date', async () => {
    expect(yamlCodec.parse(await fixture('partners/atlas.yaml'))).toEqual({
      name: 'Atlas Studio',
      logo: '../../assets/partners/atlas.png',
      url: 'https://example.com/atlas',
      order: 3,
      since: new Date('2022-01-20T00:00:00Z'),
    });
  });

  it('reads stats.yaml as a list, keeping quoted values as text', async () => {
    const value = yamlCodec.parse(await fixture('stats.yaml'));
    expect(value).toEqual([
      {
        id: 'sites',
        label: 'Sites launched',
        value: '240+',
        updated: new Date('2026-09-01T00:00:00Z'),
      },
      {
        id: 'editors',
        label: 'Active editors',
        value: '1,800',
        updated: new Date('2026-09-14T00:00:00Z'),
      },
      {
        id: 'uptime',
        label: 'Uptime',
        value: '99.98%',
        updated: new Date('2026-10-01T00:00:00Z'),
      },
    ]);
  });

  it('expands a << merge key, and an own key overrides the merged one', () => {
    expect(
      yamlCodec.parse('base: &b\n  a: 1\n  b: 2\nchild:\n  <<: *b\n  b: 9\n'),
    ).toEqual({
      base: { a: 1, b: 2 },
      child: { a: 1, b: 9 },
    });
  });

  it('keeps __proto__ as an own key', () => {
    const value = yamlCodec.parse('a: 1\n__proto__: x\n') as Record<
      string,
      unknown
    >;
    expect(Object.keys(value)).toEqual(['a', '__proto__']);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it.each([
    [
      'a duplicate key',
      'a: 1\nb: 2\na: 3\n',
      'Invalid YAML at line 3, column 1: DUPLICATE_KEY',
      3,
      1,
    ],
    [
      'a bad indent',
      'a: 1\nb:\n  c: 1\n d: 2\n',
      'Invalid YAML at line 4, column 1: BAD_INDENT',
      4,
      1,
    ],
  ])(
    'refuses %s with a CodecError at its line',
    (_label, text, message, line, column) => {
      const error = codecErrorOf(() => yamlCodec.parse(text));
      expect({
        message: error.message,
        format: error.format,
        line: error.line,
        column: error.column,
      }).toEqual({
        message,
        format: 'yaml',
        line,
        column,
      });
    },
  );

  it.each([
    ['a scalar', 'just text\n'],
    ['an empty document', ''],
  ])('refuses %s, which is not a map or a sequence', (_label, text) => {
    expect(codecErrorOf(() => yamlCodec.parse(text)).message).toBe(
      'YAML document must be a map or a sequence',
    );
  });
});

// Cases the mutation run found untested: the LCS and greedy pairing of sequence items (a comment must
// stay with its item), layout detection, a new file from an empty text, a value that cannot be written,
// and the `format` of each error.
describe('yamlCodec.write: mutation survivors', () => {
  it('writes a new file from an empty or newline-only text, with a final newline', () => {
    expect(yamlCodec.write('', { a: 1 })).toBe('a: 1\n');
    expect(yamlCodec.write('\n', { a: 1 })).toBe('a: 1\n');
    expect(yamlCodec.write('  ', { a: 1 })).toBe('a: 1\n');
  });

  it('writes a Date that becomes a number, as a number, and keeps its comment', async () => {
    const text = await fixture('partners/atlas.yaml');
    const value = yamlCodec.parse(text) as { since: unknown };
    value.since = 12;
    expect(yamlCodec.write(text, value)).toBe(
      text.replace(
        'since: 2022-01-20 # unquoted date',
        'since: 12 # unquoted date',
      ),
    );
  });

  it('writes a Date in a new file as a timestamp', () => {
    expect(yamlCodec.write('', { d: new Date(Date.UTC(2024, 4, 6)) })).toBe(
      'd: 2024-05-06\n',
    );
  });

  it('keeps the comment of the item that is matched, when an equal item is removed', () => {
    expect(yamlCodec.write('- 1 # one-a\n- 2\n- 1 # one-b\n', [2, 1])).toBe(
      '- 2\n- 1 # one-b\n',
    );
    expect(yamlCodec.write('- x # 1\n- x # 2\n', ['x'])).toBe('- x # 1\n');
  });

  it('moves an item with its comment when the order changes', () => {
    expect(yamlCodec.write('- a # A\n- b\n', ['b', 'a'])).toBe(
      '- b\n- a # A\n',
    );
    expect(yamlCodec.write('- a # A\n- b\n- c\n', ['c', 'b', 'a'])).toBe(
      '- c\n- b\n- a # A\n',
    );
    expect(
      yamlCodec.write('- id: a # A\n  v: 1\n- id: b\n  v: 2\n', [
        { id: 'b', v: 2 },
        { id: 'a', v: 1 },
      ]),
    ).toBe('- id: b\n  v: 2\n- id: a # A\n  v: 1\n');
  });

  it('keeps the comments of equal items when one is moved among duplicates', () => {
    expect(yamlCodec.write('- 1\n- 2 # two\n- 1 # one-b\n', [1, 1, 2])).toBe(
      '- 1\n- 1 # one-b\n- 2 # two\n',
    );
  });

  it('appends and inserts items without moving the comments of the others', () => {
    expect(yamlCodec.write('- a # A\n- b\n', ['a', 'b', 'c'])).toBe(
      '- a # A\n- b\n- c\n',
    );
    expect(yamlCodec.write('- a\n- b # B\n', ['a', 'x', 'b'])).toBe(
      '- a\n- x\n- b # B\n',
    );
  });

  it('keeps the comment above a changed list item', () => {
    expect(
      yamlCodec.write('items:\n  # first\n  - 1\n', { items: ['one'] }),
    ).toBe('items:\n  # first\n  - one\n');
  });

  it('moves the header comment onto a new first item, after the comment that item already has', () => {
    expect(
      yamlCodec.write('items:\n  # header\n  - a\n  # about b\n  - b\n', {
        items: ['b', 'a'],
      }),
    ).toBe('items:\n  # header\n  # about b\n  - b\n  - a\n');
  });

  it('keeps the header of a root list on top when a commented item moves to the front', () => {
    const text = yamlCodec.write('# header\n- a\n# about b\n- b\n', ['b', 'a']);
    expect(text).toBe('# header\n# about b\n- b\n- a\n');
    expect(yamlCodec.parse(text)).toEqual(['b', 'a']);
  });

  it('turns a string into a map or a list, and reads back as given', () => {
    const asMap = yamlCodec.write('a: x\n', { a: { k: 1 } });
    expect(asMap).toBe('a:\n  k: 1\n');
    expect(yamlCodec.parse(asMap)).toEqual({ a: { k: 1 } });
    const asList = yamlCodec.write('a: x\n', { a: [1] });
    expect(asList).toBe('a:\n  - 1\n');
    expect(yamlCodec.parse(asList)).toEqual({ a: [1] });
  });

  it('replaces a binary value with a map or a list, as a whole node', () => {
    const asMap = yamlCodec.write('a: !!binary aGk=\n', { a: { k: 1 } });
    expect(asMap).toBe('a:\n  k: 1\n');
    expect(yamlCodec.parse(asMap)).toEqual({ a: { k: 1 } });
    const asList = yamlCodec.write('a: !!binary aGk=\n', { a: [1] });
    expect(asList).toBe('a:\n  - 1\n');
    expect(yamlCodec.parse(asList)).toEqual({ a: [1] });
  });

  it('drops an inline comment when a scalar becomes a map, as it has no line to sit on', () => {
    expect(yamlCodec.write('a: x # note\n', { a: { k: 1 } })).toBe(
      'a:\n  k: 1\n',
    );
  });

  it('keeps the comment above a changed item that is not the first', () => {
    expect(yamlCodec.write('- a\n# about 1\n- 1\n', ['a', 'one'])).toBe(
      '- a\n# about 1\n- one\n',
    );
  });

  it('does not write one node twice when an item repeats', () => {
    expect(yamlCodec.write('- x # X\n- y\n', ['y', 'x', 'x'])).toBe(
      '- y\n- x # X\n- x\n',
    );
  });

  it('keeps the alignment that matches the most items, with the comment of the kept item', () => {
    expect(
      yamlCodec.write('- a # A\n- b\n- a # A2\n- c\n', ['b', 'a', 'c']),
    ).toBe('- b\n- a # A2\n- c\n');
  });

  it('keeps the longest common run of items, with the comments of the items it keeps', () => {
    expect(
      yamlCodec.write('- a # 1\n- b # 2\n- a # 3\n- b # 4\n', ['b', 'a', 'b']),
    ).toBe('- b # 2\n- a # 3\n- b # 4\n');
    expect(yamlCodec.write('- a # 1\n- b\n- c # 3\n', ['b', 'c', 'a'])).toBe(
      '- b\n- c # 3\n- a # 1\n',
    );
  });

  it('refuses a change into an alias with the yaml format', () => {
    let caught: unknown;
    try {
      yamlCodec.write('a: &x\n  k: 1\nb: *x\n', { a: { k: 2 }, b: { k: 2 } });
    } catch (error) {
      caught = error;
    }
    expect((caught as CodecError).message).toBe(
      'A change inside an alias cannot be written as YAML',
    );
    expect((caught as CodecError).format).toBe('yaml');
  });

  it('replaces an alias that holds a string, and does not write into the alias', () => {
    expect(
      yamlCodec.write('a: &x hello\nb: *x\n', { a: 'hello', b: 'bye' }),
    ).toBe('a: &x hello\nb: bye\n');
  });

  it('writes a quoted string that becomes a number as a plain number', () => {
    expect(yamlCodec.write('label: "abc"\n', { label: 42 })).toBe(
      'label: 42\n',
    );
  });

  it('drops the tag of a scalar that changes type', () => {
    expect(yamlCodec.write('n: !!int 3\n', { n: 'three' })).toBe('n: three\n');
  });

  it('keeps a missing final newline, on a one-line file', () => {
    expect(yamlCodec.write('a: 1', { a: 2 })).toBe('a: 2');
  });

  it('indents a new sequence in a mapping that has none, with the default indent', () => {
    expect(yamlCodec.write('a: 1\n', { a: 1, list: [1] })).toBe(
      'a: 1\nlist:\n  - 1\n',
    );
  });

  it('keeps a sequence unindented when the file has it unindented, and a key line with trailing spaces', () => {
    expect(
      yamlCodec.write('items:\n- a\n- b\n', { items: ['a', 'b', 'c'] }),
    ).toBe('items:\n- a\n- b\n- c\n');
    expect(
      yamlCodec.write('items:  \n- a\n- b\n', { items: ['a', 'b', 'c'] }),
    ).toBe('items:\n- a\n- b\n- c\n');
  });

  it('keeps an indented sequence indented', () => {
    expect(yamlCodec.write('items:\n  - a\n', { items: ['a', 'b'] })).toBe(
      'items:\n  - a\n  - b\n',
    );
  });

  it('refuses an undefined item in a sequence, with the yaml format', () => {
    let caught: unknown;
    try {
      yamlCodec.write('- a\n', ['a', undefined]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CodecError);
    expect((caught as CodecError).message).toBe(
      'Value cannot be written as YAML',
    );
    expect((caught as CodecError).format).toBe('yaml');
  });

  it('names the yaml format when the document is not a map or a sequence', () => {
    let writeError: unknown;
    try {
      yamlCodec.write('a: 1\n', 5);
    } catch (error) {
      writeError = error;
    }
    expect((writeError as CodecError).format).toBe('yaml');
    expect((writeError as CodecError).message).toBe(
      'YAML document must be a map or a sequence',
    );
    expect(() => yamlCodec.parse('5')).toThrow(CodecError);
  });

  it('names the yaml format on a merge-key refusal', () => {
    let caught: unknown;
    try {
      yamlCodec.write('base: &b\n  k: 1\nitem:\n  <<: *b\n', {
        base: { k: 1 },
        item: {},
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as CodecError).message).toBe(
      'Key "k" comes from a merge and cannot be removed',
    );
    expect((caught as CodecError).format).toBe('yaml');
  });

  it('reports the column of a parse error, not 1', () => {
    const error = codecErrorOf(() => yamlCodec.parse('a: 1\n  b: 2\n'));
    expect({
      message: error.message,
      line: error.line,
      column: error.column,
    }).toEqual({
      message: 'Invalid YAML at line 1, column 4: BLOCK_AS_IMPLICIT_KEY',
      line: 1,
      column: 4,
    });
  });

  it('takes the first line break for the layout when the file mixes LF and CRLF', () => {
    expect(yamlCodec.write('a: 1\nb: 2\r\n', { a: 5, b: 2 })).toBe(
      'a: 5\nb: 2\n',
    );
  });

  it('replaces an alias that holds a map with a sequence, as a whole node', () => {
    expect(
      yamlCodec.write('base: &b\n  x: 1\ncopy: *b\n', {
        base: { x: 1 },
        copy: [1, 2],
      }),
    ).toBe('base: &b\n  x: 1\ncopy:\n  - 1\n  - 2\n');
  });

  it('replaces an alias that holds a sequence with a map, as a whole node', () => {
    expect(
      yamlCodec.write('base: &b\n  - 1\ncopy: *b\n', {
        base: [1],
        copy: { x: 1 },
      }),
    ).toBe('base: &b\n  - 1\ncopy:\n  x: 1\n');
  });

  it('replaces a Date with an empty map, and the map is written as a map', () => {
    expect(yamlCodec.write('d: 2020-01-01\n', { d: {} })).toBe('d: {}\n');
  });

  it('replaces a number with an empty map, and an empty map with a number', () => {
    expect(yamlCodec.write('m: 5\n', { m: {} })).toBe('m: {}\n');
    expect(yamlCodec.write('m: {}\n', { m: 5 })).toBe('m: 5\n');
  });

  it('replaces a sequence with an empty string, and an empty sequence too', () => {
    expect(yamlCodec.write('list:\n  - 1\n', { list: '' })).toBe('list: ""\n');
    expect(yamlCodec.write('list: []\n', { list: '' })).toBe('list: ""\n');
  });

  it('ignores a key whose value is undefined, so nothing changes', () => {
    expect(yamlCodec.write('a: 1\n', { a: 1, b: undefined })).toBe('a: 1\n');
  });

  it('writes a changed number as plain text, not in the format of the old one', () => {
    expect(yamlCodec.write('n: 0x1F\n', { n: 32 })).toBe('n: 32\n');
  });

  it('drops the comment of a removed item, and keeps the comments of the others', () => {
    expect(yamlCodec.write('- a # A\n- b # B\n- c # C\n', ['a', 'c'])).toBe(
      '- a # A\n- c # C\n',
    );
  });

  it('keeps an unindented sequence unindented when a comment follows its key', () => {
    expect(yamlCodec.write('key: # note\n- a\n', { key: ['b'] })).toBe(
      'key:\n# note\n- b\n',
    );
    expect(yamlCodec.write('key: # note text\n- a\n', { key: ['b'] })).toBe(
      'key:\n# note text\n- b\n',
    );
  });

  it('keeps the node of a repeated item that is still common, and gives the comment of the other to the new item', () => {
    expect(yamlCodec.write('- a # c0\n- a # c1\n', ['b', 'a'])).toBe(
      '- b # c0\n- a # c1\n',
    );
  });

  it('keeps the node of the last common item when an earlier item is removed', () => {
    expect(yamlCodec.write('- a # c0\n- b # c1\n- a # c2\n', ['c', 'a'])).toBe(
      '- c # c0\n- a # c2\n',
    );
  });

  it('replaces a single item and keeps its comment', () => {
    expect(yamlCodec.write('- a # c0\n', ['b'])).toBe('- b # c0\n');
  });

  it('keeps the node of an item that is common, when a repeated item is replaced by another', () => {
    expect(yamlCodec.write('- a # c0\n- b # c1\n', ['b', 'b'])).toBe(
      '- b # c1\n- b # c0\n',
    );
  });

  it('keeps the comment of the item that stays, when an earlier item is replaced and a middle one removed', () => {
    expect(yamlCodec.write('- a # c0\n- b # c1\n', ['b'])).toBe('- b # c1\n');
    expect(yamlCodec.write('- a # c0\n- b # c1\n- c # c2\n', ['c', 'b'])).toBe(
      '- c # c2\n- b # c1\n',
    );
  });

  it('takes the layout from the key line, not from a sequence item line that follows a dash key', () => {
    expect(yamlCodec.write('- key:\n- v\n', { key: ['q'] })).toBe(
      'key:\n  - q\n',
    );
  });
});

describe('yamlCodec.write', () => {
  it.each(FIXTURE_NAMES)(
    'returns the original text when the value is unchanged (%s)',
    async (name) => {
      const text = await fixture(name);
      expect(yamlCodec.write(text, yamlCodec.parse(text))).toBe(text);
    },
  );

  it('returns the original text when only the key order differs', () => {
    const text = 'name: A\nurl: x\n';
    expect(yamlCodec.write(text, { url: 'x', name: 'A' })).toBe(text);
  });

  it('changes one field and keeps the comments and the date (atlas)', async () => {
    const text = await fixture('partners/atlas.yaml');
    const value = yamlCodec.parse(text) as { name: string };
    value.name = 'Atlas Labs';
    expect(yamlCodec.write(text, value)).toBe(
      text.replace('name: Atlas Studio', 'name: Atlas Labs'),
    );
  });

  it('keeps the inline comment of a changed number (loop order)', async () => {
    const text = await fixture('partners/loop.yaml');
    const value = yamlCodec.parse(text) as { order: number };
    value.order = 2;
    expect(yamlCodec.write(text, value)).toBe(
      text.replace('order: 1 # lowest first', 'order: 2 # lowest first'),
    );
  });

  it('writes a changed Date and keeps the inline comment (atlas since)', async () => {
    const text = await fixture('partners/atlas.yaml');
    const value = yamlCodec.parse(text) as { since: Date };
    value.since = new Date('2024-05-06T00:00:00Z');
    expect(yamlCodec.write(text, value)).toBe(
      text.replace(
        'since: 2022-01-20 # unquoted date',
        'since: 2024-05-06 # unquoted date',
      ),
    );
  });

  it('turns a value that changes type into a plain scalar (atlas order)', async () => {
    const text = await fixture('partners/atlas.yaml');
    const value = yamlCodec.parse(text) as { order: unknown };
    value.order = 'three';
    expect(yamlCodec.write(text, value)).toBe(
      text.replace('order: 3', 'order: three'),
    );
  });

  it('keeps the quote style of a changed string (stats value)', async () => {
    const text = await fixture('stats.yaml');
    const value = yamlCodec.parse(text) as { value: string }[];
    value[0] = { ...value[0], value: '250+' } as { value: string };
    expect(yamlCodec.write(text, value)).toBe(
      text.replace('value: "240+"', 'value: "250+"'),
    );
  });

  it('adds a key last (atlas)', async () => {
    const text = await fixture('partners/atlas.yaml');
    const value = {
      ...(yamlCodec.parse(text) as Record<string, unknown>),
      featured: true,
    };
    expect(yamlCodec.write(text, value)).toBe(`${text}featured: true\n`);
  });

  it('removes a key (bright url)', async () => {
    const text = await fixture('partners/bright.yaml');
    const value = yamlCodec.parse(text) as Record<string, unknown>;
    delete value.url;
    expect(yamlCodec.write(text, value)).toBe(
      text.replace('url: https://example.com/bright\n', ''),
    );
  });

  it('adds a list item after the others (stats)', async () => {
    const text = await fixture('stats.yaml');
    const value = yamlCodec.parse(text) as unknown[];
    value.push({
      id: 'support',
      label: 'Support',
      value: '24/7',
      updated: new Date('2026-10-02T00:00:00Z'),
    });
    expect(yamlCodec.write(text, value)).toBe(
      `${text}- id: support\n  label: Support\n  value: 24/7\n  updated: 2026-10-02\n`,
    );
  });

  it('removes a list item with the comment inside it (stats editors)', async () => {
    const text = await fixture('stats.yaml');
    const value = yamlCodec.parse(text) as unknown[];
    value.splice(1, 1);
    expect(yamlCodec.write(text, value)).toBe(
      text.replace(
        '- id: editors\n  label: Active editors\n  value: "1,800"\n  # comment inside the list\n  updated: 2026-09-14\n',
        '',
      ),
    );
  });

  it('moves an item and keeps its node and quoting (stats uptime)', async () => {
    const text = await fixture('stats.yaml');
    const value = yamlCodec.parse(text) as unknown[];
    const moved = [value[2], value[0], value[1]];
    expect(yamlCodec.write(text, moved)).toBe(
      '# Many documents in one YAML file (file() loader). Dates are unquoted and the\n' +
        '# schema uses a plain z.date().\n' +
        '- id: uptime\n  label: Uptime\n  value: "99.98%"\n  updated: 2026-10-01\n' +
        '- id: sites\n  label: Sites launched\n  value: "240+" # keep as text, it has a suffix\n  updated: 2026-09-01\n' +
        '- id: editors\n  label: Active editors\n  value: "1,800"\n  # comment inside the list\n  updated: 2026-09-14\n',
    );
  });

  it('writes a change of a merged key as an own key that overrides it', () => {
    const text = 'base: &b\n  a: 1\n  b: 2\nchild:\n  <<: *b\n';
    const value = yamlCodec.parse(text) as { child: Record<string, number> };
    value.child.a = 5;
    expect(yamlCodec.write(text, value)).toBe(
      'base: &b\n  a: 1\n  b: 2\nchild:\n  <<: *b\n  a: 5\n',
    );
  });

  it('refuses to remove a key that comes from a merge', () => {
    const text = 'base: &b\n  a: 1\nchild:\n  <<: *b\n';
    const value = yamlCodec.parse(text) as { child: Record<string, number> };
    delete value.child.a;
    expect(codecErrorOf(() => yamlCodec.write(text, value)).message).toBe(
      'Key "a" comes from a merge and cannot be removed',
    );
  });

  it('refuses a change that goes into an alias', () => {
    const text = 'base: &b\n  a: 1\nchild: *b\n';
    const value = { base: { a: 1 }, child: { a: 2 } };
    expect(codecErrorOf(() => yamlCodec.write(text, value)).message).toBe(
      'A change inside an alias cannot be written as YAML',
    );
  });

  it('refuses a value that does not read back as given', () => {
    // A `<<` key is a merge key when the text is read again, so it cannot be written as a plain key.
    expect(
      codecErrorOf(() => yamlCodec.write('a: 1\n', { a: 1, '<<': { b: 2 } }))
        .message,
    ).toBe('Value cannot be written as YAML: it does not read back as given');
  });

  it('refuses a value that is not a map or a sequence', () => {
    expect(codecErrorOf(() => yamlCodec.write('a: 1\n', 'text')).message).toBe(
      'YAML document must be a map or a sequence',
    );
  });

  it('writes a new file as a block document', () => {
    expect(
      yamlCodec.write('', {
        name: 'A',
        since: new Date('2022-01-20T00:00:00Z'),
        list: [1, 'two'],
      }),
    ).toBe('name: A\nsince: 2022-01-20\nlist:\n  - 1\n  - two\n');
  });

  it('keeps CRLF and a missing final newline', () => {
    expect(yamlCodec.write('name: A\r\nurl: x', { name: 'B', url: 'x' })).toBe(
      'name: B\r\nurl: x',
    );
  });

  // The library's own layouts: 2 spaces with unindented sequences, and 4 spaces with indented ones.
  // (4 spaces with unindented sequences is not reproduced: the library indents them.)
  it.each([
    [
      '2 spaces, unindented sequences',
      'a:\n  b: 1\n  list:\n  - x\n',
      'a:\n  b: 2\n  list:\n  - x\n',
    ],
    [
      '4 spaces, indented sequences',
      'a:\n    b: 1\n    list:\n        - x\n',
      'a:\n    b: 2\n    list:\n        - x\n',
    ],
  ])(
    'keeps the indent and the sequence indentation (%s)',
    (_label, text, expected) => {
      const value = yamlCodec.parse(text) as {
        a: { b: number; list: string[] };
      };
      value.a.b = 2;
      expect(yamlCodec.write(text, value)).toBe(expected);
    },
  );

  it('keeps __proto__ as a key when it is changed', () => {
    expect(
      yamlCodec.write(
        'a: 1\n__proto__: x\n',
        Object.fromEntries([
          ['a', 1],
          ['__proto__', 'y'],
        ]),
      ),
    ).toBe('a: 1\n__proto__: y\n');
  });
});
