import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMarkdownProcessor,
  parseFrontmatter,
} from '@astrojs/markdown-remark';
import { describe, expect, it } from 'vitest';
import { markdownCodec } from './frontmatter.ts';
import { CodecError } from './types.ts';

// Byte copies of three of the sample site's files: the home page (frontmatter only, .md), a blog
// post (.md) and the elements page (.mdx).
const FIXTURES = fileURLToPath(
  new URL('../../test/fixtures/markdown/', import.meta.url),
);

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

// The text after the closing fence of a fixture (the body, as the file has it).
function bodyOf(text: string): string {
  return text.slice(text.indexOf('\n---\n') + '\n---\n'.length);
}

describe('markdownCodec.parse', () => {
  it('a file without fences is all body', () => {
    expect(markdownCodec.parse('# Title\n\nText\n')).toEqual({
      data: {},
      body: '# Title\n\nText\n',
    });
  });

  it('reads blog-1.md: the frontmatter as values, the body after the fence exactly', async () => {
    const text = await fixture('blog/blog-1.md');
    const value = markdownCodec.parse(text) as {
      data: Record<string, unknown>;
      body: string;
    };
    expect(value.data).toMatchObject({
      title: 'What you need to know about Photography',
      author: 'ana-torres',
      tags: ['photography', 'design'],
      draft: false,
    });
    expect(value.data.date).toBeInstanceOf(Date);
    expect(value.body).toBe(bodyOf(text));
  });

  it('reads the home page, a file that is only frontmatter: the body is empty', async () => {
    const text = await fixture('homepage/-index.md');
    const value = markdownCodec.parse(text) as {
      data: Record<string, unknown>;
      body: string;
    };
    expect(value.data.banner).toMatchObject({
      title: 'Let us solve your critical website development challenges',
    });
    expect(value.body).toBe('');
  });

  it('reads the MDX elements page: the body keeps its leading blank line', async () => {
    const text = await fixture('pages/elements.mdx');
    expect(markdownCodec.parse(text)).toEqual({
      data: {
        title: 'Elements',
        meta_title: '',
        description: 'this is meta description',
        draft: false,
      },
      body: bodyOf(text),
    });
  });

  it('skips a byte-order mark before the opening fence', () => {
    expect(markdownCodec.parse('﻿---\na: 1\n---\nbody')).toEqual({
      data: { a: 1 },
      body: 'body',
    });
  });

  it('skips blank lines before the opening fence', () => {
    expect(markdownCodec.parse('\n  \n---\na: 1\n---\nbody')).toEqual({
      data: { a: 1 },
      body: 'body',
    });
  });

  it('accepts trailing spaces and tabs on the fence lines', () => {
    expect(markdownCodec.parse('---  \na: 1\n---\t\nbody')).toEqual({
      data: { a: 1 },
      body: 'body',
    });
  });

  it('reads CRLF fences, and keeps CRLF in the body', () => {
    expect(markdownCodec.parse('---\r\na: 1\r\n---\r\nbody\r\n')).toEqual({
      data: { a: 1 },
      body: 'body\r\n',
    });
  });

  it('a --- line in the body is not a fence', () => {
    expect(markdownCodec.parse('---\na: 1\n---\nText\n\n---\n\nMore')).toEqual({
      data: { a: 1 },
      body: 'Text\n\n---\n\nMore',
    });
  });

  it('empty frontmatter is an empty map', () => {
    expect(markdownCodec.parse('---\n---\nbody')).toEqual({
      data: {},
      body: 'body',
    });
  });

  it('comment-only frontmatter is an empty map', () => {
    expect(markdownCodec.parse('---\n# note\n---\nbody')).toEqual({
      data: {},
      body: 'body',
    });
  });

  it('an unclosed fence is a CodecError', () => {
    const error = codecErrorOf(() => markdownCodec.parse('---\na: 1\nbody'));
    expect(error.message).toBe(
      'Frontmatter is not closed: no closing --- line',
    );
    expect(error.format).toBe('markdown');
  });

  it('TOML frontmatter is refused as read-only', () => {
    const error = codecErrorOf(() =>
      markdownCodec.parse('+++\na = 1\n+++\nbody'),
    );
    expect(error.message).toBe(
      'TOML frontmatter (+++) is not supported: the document is read-only',
    );
  });

  it('JSON frontmatter is refused as read-only', () => {
    const error = codecErrorOf(() =>
      markdownCodec.parse(';;;\n{"a": 1}\n;;;\nbody'),
    );
    expect(error.message).toBe(
      'JSON frontmatter (;;;) is not supported: the document is read-only',
    );
  });

  it('frontmatter that is a list, not a map, is a CodecError', () => {
    const error = codecErrorOf(() =>
      markdownCodec.parse('---\n- a\n- b\n---\nbody'),
    );
    expect(error.message).toBe(
      'Frontmatter must be a YAML map: the document is read-only',
    );
  });

  it('a YAML error points at its line in the file, not in the frontmatter', () => {
    const error = codecErrorOf(() =>
      markdownCodec.parse('\n\n---\na: b: c\n---\nbody'),
    );
    expect(error.format).toBe('yaml');
    expect(error.line).toBe(4);
    expect(error.message).toMatch(/^Invalid YAML at line 4, column \d+: /);
  });
});

