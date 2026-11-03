import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  changeEntry,
  type EntryChange,
  type EntryFormat,
} from './file-entries.ts';
import { jsonCodec } from './json.ts';
import { CodecError } from './types.ts';
import { yamlCodec } from './yaml.ts';

const FIXTURES = fileURLToPath(
  new URL('../../test/fixtures/', import.meta.url),
);
const JSON_FORMAT: EntryFormat = { name: 'json', codec: jsonCodec };
const YAML_FORMAT: EntryFormat = { name: 'yaml', codec: yamlCodec };

async function fixture(path: string): Promise<string> {
  return readFile(join(FIXTURES, path), 'utf8');
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

// Cases the mutation run found untested: id edge cases, presence checks, the keyed replace, and the
// `format` of every error.
describe('changeEntry: ids, presence, keyed replace and error formats', () => {
  it('takes the key as the id when the value has a null or empty id, and drops that id', () => {
    const original = '[\n  {\n    "id": "a"\n  }\n]\n';
    for (const id of [null, '']) {
      const result = changeEntry(JSON_FORMAT, original, {
        op: 'add',
        key: 'b',
        value: { id, title: 'B' },
      });
      expect(jsonCodec.parse(result)).toEqual([
        { id: 'a' },
        { id: 'b', title: 'B' },
      ]);
    }
  });

  it('leaves items with no id, or a null id, out of the duplicate check', () => {
    const noId = '[\n  { "title": "x" },\n  { "title": "y" }\n]\n';
    const nullId =
      '[\n  { "id": null, "title": "x" },\n  { "id": null, "title": "y" }\n]\n';
    // `id ?? slug` is null only when the slug is null: that is the one way raw can be null.
    const nullSlug =
      '[\n  { "slug": null, "title": "x" },\n  { "slug": null, "title": "y" }\n]\n';
    for (const original of [noId, nullId, nullSlug]) {
      const result = changeEntry(JSON_FORMAT, original, {
        op: 'add',
        key: 'z',
        value: { title: 'z' },
      });
      const [first, second] = jsonCodec.parse(original) as unknown[];
      expect(jsonCodec.parse(result)).toEqual([
        first,
        second,
        { id: 'z', title: 'z' },
      ]);
    }
  });

  it('treats an empty id as no id, so two empty ids are not duplicates', () => {
    const original =
      '[\n  { "id": "", "title": "x" },\n  { "id": "", "title": "y" }\n]\n';
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'add',
      key: 'z',
      value: { title: 'z' },
    });
    expect(jsonCodec.parse(result)).toEqual([
      { id: '', title: 'x' },
      { id: '', title: 'y' },
      { id: 'z', title: 'z' },
    ]);
  });

  it('does not find an entry by the text of an empty id', () => {
    const original = '[\n  { "id": "", "title": "x" }\n]\n';
    const error = codecErrorOf(() =>
      changeEntry(JSON_FORMAT, original, {
        op: 'replace',
        key: 'Stryker was here!',
        value: { title: 'z' },
      }),
    );
    expect(error.message).toBe('No entry with the id "Stryker was here!"');
  });

  it('names the json format on the array-shape errors', () => {
    const duplicate = '[\n  { "id": "a" },\n  { "id": "a" }\n]\n';
    const numeric = '[\n  { "id": 1 }\n]\n';
    const whole = '[\n  { "id": "a" }\n]\n';
    expect(
      codecErrorOf(() =>
        changeEntry(JSON_FORMAT, duplicate, {
          op: 'replace',
          key: 'a',
          value: { title: 'z' },
        }),
      ).format,
    ).toBe('json');
    expect(
      codecErrorOf(() =>
        changeEntry(JSON_FORMAT, numeric, { op: 'add', key: 'abc', value: {} }),
      ).format,
    ).toBe('json');
    expect(
      codecErrorOf(() =>
        changeEntry(JSON_FORMAT, whole, {
          op: 'add',
          key: 'x',
          value: undefined,
        }),
      ).format,
    ).toBe('json');
    expect(
      codecErrorOf(() =>
        changeEntry(JSON_FORMAT, whole, {
          op: 'replace',
          key: 'a',
          value: 'text',
        }),
      ).format,
    ).toBe('json');
  });

  it('refuses to add a key that already exists, and names the format', () => {
    const original = '{\n  "a": 1\n}\n';
    const error = codecErrorOf(() =>
      changeEntry(JSON_FORMAT, original, { op: 'add', key: 'a', value: 2 }),
    );
    expect(error.message).toBe('An entry with the id "a" already exists');
    expect(error.format).toBe('json');
  });

  it('names the format on the $schema refusal', () => {
    const error = codecErrorOf(() =>
      changeEntry(JSON_FORMAT, '{\n  "a": 1\n}\n', {
        op: 'add',
        key: '$schema',
        value: 'x',
      }),
    );
    expect(error.message).toBe('"$schema" is not an entry');
    expect(error.format).toBe('json');
  });

  it('replaces only the named entry of a keyed file', () => {
    const original = '{\n  "a": 1,\n  "b": 2\n}\n';
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'replace',
      key: 'b',
      value: 3,
    });
    expect(jsonCodec.parse(result)).toEqual({ a: 1, b: 3 });
  });
});

