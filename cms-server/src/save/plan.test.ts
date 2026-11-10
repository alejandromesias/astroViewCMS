import { afterEach, describe, expect, it } from 'vitest';
import {
  removeWorkingCopies,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import {
  authorsCollections,
  bundleOf,
  documentOf,
  saveContext,
} from '../../test/helpers/save-context.ts';
import type { SaveChange } from './body.ts';
import { planChanges } from './plan.ts';

const ANA = 'src/content/authors/ana.json';
const ANA_TEXT = '{\n  "name": "Ana"\n}\n';

afterEach(removeWorkingCopies);

// A save context over the authors collection, with `documents` as the bundle's (and the visible ones).
function contextFor(
  siteFolder: string,
  changes: SaveChange[],
  documents = [documentOf('authors/ana', { file: ANA })],
) {
  const bundle = bundleOf(documents, authorsCollections());
  return saveContext({
    siteFolder,
    bundle,
    documents: bundle.documents,
    changes,
  });
}

describe('planChanges', () => {
  it('plans an update as a write of the document file, and a delete as a removed file', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const ctx = contextFor(siteFolder, [
      {
        document: 'authors/ana',
        baseRevision: 'r',
        deleted: false,
        data: { name: 'Ana Torres' },
      },
    ]);
    expect(await planChanges(ctx)).toBeUndefined();
    expect(ctx.plan).toStrictEqual([
      {
        op: 'write',
        path: ANA,
        text: '{\n  "name": "Ana Torres"\n}\n',
      },
    ]);
  });

  it('plans a delete as a removal of the file', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const ctx = contextFor(siteFolder, [
      { document: 'authors/ana', baseRevision: 'r', deleted: true },
    ]);
    expect(await planChanges(ctx)).toBeUndefined();
    expect(ctx.plan).toStrictEqual([{ op: 'delete', path: ANA }]);
  });

  it('plans a create of a document nobody has as a new file in the collection', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const ctx = contextFor(siteFolder, [
      {
        document: 'authors/lee',
        baseRevision: null,
        deleted: false,
        data: { name: 'Lee' },
      },
    ]);
    expect(await planChanges(ctx)).toBeUndefined();
    expect(ctx.plan).toStrictEqual([
      {
        op: 'write',
        path: 'src/content/authors/lee.json',
        text: '{\n  "name": "Lee"\n}\n',
      },
    ]);
  });

  it('answers 400 invalid-body for a create whose key has no collection', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const ctx = contextFor(siteFolder, [
      { document: 'lee', baseRevision: null, deleted: false, data: {} },
    ]);
    expect(await planChanges(ctx)).toStrictEqual({
      status: 400,
      body: {
        error: 'invalid-body',
        message: 'A new document needs a key of the form collection/id: "lee"',
      },
    });
  });

  it('answers the code of a planWrite refusal, with its key', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const ctx = contextFor(siteFolder, [
      { document: 'authors/ana', baseRevision: 'r', deleted: true },
      { document: 'authors/ana', baseRevision: 'r', deleted: false, data: {} },
    ]);
    expect(await planChanges(ctx)).toStrictEqual({
      status: 400,
      body: {
        error: 'duplicate-key',
        key: 'authors/ana',
        message: 'More than one change to "authors/ana" in one save',
        file: undefined,
        line: undefined,
        column: undefined,
      },
    });
  });

  it('answers 409 file-missing when the file of an update is gone', async () => {
    const siteFolder = await tempWorkingCopy({});
    const ctx = contextFor(siteFolder, [
      {
        document: 'authors/ana',
        baseRevision: 'r',
        deleted: false,
        data: { name: 'Ana' },
      },
    ]);
    expect(await planChanges(ctx)).toStrictEqual({
      status: 409,
      body: {
        error: 'file-missing',
        key: 'authors/ana',
        message: `The file "${ANA}" is missing`,
        file: ANA,
        line: undefined,
        column: undefined,
      },
    });
  });

  it('answers 409 exists for a create over a file that is already there', async () => {
    const siteFolder = await tempWorkingCopy({
      'src/content/authors/lee.json': '{}\n',
    });
    const ctx = contextFor(siteFolder, [
      { document: 'authors/lee', baseRevision: null, deleted: false, data: {} },
    ]);
    expect(await planChanges(ctx)).toStrictEqual({
      status: 409,
      body: {
        error: 'exists',
        key: 'authors/lee',
        message: 'The file "src/content/authors/lee.json" already exists',
        file: 'src/content/authors/lee.json',
        line: undefined,
        column: undefined,
      },
    });
  });

  it('answers 400 pattern-mismatch for an id the build would not give', async () => {
    const siteFolder = await tempWorkingCopy({});
    const ctx = contextFor(siteFolder, [
      {
        document: 'authors/My Lee',
        baseRevision: null,
        deleted: false,
        data: {},
      },
    ]);
    expect(await planChanges(ctx)).toMatchObject({
      status: 400,
      body: { error: 'pattern-mismatch', key: 'authors/My Lee' },
    });
  });

  it('answers 422 read-only for a document the manifest marks read-only', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const ctx = contextFor(
      siteFolder,
      [
        {
          document: 'authors/ana',
          baseRevision: 'r',
          deleted: false,
          data: {},
        },
      ],
      [documentOf('authors/ana', { file: ANA, editable: false })],
    );
    expect(await planChanges(ctx)).toMatchObject({
      status: 422,
      body: { error: 'read-only', key: 'authors/ana' },
    });
  });

  it('rethrows an error from the planner that is not a refusal', async () => {
    const siteFolder = await tempWorkingCopy({});
    const failure = new Error('config broke');
    const ctx = saveContext({
      siteFolder,
      bundle: bundleOf([], authorsCollections()),
      documents: new Map(),
      config: {
        get collections(): never {
          throw failure;
        },
        media: { folder: 'src/assets/uploads' },
      },
      changes: [
        {
          document: 'authors/lee',
          baseRevision: null,
          deleted: false,
          data: {},
        },
      ],
    });
    await expect(planChanges(ctx)).rejects.toBe(failure);
  });

  it('answers 422 unwritable for a format the CMS cannot write', async () => {
    const siteFolder = await tempWorkingCopy({ 'src/config.toml': 'a = 1\n' });
    const ctx = contextFor(
      siteFolder,
      [
        {
          document: 'config/site',
          baseRevision: 'r',
          deleted: false,
          data: {},
        },
      ],
      [documentOf('config/site', { file: 'src/config.toml', format: 'toml' })],
    );
    expect(await planChanges(ctx)).toMatchObject({
      status: 422,
      body: {
        error: 'unwritable',
        key: 'config/site',
        message: 'The format "toml" cannot be written',
      },
    });
  });
});