describe('markdownCodec.write', () => {
  it('returns the original text when nothing changed', async () => {
    for (const name of [
      'homepage/-index.md',
      'blog/blog-1.md',
      'pages/elements.mdx',
    ]) {
      const text = await fixture(name);
      expect(markdownCodec.write(text, markdownCodec.parse(text))).toBe(text);
    }
  });

  it('a frontmatter-only change leaves the body byte for byte (home page, .md)', async () => {
    const text = await fixture('homepage/-index.md');
    const value = markdownCodec.parse(text) as {
      data: { banner: { title: string } };
      body: string;
    };
    value.data.banner.title = 'Changed heading';
    expect(markdownCodec.write(text, value)).toBe(
      text.replace(
        '  title: Let us solve your critical website development challenges\n',
        '  title: Changed heading\n',
      ),
    );
  });

  it('a frontmatter-only change leaves the body byte for byte (elements page, .mdx)', async () => {
    const text = await fixture('pages/elements.mdx');
    const value = markdownCodec.parse(text) as {
      data: Record<string, unknown>;
      body: string;
    };
    value.data.title = 'Elements page';
    expect(markdownCodec.write(text, value)).toBe(
      text.replace('title: "Elements"', 'title: "Elements page"'),
    );
  });

  it('a body-only change leaves the frontmatter byte for byte (blog-1.md)', async () => {
    const text = await fixture('blog/blog-1.md');
    const value = markdownCodec.parse(text) as {
      data: Record<string, unknown>;
      body: string;
    };
    const head = text.slice(0, text.length - bodyOf(text).length);
    expect(
      markdownCodec.write(text, { data: value.data, body: 'New body.\n' }),
    ).toBe(`${head}New body.\n`);
  });

  it('a body-only change keeps CRLF fences', () => {
    expect(
      markdownCodec.write('---\r\na: 1\r\n---\r\nold\r\n', {
        data: { a: 1 },
        body: 'new',
      }),
    ).toBe('---\r\na: 1\r\n---\r\nnew');
  });

  it('empty data keeps the fences and writes nothing between them', () => {
    expect(
      markdownCodec.write('---\na: 1\n---\nbody', { data: {}, body: 'body' }),
    ).toBe('---\n---\nbody');
  });

  it('data added to an empty frontmatter is written between the fences', () => {
    expect(
      markdownCodec.write('---\n---\nbody', {
        data: { title: 'x' },
        body: 'body',
      }),
    ).toBe('---\ntitle: x\n---\nbody');
  });

  it('data added to a file without frontmatter gets fences', () => {
    expect(
      markdownCodec.write('Text\n', { data: { title: 'Hi' }, body: 'Text\n' }),
    ).toBe('---\ntitle: Hi\n---\nText\n');
  });

  it('a BOM file without frontmatter keeps the BOM first, before the new fence, out of the body', () => {
    const output = markdownCodec.write('﻿Text\n', {
      data: { title: 'Hi' },
      body: '﻿Text\n',
    });
    expect(output).toBe('﻿---\ntitle: Hi\n---\nText\n');
    expect(markdownCodec.parse(output)).toEqual({
      data: { title: 'Hi' },
      body: 'Text\n',
    });
  });

  it('an unchanged BOM file without frontmatter is returned as it was', () => {
    const text = '﻿Text\n';
    expect(markdownCodec.write(text, markdownCodec.parse(text))).toBe(text);
  });

  it('empty data on a file without frontmatter writes the body only', () => {
    expect(markdownCodec.write('Text\n', { data: {}, body: 'New\n' })).toBe(
      'New\n',
    );
  });

  it('a body that would read as frontmatter is refused', () => {
    const error = codecErrorOf(() =>
      markdownCodec.write('Text', {
        data: {},
        body: '---\na: 1\n---\nx',
      }),
    );
    expect(error.message).toBe(
      'The body would read as frontmatter: it starts with a --- block',
    );
  });

  it('a value that is not { data, body } is refused', () => {
    const error = codecErrorOf(() => markdownCodec.write('Text', 'x'));
    expect(error.message).toBe(
      'Value must be { data, body }: data a map, body text',
    );
  });
});