const PRIYA_LINE = '"Priya Nair"';

describe('changeEntry on an array file (testimonials.json)', () => {
  it('replaces one entry and leaves every other entry byte for byte', async () => {
    const original = await fixture('json/testimonials.json');
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'replace',
      key: 't-ana',
      value: {
        id: 't-ana',
        name: 'Priya N.',
        role: 'CTO, Northwind Labs',
        quote:
          'We shipped our new site in a week. Editing content never needs a developer now.',
        avatar: '../assets/authors/ana-torres.png',
      },
    });
    expect(result).toBe(original.replace(PRIYA_LINE, '"Priya N."'));
  });

  it('adds an entry at the end, with its id first when the value has none', async () => {
    const original = await fixture('json/testimonials.json');
    const added = [
      '  {',
      '    "id": "t-lee",',
      '    "name": "Lee",',
      '    "role": "Editor",',
      '    "quote": "Quick.",',
      '    "avatar": "../assets/authors/lee.png"',
      '  }',
    ].join('\n');
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'add',
      key: 't-lee',
      value: {
        name: 'Lee',
        role: 'Editor',
        quote: 'Quick.',
        avatar: '../assets/authors/lee.png',
      },
    });
    expect(result).toBe(`${original.slice(0, -3)},\n${added}\n]\n`);
  });

  it('removes one entry and leaves the others byte for byte', async () => {
    const original = await fixture('json/testimonials.json');
    const marco = [
      '  {',
      '    "id": "t-marco",',
      '    "name": "Tom Becker",',
      '    "role": "Founder, Loop & Co",',
      '    "quote": "Fast pages, clean markup and a support team that actually answers.",',
      '    "avatar": "../assets/authors/marco-rossi.png"',
      '  },',
      '',
    ].join('\n');
    expect(
      changeEntry(JSON_FORMAT, original, { op: 'remove', key: 't-marco' }),
    ).toBe(original.replace(marco, ''));
  });

  it('replaces one entry of a YAML file and keeps its comments and the other lines', async () => {
    const original = await fixture('yaml/stats.yaml');
    const result = changeEntry(YAML_FORMAT, original, {
      op: 'replace',
      key: 'editors',
      value: {
        id: 'editors',
        label: 'Active editors',
        value: '1,900',
        updated: new Date('2026-09-14'),
      },
    });
    expect(result).toBe(original.replace('value: "1,800"', 'value: "1,900"'));
  });

  it('removes one entry of a YAML file and keeps the comments of the others', async () => {
    const original = await fixture('yaml/stats.yaml');
    const editors = [
      '- id: editors',
      '  label: Active editors',
      '  value: "1,800"',
      '  # comment inside the list',
      '  updated: 2026-09-14',
      '',
    ].join('\n');
    expect(
      changeEntry(YAML_FORMAT, original, { op: 'remove', key: 'editors' }),
    ).toBe(original.replace(editors, ''));
  });

  it('leaves a valid empty array when the last entry is removed (JSON)', () => {
    const one = '[\n  {\n    "id": "only",\n    "name": "x"\n  }\n]\n';
    expect(changeEntry(JSON_FORMAT, one, { op: 'remove', key: 'only' })).toBe(
      '[]\n',
    );
  });

  it('leaves a valid empty sequence when the last entry is removed (YAML)', () => {
    expect(
      changeEntry(YAML_FORMAT, '- id: only\n  label: x\n', {
        op: 'remove',
        key: 'only',
      }),
    ).toBe('[]\n');
  });

  it('finds an entry by its slug when the item has no id', () => {
    const original =
      '[\n  {\n    "slug": "a",\n    "v": 1\n  },\n  {\n    "slug": "b",\n    "v": 2\n  }\n]\n';
    expect(
      changeEntry(JSON_FORMAT, original, {
        op: 'replace',
        key: 'a',
        value: { slug: 'a', v: 3 },
      }),
    ).toBe(original.replace('"v": 1', '"v": 3'));
  });

  it('leaves items without an id or slug, and non-object items, alone', () => {
    const original =
      '[\n  null,\n  "text",\n  {\n    "name": "no id"\n  },\n  {\n    "id": "a",\n    "v": 1\n  }\n]\n';
    expect(
      changeEntry(JSON_FORMAT, original, {
        op: 'replace',
        key: 'a',
        value: { id: 'a', v: 2 },
      }),
    ).toBe(original.replace('"v": 1', '"v": 2'));
  });

  it.each<[string, EntryChange]>([
    ['replace', { op: 'replace', key: 't-ana', value: { id: 't-other' } }],
    ['add', { op: 'add', key: 't-ana', value: { id: 't-ana' } }],
  ])(
    'refuses %s when the entry id and key differ or already exists',
    async (_name, change) => {
      const original = await fixture('json/testimonials.json');
      const error = codecErrorOf(() =>
        changeEntry(JSON_FORMAT, original, change),
      );
      expect(error.message).toBe(
        change.op === 'add'
          ? 'An entry with the id "t-ana" already exists'
          : 'Entry id "t-other" does not match the key "t-ana"',
      );
      expect(error.format).toBe('json');
    },
  );

  it.each<[string, EntryChange]>([
    ['replace', { op: 'replace', key: 't-zed', value: { id: 't-zed' } }],
    ['remove', { op: 'remove', key: 't-zed' }],
  ])('refuses %s of an id that is not in the file', async (_name, change) => {
    const original = await fixture('json/testimonials.json');
    const error = codecErrorOf(() =>
      changeEntry(JSON_FORMAT, original, change),
    );
    expect(error.message).toBe('No entry with the id "t-zed"');
    expect(error.format).toBe('json');
  });

  it('refuses an entry value that is not an object', async () => {
    const original = await fixture('json/testimonials.json');
    const error = codecErrorOf(() =>
      changeEntry(JSON_FORMAT, original, {
        op: 'replace',
        key: 't-ana',
        value: 'text',
      }),
    );
    expect(error.message).toBe('An array entry must be an object');
  });

  it('refuses an undefined value', async () => {
    const original = await fixture('json/testimonials.json');
    const error = codecErrorOf(() =>
      changeEntry(JSON_FORMAT, original, {
        op: 'add',
        key: 't-new',
        value: undefined,
      }),
    );
    expect(error.message).toBe('An entry value cannot be undefined');
  });

  it('refuses a file whose top level is neither an array nor an object', () => {
    const error = codecErrorOf(() =>
      changeEntry(JSON_FORMAT, '"text"\n', { op: 'remove', key: 'x' }),
    );
    expect(error.message).toBe('Entries must be an array or an object');
    expect(error.format).toBe('json');
  });

  it.each<[string, EntryChange]>([
    ['add', { op: 'add', key: 'c', value: { id: 'c' } }],
    ['replace', { op: 'replace', key: 'a', value: { id: 'a' } }],
    ['remove', { op: 'remove', key: 'a' }],
  ])(
    'refuses every change to a file with a duplicate id (%s)',
    (_name, change) => {
      const duplicate = '[\n  { "id": "a" },\n  { "id": "a" }\n]\n';
      const error = codecErrorOf(() =>
        changeEntry(JSON_FORMAT, duplicate, change),
      );
      expect(error.message).toBe(
        'Duplicate entry id "a": the site does not build with duplicate ids',
      );
    },
  );

  it('writes a numeric id as a number when the file uses numbers', () => {
    const original =
      '[\n  { "id": 1, "v": "a" },\n  { "id": 2, "v": "b" }\n]\n';
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'add',
      key: '3',
      value: { v: 'c' },
    });
    expect(JSON.parse(result)).toEqual([
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
      { id: 3, v: 'c' },
    ]);
  });

  it.each(['abc', '03'])('refuses the key %s as a numeric id', (key) => {
    const original = '[\n  { "id": 1 }\n]\n';
    const error = codecErrorOf(() =>
      changeEntry(JSON_FORMAT, original, { op: 'add', key, value: { v: 'c' } }),
    );
    expect(error.message).toBe(
      `Entry id "${key}" must be a number, as the file's other ids are`,
    );
  });

  it('keeps a string id when a replace of a string-id entry has no id, in a mixed-id array', () => {
    const original =
      '[\n  { "id": 1, "v": "a" },\n  { "id": "hello", "v": "b" }\n]\n';
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'replace',
      key: 'hello',
      value: { v: 'c' },
    });
    expect(JSON.parse(result)).toEqual([
      { id: 1, v: 'a' },
      { id: 'hello', v: 'c' },
    ]);
  });

  it('keeps a number id when a replace of a number-id entry has no id, in a mixed-id array', () => {
    const original =
      '[\n  { "id": 1, "v": "a" },\n  { "id": "hello", "v": "b" }\n]\n';
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'replace',
      key: '1',
      value: { v: 'c' },
    });
    expect(JSON.parse(result)).toEqual([
      { id: 1, v: 'c' },
      { id: 'hello', v: 'b' },
    ]);
  });

  it('types an added id from the file-wide guess, unchanged, in a mixed-id array', () => {
    const original =
      '[\n  { "id": 1, "v": "a" },\n  { "id": "hello", "v": "b" }\n]\n';
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'add',
      key: '3',
      value: { v: 'c' },
    });
    expect(JSON.parse(result)).toEqual([
      { id: 1, v: 'a' },
      { id: 'hello', v: 'b' },
      { id: 3, v: 'c' },
    ]);
  });
});

