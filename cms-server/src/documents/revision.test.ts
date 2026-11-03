import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { revisionOf, revisionOfEntry } from 'preview-contract';
import { afterEach, describe, expect, it } from 'vitest';
import {
  removeWorkingCopies,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import type { DocumentEntry } from '../bundle/read.ts';
import { CodecError } from '../codecs/types.ts';
import type { FileReads } from './read.ts';
import { revisionOfDocument } from './revision.ts';

afterEach(() => removeWorkingCopies());

/** A bundle document record with the given fields; `buildTime` and `revision` have values the tests do not use. */
const doc = (
  fields: Pick<DocumentEntry, 'key' | 'format'> & Partial<DocumentEntry>,
): DocumentEntry => ({
  buildTime: false,
  revision: 'manifest-value',
  ...fields,
});

describe('revisionOfDocument: a document with a file of its own', () => {
  it('has the revision of the file bytes, and the parsed value when it is wanted', async () => {
    const root = await tempWorkingCopy({ 'src/a.json': '{"a":1}' });
    const facts = await revisionOfDocument(
      root,
      doc({ key: 'a', file: 'src/a.json', format: 'json' }),
      new Map(),
      true,
    );
    expect(facts).toStrictEqual({
      revision: revisionOf('{"a":1}'),
      value: { a: 1 },
    });
  });

  it('does not parse the file when the value is not wanted, so a broken file has no error', async () => {
    const text = '{"a":';
    const root = await tempWorkingCopy({ 'src/a.json': text });
    const facts = await revisionOfDocument(
      root,
      doc({ key: 'a', file: 'src/a.json', format: 'json' }),
      new Map(),
      false,
    );
    expect(facts).toStrictEqual({ revision: revisionOf(text) });
  });

  it('keeps the revision of a file that does not parse, with the codec error', async () => {
    const text = '{"a":';
    const root = await tempWorkingCopy({ 'src/a.json': text });
    const facts = await revisionOfDocument(
      root,
      doc({ key: 'a', file: 'src/a.json', format: 'json' }),
      new Map(),
      true,
    );
    expect(facts?.revision).toBe(revisionOf(text));
    expect(facts?.error).toBeInstanceOf(CodecError);
    expect(facts?.value).toBeUndefined();
  });

  it('keeps the revision of a Markdown file whose frontmatter is TOML, with the refusal as the error', async () => {
    const text = '+++\ntitle = "x"\n+++\nBody\n';
    const root = await tempWorkingCopy({ 'src/post.md': text });
    const facts = await revisionOfDocument(
      root,
      doc({ key: 'post', file: 'src/post.md', format: 'md' }),
      new Map(),
      true,
    );
    expect(facts?.revision).toBe(revisionOf(text));
    expect(facts?.error?.message).toBe(
      'TOML frontmatter (+++) is not supported: the document is read-only',
    );
  });

  it('has no value and no parse for a format with no codec', async () => {
    const text = 'a = 1\n';
    const root = await tempWorkingCopy({ 'src/rules.toml': text });
    const facts = await revisionOfDocument(
      root,
      doc({ key: 'rules', file: 'src/rules.toml', format: 'toml' }),
      new Map(),
      true,
    );
    expect(facts).toStrictEqual({ revision: revisionOf(text) });
  });
});

describe('revisionOfDocument: a file() entry', () => {
  const shared = '[{"id":"t1","quote":"One"},{"id":"t2","quote":"Two"}]';
  const entryDoc = doc({
    key: 'testimonials/t2',
    file: 'src/testimonials.json',
    format: 'json',
    entryKey: 't2',
  });

  it('has the revision of its raw entry without the id, and the entry with its id as the value', async () => {
    const root = await tempWorkingCopy({ 'src/testimonials.json': shared });
    const facts = await revisionOfDocument(root, entryDoc, new Map(), true);
    expect(facts).toStrictEqual({
      revision: revisionOfEntry({ quote: 'Two' }),
      value: { id: 't2', quote: 'Two' },
    });
  });

  it('finds an entry of the object form by its key', async () => {
    const root = await tempWorkingCopy({
      'src/testimonials.json': '{"t1":{"quote":"One"}}',
    });
    const facts = await revisionOfDocument(
      root,
      doc({
        key: 'x/t1',
        file: 'src/testimonials.json',
        format: 'json',
        entryKey: 't1',
      }),
      new Map(),
      false,
    );
    expect(facts).toStrictEqual({
      revision: revisionOfEntry({ quote: 'One' }),
    });
  });

  it('hashes an unquoted YAML date as the Date Astro reads', async () => {
    const root = await tempWorkingCopy({
      'src/stats.yaml': '- id: s1\n  since: 2022-01-20\n',
    });
    const facts = await revisionOfDocument(
      root,
      doc({
        key: 'stats/s1',
        file: 'src/stats.yaml',
        format: 'yaml',
        entryKey: 's1',
      }),
      new Map(),
      false,
    );
    expect(facts?.revision).toBe(
      revisionOfEntry({ since: new Date('2022-01-20T00:00:00Z') }),
    );
    expect(facts?.revision).not.toBe(revisionOfEntry({ since: '2022-01-20' }));
  });

  it('does not change when another entry of the shared file is reformatted, and changes when its own entry changes', async () => {
    const reformatted =
      '[\n  { "id": "t1", "quote": "One, reworded" },\n  {"id":"t2","quote":"Two"}\n]\n';
    const changed = '[{"id":"t1","quote":"One"},{"id":"t2","quote":"Two!"}]';
    const original = await revisionOfDocument(
      await tempWorkingCopy({ 'src/testimonials.json': shared }),
      entryDoc,
      new Map(),
      false,
    );
    const other = await revisionOfDocument(
      await tempWorkingCopy({ 'src/testimonials.json': reformatted }),
      entryDoc,
      new Map(),
      false,
    );
    const own = await revisionOfDocument(
      await tempWorkingCopy({ 'src/testimonials.json': changed }),
      entryDoc,
      new Map(),
      false,
    );
    expect(other?.revision).toBe(original?.revision);
    expect(own?.revision).not.toBe(original?.revision);
  });

  it('gives a null revision and the codec error when the shared file does not parse', async () => {
    const root = await tempWorkingCopy({ 'src/testimonials.json': '[' });
    const facts = await revisionOfDocument(root, entryDoc, new Map(), false);
    expect(facts?.revision).toBeNull();
    expect(facts?.error).toBeInstanceOf(CodecError);
  });

  it('gives a null revision and no error for an entry whose format has no codec', async () => {
    const root = await tempWorkingCopy({ 'src/rules.toml': 'a = 1\n' });
    const facts = await revisionOfDocument(
      root,
      doc({
        key: 'rules/a',
        file: 'src/rules.toml',
        format: 'toml',
        entryKey: 'a',
      }),
      new Map(),
      true,
    );
    expect(facts).toStrictEqual({ revision: null });
  });

  it('reads a shared file once per request: a second entry is found after the file is gone', async () => {
    const root = await tempWorkingCopy({ 'src/testimonials.json': shared });
    const reads: FileReads = new Map();
    const first = await revisionOfDocument(root, entryDoc, reads, false);
    await rm(join(root, 'src/testimonials.json'));
    const second = await revisionOfDocument(
      root,
      doc({
        key: 'testimonials/t1',
        file: 'src/testimonials.json',
        format: 'json',
        entryKey: 't1',
      }),
      reads,
      false,
    );
    expect(first?.revision).toBe(revisionOfEntry({ quote: 'Two' }));
    expect(second?.revision).toBe(revisionOfEntry({ quote: 'One' }));
  });
});

describe('revisionOfDocument: a document that is missing', () => {
  it('is null for a document with no file', async () => {
    const root = await tempWorkingCopy({});
    expect(
      await revisionOfDocument(
        root,
        doc({ key: 'loose', format: 'other' }),
        new Map(),
        true,
      ),
    ).toBeNull();
  });

  it('is null when its file is gone', async () => {
    const root = await tempWorkingCopy({});
    expect(
      await revisionOfDocument(
        root,
        doc({ key: 'a', file: 'src/a.json', format: 'json' }),
        new Map(),
        true,
      ),
    ).toBeNull();
  });

  it('is null when its entry is not in its file', async () => {
    const root = await tempWorkingCopy({
      'src/testimonials.json': '[{"id":"t1"}]',
    });
    expect(
      await revisionOfDocument(
        root,
        doc({
          key: 'testimonials/t9',
          file: 'src/testimonials.json',
          format: 'json',
          entryKey: 't9',
        }),
        new Map(),
        true,
      ),
    ).toBeNull();
  });
});