// Cases the mutation run found untested: the last line without a newline, comment and blank lines in
// frontmatter, CRLF and LF for new fences, comment-only frontmatter, merge errors without a position,
// the value shape checks, and the position of a YAML error.
describe('markdownCodec: mutation survivors', () => {
  it('reads a closing fence that is the last line, without a newline', () => {
    expect(markdownCodec.parse('---\ntitle: x\n---')).toEqual({
      data: { title: 'x' },
      body: '',
    });
  });

  it('reads a key that follows a comment line in the frontmatter', () => {
    expect(markdownCodec.parse('---\n# note\ntitle: x\n---\nbody\n')).toEqual({
      data: { title: 'x' },
      body: 'body\n',
    });
  });

  it('treats a whitespace-only line in the frontmatter as blank', () => {
    expect(markdownCodec.parse('---\n   \n---\nbody')).toEqual({
      data: {},
      body: 'body',
    });
  });

  it('reads whitespace-only text without a newline as a body', () => {
    expect(markdownCodec.parse('  ')).toEqual({ data: {}, body: '  ' });
  });

  it('writes LF fences for a file with LF line endings', () => {
    expect(
      markdownCodec.write('Body\n', { data: { title: 'x' }, body: 'Body\n' }),
    ).toBe('---\ntitle: x\n---\nBody\n');
  });

  it('writes CRLF fences and YAML for a CRLF file without frontmatter', () => {
    expect(
      markdownCodec.write('Body\r\n', {
        data: { title: 'x' },
        body: 'Body\r\n',
      }),
    ).toBe('---\r\ntitle: x\r\n---\r\nBody\r\n');
  });

  it('replaces comment-only frontmatter with the new YAML, as a new block', () => {
    expect(
      markdownCodec.write('---\n# note\n---\nbody\n', {
        data: { title: 'x' },
        body: 'body\n',
      }),
    ).toBe('---\ntitle: x\n---\nbody\n');
  });

  it('a YAML error with no position stays without one, and names the yaml format', () => {
    const original = '---\nbase: &b\n  k: 1\nitem:\n  <<: *b\n---\nbody\n';
    let caught: unknown;
    try {
      markdownCodec.write(original, {
        data: { base: { k: 1 }, item: {} },
        body: 'body\n',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CodecError);
    const error = caught as CodecError;
    expect(error.message).toBe(
      'Key "k" comes from a merge and cannot be removed',
    );
    expect(error.format).toBe('yaml');
    expect(error.line).toBeUndefined();
    expect(error.column).toBeUndefined();
  });

  it('points a YAML error at its line and column in the file', () => {
    let caught: unknown;
    try {
      markdownCodec.parse('---\ntitle: "unclosed\n---\nbody\n');
    } catch (error) {
      caught = error;
    }
    const error = caught as CodecError;
    expect(error).toBeInstanceOf(CodecError);
    // The library reports an unclosed quote where the scalar ends: raw line 2, column 1, which is
    // file line 3 after the opening fence.
    expect(error.line).toBe(3);
    expect(error.column).toBe(1);
    expect(error.format).toBe('yaml');
  });

  it('reads an indented comment line in the frontmatter as blank', () => {
    expect(markdownCodec.parse('---\n  # note\n---\nbody')).toEqual({
      data: {},
      body: 'body',
    });
  });

  it('refuses a body that would read as frontmatter, with the markdown format', () => {
    let caught: unknown;
    try {
      markdownCodec.write('Body\n', {
        data: {},
        body: '---\na: 1\n---\n',
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as CodecError).message).toBe(
      'The body would read as frontmatter: it starts with a --- block',
    );
    expect((caught as CodecError).format).toBe('markdown');
  });

  it.each([
    ['null', null],
    ['data that is a string', { data: 'x', body: '' }],
    ['data that is an array', { data: ['a'], body: '' }],
    ['a body that is a number', { data: { a: 1 }, body: 5 }],
    ['no body', { data: { a: 1 } }],
  ])('refuses a value with %s as not { data, body }', (_label, value) => {
    let caught: unknown;
    try {
      markdownCodec.write('Body\n', value);
    } catch (error) {
      caught = error;
    }
    const error = caught as CodecError;
    expect(error).toBeInstanceOf(CodecError);
    expect(error.message).toBe(
      'Value must be { data, body }: data a map, body text',
    );
    expect(error.format).toBe('markdown');
  });
});

describe('markdownCodec and Astro', () => {
  it('a body with leading blank lines renders as Astro renders the same file', async () => {
    const text = '---\ntitle: x\n---\n\n\n# Hi\n\nBody\n';
    const value = markdownCodec.parse(text) as {
      data: unknown;
      body: string;
    };
    const astro = parseFrontmatter(text);
    expect(value.data).toEqual(astro.frontmatter);
    const processor = await createMarkdownProcessor();
    const ours = await processor.render(value.body);
    const theirs = await processor.render(astro.content);
    expect(ours.code).toBe(theirs.code);
  });
});