describe('changeEntry on a keyed file (keyed.json)', () => {
  it('replaces one entry and leaves the others byte for byte', async () => {
    const original = await fixture('entries/keyed.json');
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'replace',
      key: 'about',
      value: { title: 'About Us', lang: 'en' },
    });
    expect(result).toBe(original.replace('"About us"', '"About Us"'));
  });

  it('adds an entry after the last key', async () => {
    const original = await fixture('entries/keyed.json');
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'add',
      key: 'faq',
      value: { title: 'FAQ', lang: 'en' },
    });
    expect(result).toBe(
      `${original.slice(0, -3)},\n  "faq": {\n    "title": "FAQ",\n    "lang": "en"\n  }\n}\n`,
    );
  });

  it('removes one entry and leaves the others byte for byte', async () => {
    const original = await fixture('entries/keyed.json');
    const about =
      '  "about": {\n    "title": "About us",\n    "lang": "en"\n  },\n';
    expect(
      changeEntry(JSON_FORMAT, original, { op: 'remove', key: 'about' }),
    ).toBe(original.replace(about, ''));
  });

  it('leaves a valid empty object when the last entry is removed', () => {
    const one = '{\n  "only": {\n    "x": 1\n  }\n}\n';
    expect(changeEntry(JSON_FORMAT, one, { op: 'remove', key: 'only' })).toBe(
      '{\n}\n',
    );
  });

  it('keeps a key with a hostile name as an ordinary key', async () => {
    const original = await fixture('entries/keyed.json');
    const result = changeEntry(JSON_FORMAT, original, {
      op: 'add',
      key: '__proto__',
      value: { title: 'Hostile' },
    });
    expect(Object.keys(JSON.parse(result))).toEqual([
      '$schema',
      'home',
      'about',
      'contact',
      '__proto__',
    ]);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'does not find the key %s unless the file has it',
    async (key) => {
      const original = await fixture('entries/keyed.json');
      const error = codecErrorOf(() =>
        changeEntry(JSON_FORMAT, original, { op: 'replace', key, value: {} }),
      );
      expect(error.message).toBe(`No entry with the id "${key}"`);
    },
  );

  it.each<[string, EntryChange]>([
    ['add', { op: 'add', key: '$schema', value: 'x' }],
    ['replace', { op: 'replace', key: '$schema', value: 'x' }],
    ['remove', { op: 'remove', key: '$schema' }],
  ])('refuses %s of the $schema key', async (_name, change) => {
    const original = await fixture('entries/keyed.json');
    const error = codecErrorOf(() =>
      changeEntry(JSON_FORMAT, original, change),
    );
    expect(error.message).toBe('"$schema" is not an entry');
  });
});

