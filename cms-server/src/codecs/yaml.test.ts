import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { yamlCodec } from './yaml.ts';
import { CodecError } from './types.ts';

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