describe('changeEntry on a keyed YAML file', () => {
  it('replaces one entry and changes only the edited line', async () => {
    const original = await fixture('entries/keyed.yaml');
    const result = changeEntry(YAML_FORMAT, original, {
      op: 'replace',
      key: 'about',
      value: { title: 'About Us', lang: 'en' },
    });
    expect(result).toBe(
      original.replace('  title: About us', '  title: About Us'),
    );
  });

  it('leaves a valid empty mapping when the last entry is removed', () => {
    expect(
      changeEntry(YAML_FORMAT, 'only:\n  x: 1\n', {
        op: 'remove',
        key: 'only',
      }),
    ).toBe('{}\n');
  });

  it('refuses a change that reaches an alias, as the YAML codec does', async () => {
    const original = await fixture('entries/alias.yaml');
    const error = codecErrorOf(() =>
      changeEntry(YAML_FORMAT, original, {
        op: 'replace',
        key: 'home',
        value: { title: 'Hi', lang: 'en' },
      }),
    );
    expect(error.message).toBe(
      'Value cannot be written as YAML: it does not read back as given',
    );
    expect(error.format).toBe('yaml');
  });

  it('replaces an entry that is not an alias target', async () => {
    const original = await fixture('entries/alias.yaml');
    const result = changeEntry(YAML_FORMAT, original, {
      op: 'replace',
      key: 'contact',
      value: { title: 'C2', lang: 'fr' },
    });
    expect(result).toBe(
      original.replace('  title: Contact\n', '  title: C2\n'),
    );
  });
});
